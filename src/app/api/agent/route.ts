import { NextRequest, NextResponse } from "next/server";
import { runAssistant } from "@/lib/ai/agent";
import { applyBuiltContextToRequest, buildAgentContext } from "@/lib/ai/context-builder";
import {
  completeAgentRun,
  createAgentRun,
  createChatMessage,
  ensureChatSession,
  saveToolCalls,
  touchSessionTitleIfEmpty,
} from "@/lib/server/chat-repository";
import type {
  AgentRequestBody,
  ChatMessage,
  UploadedAttachment,
} from "@/lib/ai/types";
import type { AgentStreamEvent } from "@/lib/ai/stream-types";

const AGENT_MODEL = "deepseek-chat";

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function normalizeMessage(value: unknown): ChatMessage[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter((item): item is ChatMessage => {
    if (typeof item !== "object" || item === null) {
      return false;
    }

    const message = item as Record<string, unknown>;

    return (
      typeof message.id === "string" &&
      (message.role === "user" || message.role === "assistant") &&
      typeof message.content === "string" &&
      typeof message.createdAt === "number"
    );
  });
}

function normalizeMode(value: unknown): AgentRequestBody["mode"] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  if (value === "default" || value === "web" || value === "nearby") {
    return value;
  }

  return undefined;
}

function extractMessage(parsedBody: Record<string, unknown>): string {
  if (typeof parsedBody.message === "string") {
    return parsedBody.message.trim();
  }

  if (typeof parsedBody.prompt === "string") {
    return parsedBody.prompt.trim();
  }

  return "";
}

// 判断一个上传文件是不是文本类型文件
function isTextLikeFile(file: File): boolean {
  // 获取小写文件名
  const lowerName = file.name.toLowerCase();

  return (
    file.type.startsWith("text/") ||
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".md") ||
    lowerName.endsWith(".json") ||
    lowerName.endsWith(".csv")
  );
}

async function normalizeUploadedFile(file: File): Promise<UploadedAttachment> {
  // 获取mime类型，用来告诉浏览器或客户端：服务器返回的文件“是什么种类
  // 如text/html返回的是网页，text/plain返回.txt 文件
  const mimeType = file.type || "application/octet-stream";
  const isImage = mimeType.startsWith("image/");
  const isText = isTextLikeFile(file);

  let extractedText: string | undefined;

  if (isText) {
    // 异步读取文件内容为字符串
    const text = await file.text();
    // 截取前8000个字符，防止因为文件过大导致性能问题或超出ai上下文限制
    extractedText = text.slice(0, 8000);
  }

  return {
    id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    mimeType,
    size: file.size,
    kind: isImage ? "image" : isText ? "text" : "file",
    extractedText,
  };
}

//异步的智能体解析函数，解析前端发来的请求体，将请求体转换为 POST请求需要的格式
// request: NextRequest - Next.js 框架的请求对象。返回值为要么返回解析成功的body，要么返回错误响应
async function parseAgentRequest(
  request: NextRequest
): Promise<{
  body?: AgentRequestBody;
  errorResponse?: NextResponse;
}> {
  // 获取content-type
  const contentType = request.headers.get("content-type") ?? "";

  // 1) 文件上传 / 图片上传 走 FormData
  if (contentType.includes("multipart/form-data")) {
    // 解析FormData,异步解析请求体为FormData对象（包含文本字段和文件）
    const formData = await request.formData();
    // 提取message字段，获取名为message的字段
    const messageValue = formData.get("message");
    const message =
      typeof messageValue === "string" ? messageValue.trim() : "";

    let messages: ChatMessage[] | undefined;
    // 获取历史聊天记录
    const rawMessages = formData.get("messages");

    if (typeof rawMessages === "string" && rawMessages.trim()) {
      try {
        messages = normalizeMessage(JSON.parse(rawMessages));
      } catch (error) {
        if (request.signal.aborted || isAbortError(error)) {
          return {
            errorResponse: new NextResponse(null, { status: 499 }),
          };
        }

        return {
          errorResponse: NextResponse.json(
            { error: "messages 字段不是合法的 JSON" },
            { status: 400 }
          ),
        };
      }
    }
    
    //.getAll("files")是获取所有名字为files的字段支持多文件
    // 排除空文件，只保留File类型的项
    const files = formData
      .getAll("files")
      .filter((item): item is File => item instanceof File && item.size > 0);
     
      if (!message && files.length === 0) {
  return {
    errorResponse: NextResponse.json(
      { error: "message 或 files 至少要有一个" },
      { status: 400 }
    ),
  };
}
    // 标准化附件，取上面定义的normalizeUploadedFile函数
    const attachments = await Promise.all(files.map(normalizeUploadedFile));
    
    // 获取会话id和模式字段
    const sessionIdValue = formData.get("sessionId");
    const modeValue = formData.get("mode");

    return {
      body: {
        message,
        messages,
        sessionId:
          typeof sessionIdValue === "string" ? sessionIdValue : undefined,
        mode: normalizeMode(modeValue),
        attachments,
      },
    };
  }

  // 2) 普通聊天继续走 JSON
  const rawBody = await request.text();

  if (!rawBody.trim()) {
    if (request.signal.aborted) {
      return {
        errorResponse: new NextResponse(null, { status: 499 }),
      };
    }

    return {
      errorResponse: NextResponse.json(
        { error: "请求体为空" },
        { status: 400 }
      ),
    };
  }

  let parsedBody: Record<string, unknown>;

  try {
    parsedBody = JSON.parse(rawBody) as Record<string, unknown>;
  } catch (error) {
    if (request.signal.aborted || isAbortError(error)) {
      return {
        errorResponse: new NextResponse(null, { status: 499 }),
      };
    }

    return {
      errorResponse: NextResponse.json(
        { error: "请求体是不合法的JSON" },
        { status: 400 }
      ),
    };
  }

  const message = extractMessage(parsedBody);

  if (!message) {
    return {
      errorResponse: NextResponse.json(
        { error: "message is required for a response" },
        { status: 400 }
      ),
    };
  }

  return {
    body: {
      message,
      messages: normalizeMessage(parsedBody.messages),
      sessionId:
        typeof parsedBody.sessionId === "string"
          ? parsedBody.sessionId
          : undefined,
      mode: normalizeMode(parsedBody.mode),
      attachments: undefined,
    },
  };
}

