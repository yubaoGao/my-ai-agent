import { prisma } from "@/lib/db";
import type { ChatMessage, ChatMode, ChatSession } from "@/lib/ai/types";
import type { RunContextEventPayload, ToolCallRecord } from "@/lib/ai/stream-types";

const DEFAULT_USER_ID = "local-user";

function toTimestamp(value: Date) {
  return value.getTime();
}

function parseJsonArray<T>(value: unknown): T[] | undefined {
  return Array.isArray(value) ? (value as T[]) : undefined;
}

function parseRunContext(value: unknown): RunContextEventPayload | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const context = value as RunContextEventPayload;
  return typeof context.mode === "string" ? context : undefined;
}

function mapMessage(message: {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
  toolCalls: unknown;
  runContext: unknown;
}): ChatMessage {
  return {
    id: message.id,
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content,
    createdAt: toTimestamp(message.createdAt),
    toolCalls: parseJsonArray<ToolCallRecord>(message.toolCalls),
    runContext: parseRunContext(message.runContext),
  };
}

function mapSession(session: {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  _count?: { messages: number };
}): ChatSession {
  return {
    id: session.id,
    title: session.title,
    messages: [],
    messageCount: session._count?.messages ?? 0,
    createdAt: toTimestamp(session.createdAt),
    updatedAt: toTimestamp(session.updatedAt),
  };
}

export function generateSessionTitle(content: string) {
  const trimmed = content.trim();
  if (!trimmed) {
    return "New chat";
  }

  return trimmed.length > 18 ? `${trimmed.slice(0, 18)}...` : trimmed;
}

export async function listChatSessions(userId = DEFAULT_USER_ID) {
  const sessions = await prisma.chatSession.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: {
        select: { messages: true },
      },
    },
  });

  return sessions.map(mapSession);
}

export async function createChatSession(params?: {
  title?: string;
  userId?: string;
}) {
  const session = await prisma.chatSession.create({
    data: {
      userId: params?.userId ?? DEFAULT_USER_ID,
      title: params?.title?.trim() || "New chat",
    },
    include: {
      _count: {
        select: { messages: true },
      },
    },
  });

  return mapSession(session);
}

export async function ensureChatSession(sessionId?: string) {
  if (sessionId) {
    const existing = await prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: {
        _count: {
          select: { messages: true },
        },
      },
    });

    if (existing) {
      return mapSession(existing);
    }
  }

  return createChatSession();
}

export async function getSessionMessageCount(sessionId: string) {
  return prisma.chatMessage.count({
    where: { sessionId },
  });
}

export async function listSessionMessages(sessionId: string) {
  const messages = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
  });

  return messages.map(mapMessage);
}

export async function clearSessionMessages(sessionId: string) {
  await prisma.$transaction([
    prisma.chatMessage.deleteMany({
      where: { sessionId },
    }),
    prisma.chatSession.update({
      where: { id: sessionId },
      data: { title: "New chat" },
    }),
  ]);
}

export async function getRecentSessionMessages(sessionId: string, take = 12) {
  const messages = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
    take,
  });

  return messages.reverse().map(mapMessage);
}

export async function createChatMessage(params: {
  sessionId: string;
  role: ChatMessage["role"];
  content: string;
  toolCalls?: ToolCallRecord[];
  runContext?: RunContextEventPayload;
}) {
  const message = await prisma.chatMessage.create({
    data: {
      sessionId: params.sessionId,
      role: params.role,
      content: params.content,
      toolCalls: params.toolCalls ? JSON.parse(JSON.stringify(params.toolCalls)) : undefined,
      runContext: params.runContext ? JSON.parse(JSON.stringify(params.runContext)) : undefined,
    },
  });

  await prisma.chatSession.update({
    where: { id: params.sessionId },
    data: { updatedAt: new Date() },
  });

  return mapMessage(message);
}

export async function touchSessionTitleIfEmpty(params: {
  sessionId: string;
  firstMessageContent: string;
}) {
  const count = await getSessionMessageCount(params.sessionId);

  if (count !== 1) {
    return;
  }

  await prisma.chatSession.update({
    where: { id: params.sessionId },
    data: {
      title: generateSessionTitle(params.firstMessageContent),
    },
  });
}

export async function createAgentRun(params: {
  sessionId: string;
  userMessageId: string;
  mode: ChatMode;
  model: string;
}) {
  return prisma.agentRun.create({
    data: {
      sessionId: params.sessionId,
      userMessageId: params.userMessageId,
      mode: params.mode,
      model: params.model,
      status: "running",
    },
  });
}

export async function completeAgentRun(params: {
  runId: string;
  assistantMessageId?: string;
  status: "success" | "error";
  error?: string;
}) {
  await prisma.agentRun.update({
    where: { id: params.runId },
    data: {
      assistantMessageId: params.assistantMessageId,
      status: params.status,
      error: params.error,
    },
  });
}

export async function saveToolCalls(params: {
  runId: string;
  toolCalls: ToolCallRecord[];
}) {
  if (params.toolCalls.length === 0) {
    return;
  }

  await prisma.toolCall.createMany({
    data: params.toolCalls.map((toolCall) => ({
      runId: params.runId,
      toolCallId: toolCall.id,
      toolName: toolCall.toolName,
      args: JSON.parse(JSON.stringify(toolCall.args ?? {})),
      result:
        toolCall.result === undefined
          ? undefined
          : JSON.parse(JSON.stringify(toolCall.result ?? {})),
      error: toolCall.error,
      status: toolCall.status,
      startedAt: new Date(toolCall.startedAt),
      finishedAt: toolCall.finishedAt ? new Date(toolCall.finishedAt) : undefined,
    })),
  });
}
