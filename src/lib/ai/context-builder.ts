import type { AgentRequestBody, ChatMessage } from "./types";
import { getRecentSessionMessages } from "@/lib/server/chat-repository";

const DEFAULT_RECENT_MESSAGE_LIMIT = 12;

export interface AgentContextBuildResult {
  messages: ChatMessage[];
  recentMessageLimit: number;
}

export async function buildAgentContext(params: {
  sessionId: string;
  currentMessage: string;
  recentMessageLimit?: number;
}): Promise<AgentContextBuildResult> {
  const recentMessageLimit =
    params.recentMessageLimit ?? DEFAULT_RECENT_MESSAGE_LIMIT;

  const messages = await getRecentSessionMessages(
    params.sessionId,
    recentMessageLimit
  );

  return {
    messages,
    recentMessageLimit,
  };
}

export function applyBuiltContextToRequest(
  body: AgentRequestBody,
  context: AgentContextBuildResult
): AgentRequestBody {
  return {
    ...body,
    messages: context.messages,
  };
}
