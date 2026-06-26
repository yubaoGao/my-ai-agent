import {
  Agent,
  assistant,
  run,
  setDefaultOpenAIClient,
  setOpenAIAPI,
  user,
} from "@openai/agents";
import type { AgentInputItem, RunStreamEvent } from "@openai/agents";
import { OpenAI } from "openai";

import { createHarnessTrace, buildHarnessInstructions } from "./harness";
import { buildMcpInstructions, resolveActiveMcpServers } from "./mcp-registry";
import {
  buildSkillInstructions,
  resolveActiveSkills,
} from "./skill-registry";
import type {
  AgentRequestBody,
  AgentRunContext,
  ChatMessage,
  RunAssistantResult,
} from "./types";
import type { AgentStreamEvent, ToolCallRecord } from "./stream-types";
import { createAssistantTools } from "./tools";

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com/v1",
});

setDefaultOpenAIClient(client);
setOpenAIAPI("chat_completions");

const assistantInstructions = `
你是一个中文 AI 助手。

工具调用规则：
1. 只要用户询问天气、温度、湿度、风速、降水、体感温度等实时天气信息，必须调用 get_weather_by_location。
2. 如果用户没有明确给出地点，必须先调用 get_user_location，再调用 get_weather_by_location。
3. 不允许在天气问题上直接凭常识、训练数据或上下文猜测回答。
4. 只要是新的地点天气问题，即使当前会话里查过别的城市，也必须重新调用天气工具。
5. 若工具调用失败，要明确说明失败原因，不要编造结果。

回答风格：
- 先直接回答结论，再补充必要说明。
- 语言简洁，结构清楚。
- 不要向用户暴露内部推理过程。
`;

function buildModeInstructions(mode: AgentRequestBody["mode"]) {
  if (mode === "web") {
    return `
当前会话模式：联网模式。

规则：
1. 当用户询问最新信息、新闻、官网资料、当前版本、最近变化时，优先调用 search_web。
2. 如果问题是实时天气，仍然优先使用天气工具，不要用 search_web 代替天气工具。
3. 回答时先给结论，再整理检索依据。
4. 没有合适检索结果时要明确说明，不要伪造。
`;
  }

  if (mode === "nearby") {
    return `
当前会话模式：周边推荐模式。

规则：
1. 当用户询问附近有什么、离我最近的某类地点、周边推荐时，优先调用 search_nearby_places。
2. 用户未给地点时，可结合当前位置搜索。
3. 用户明确给出地点时，应围绕该地点搜索，不要擅自切换城市。
4. 回答时优先给推荐结果，再补充距离、地址、适合理由。
`;
  }

  return "";
}

type AgentEventHandler = (event: AgentStreamEvent) => void;

function upsertToolCallRecord(
  records: ToolCallRecord[],
  nextRecord: ToolCallRecord
) {
  const index = records.findIndex((item) => item.id === nextRecord.id);

  if (index === -1) {
    records.push(nextRecord);
    return;
  }

  records[index] = nextRecord;
}

function buildAttachmentContext(
  attachments?: AgentRequestBody["attachments"]
): string {
  if (!attachments?.length) {
    return "";
  }

  const parts = attachments.map((item, index) => {
    const header = `附件${index + 1}: ${item.name}（类型: ${item.mimeType}，大小: ${item.size} bytes）`;

    if (item.kind === "text" && item.extractedText) {
      return `${header}\n以下是文件内容片段：\n${item.extractedText}`;
    }

    if (item.kind === "image") {
      return `${header}\n这是一个图片附件。当前模型为文本模型，暂时不能直接解析像素级内容。`;
    }

    return `${header}\n这是一个普通文件附件，当前没有可直接读取的文本内容。`;
  });

  return `用户上传了以下附件：\n\n${parts.join("\n\n")}`;
}

function buildFinalUserMessage(body: AgentRequestBody): string {
  const attachmentContext = buildAttachmentContext(body.attachments);
  const parts = [attachmentContext, body.message].filter(
    (item) => item && item.trim().length > 0
  );

  if (parts.length === 0) {
    return "请根据用户上传的附件回答问题。";
  }

  return parts.join("\n\n");
}

