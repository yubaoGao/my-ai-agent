export type ToolCallStatus = "running" | "success" | "error";

export interface ToolCallRecord {
  id: string;
  toolName: string;
  args: unknown;
  result?: unknown;
  error?: string;
  status: ToolCallStatus;
  startedAt: number;
  finishedAt?: number;
}

export interface RunContextEventPayload {
  mode: "default" | "web" | "nearby";
  plannedRoute: string;
  activeSkillIds: string[];
  activeMcpServerIds: string[];
  checks: Array<{
    name: string;
    expectation: string;
  }>;
}

export type AgentStreamEvent =
  | {
      type: "text-delta";
      delta: string;
    }
  | {
      type: "tool-start";
      toolCall: ToolCallRecord;
    }
  | {
      type: "tool-end";
      toolCall: ToolCallRecord;
    }
  | {
      type: "run-context";
      context: RunContextEventPayload;
    }
  | {
      type: "done";
      reply: string;
      toolCalls: ToolCallRecord[];
    }
  | {
      type: "error";
      message: string;
    };