function encodeStreamEvent(
  encoder: TextEncoder,
  event: AgentStreamEvent
): Uint8Array {
  return encoder.encode(JSON.stringify(event) + "\n");
}

export async function POST(request: NextRequest) {
  try {
    const { body, errorResponse } = await parseAgentRequest(request);

    if (errorResponse) {
      return errorResponse;
    }

    if (!body) {
      return NextResponse.json(
        { error: "无法解析请求体" },
        { status: 400 }
      );
    }

    if (request.signal.aborted) {
      return new NextResponse(null, { status: 499 });
    }

    const session = await ensureChatSession(body.sessionId);
    const userMessage = await createChatMessage({
      sessionId: session.id,
      role: "user",
      content: body.message,
    });

    await touchSessionTitleIfEmpty({
      sessionId: session.id,
      firstMessageContent: body.message,
    });

    const builtContext = await buildAgentContext({
      sessionId: session.id,
      currentMessage: body.message,
    });

    const bodyWithServerContext = applyBuiltContextToRequest(
      {
        ...body,
        sessionId: session.id,
      },
      {
        ...builtContext,
        messages: builtContext.messages.filter(
          (message) => message.id !== userMessage.id
        ),
      }
    );

    const agentRun = await createAgentRun({
      sessionId: session.id,
      userMessageId: userMessage.id,
      mode: body.mode ?? "default",
      model: AGENT_MODEL,
    });

    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let isClosed = false;

        const closeStream = () => {
          if (isClosed) {
            return;
          }
          isClosed = true;
          controller.close();
        };

        const writeEvent = (event: AgentStreamEvent) => {
          if (isClosed) {
            return;
          }

          controller.enqueue(encodeStreamEvent(encoder, event));
        };

        const handleAbort = () => {
          closeStream();
        };

        request.signal.addEventListener("abort", handleAbort);

        try {
          const result = await runAssistant(bodyWithServerContext, request.signal, (event) => {
            writeEvent(event);
          });

          const assistantMessage = await createChatMessage({
            sessionId: session.id,
            role: "assistant",
            content: result.reply,
            toolCalls: result.toolCalls,
            runContext: {
              mode: result.context.mode,
              plannedRoute: result.context.harness.plannedRoute,
              activeSkillIds: result.context.harness.activeSkillIds,
              activeMcpServerIds: result.context.harness.activeMcpServerIds,
              checks: result.context.harness.checks,
            },
          });

          await saveToolCalls({
            runId: agentRun.id,
            toolCalls: result.toolCalls,
          });

          await completeAgentRun({
            runId: agentRun.id,
            assistantMessageId: assistantMessage.id,
            status: "success",
          });
        } catch (error) {
          if (!request.signal.aborted && !isAbortError(error)) {
            console.error("Agent route stream error:", error);
          }

          await completeAgentRun({
            runId: agentRun.id,
            status: "error",
            error: error instanceof Error ? error.message : "Agent run failed",
          }).catch((persistError) => {
            console.error("Failed to persist agent run error:", persistError);
          });
        } finally {
          request.signal.removeEventListener("abort", handleAbort);
          closeStream();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (error) {
    if (request.signal.aborted || isAbortError(error)) {
      return new NextResponse(null, { status: 499 });
    }

    return NextResponse.json(
      { error: "Something went wrong in /api/agent" },
      { status: 500 }
    );
  }
}