function buildConversationInput(
  message: string,
  messages?: ChatMessage[]
): string | AgentInputItem[] {
  if (!messages?.length) {
    return message;
  }

  const history: AgentInputItem[] = messages.map((item) =>
    item.role === "user" ? user(item.content) : assistant(item.content)
  );

  const lastMessage = messages[messages.length - 1];

  if (lastMessage?.role === "user" && lastMessage.content === message) {
    return history;
  }

  return [...history, user(message)];
}

function extractTextDelta(event: RunStreamEvent): string {
  if (event.type !== "raw_model_stream_event") {
    return "";
  }

  const raw = event as unknown as {
    data?: {
      type?: unknown;
      event?: {
        choices?: Array<{
          delta?: {
            content?: unknown;
          };
        }>;
      };
    };
  };

  if (raw.data?.type !== "model") {
    return "";
  }

  const content = raw.data?.event?.choices?.[0]?.delta?.content;
  return typeof content === "string" ? content : "";
}

function buildRunContext(body: AgentRequestBody): AgentRunContext {
  const mode = body.mode ?? "default";
  const activeSkills = resolveActiveSkills(body);
  const activeMcpServers = resolveActiveMcpServers(body);
  const contextWithoutHarness = {
    mode,
    activeSkills,
    activeMcpServers,
  };

  return {
    ...contextWithoutHarness,
    harness: createHarnessTrace(body, contextWithoutHarness),
  };
}

function buildContextInstructions(context: AgentRunContext) {
  return [
    buildModeInstructions(context.mode),
    buildSkillInstructions(context.activeSkills),
    buildMcpInstructions(context.activeMcpServers),
    buildHarnessInstructions(context.harness),
  ]
    .filter((item) => item.trim().length > 0)
    .join("\n\n");
}

export async function runAssistant(
  body: AgentRequestBody,
  signal: AbortSignal,
  onEvent?: AgentEventHandler
): Promise<RunAssistantResult> {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error("环境变量中缺少 DEEPSEEK_API_KEY");
  }

  const context = buildRunContext(body);
  const finalUserMessage = buildFinalUserMessage(body);
  const input = buildConversationInput(finalUserMessage, body.messages);
  const toolCalls: ToolCallRecord[] = [];

  onEvent?.({
    type: "run-context",
    context: {
      mode: context.mode,
      plannedRoute: context.harness.plannedRoute,
      activeSkillIds: context.harness.activeSkillIds,
      activeMcpServerIds: context.harness.activeMcpServerIds,
      checks: context.harness.checks,
    },
  });

  const handleAgentEvent = (event: AgentStreamEvent) => {
    if (event.type === "tool-start" || event.type === "tool-end") {
      upsertToolCallRecord(toolCalls, event.toolCall);
    }

    onEvent?.(event);
  };

  const agent = new Agent({
    name: "Personal Assistant",
    model: "deepseek-chat",
    instructions: [assistantInstructions, buildContextInstructions(context)]
      .filter((item) => item.trim().length > 0)
      .join("\n\n"),
    tools: createAssistantTools(signal, handleAgentEvent, context.mode),
  });

  try {
    const stream = await run(agent, input, {
      stream: true,
      signal,
    });

    let reply = "";

    for await (const event of stream) {
      const delta = extractTextDelta(event);

      if (!delta) {
        continue;
      }

      reply += delta;

      onEvent?.({
        type: "text-delta",
        delta,
      });
    }

    await stream.completed;

    const finalReply = reply || String(stream.finalOutput ?? "");

    onEvent?.({
      type: "done",
      reply: finalReply,
      toolCalls: [...toolCalls],
    });

    return {
      reply: finalReply,
      toolCalls: [...toolCalls],
      context,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Agent 执行失败";

    onEvent?.({
      type: "error",
      message,
    });

    throw error;
  }
}
