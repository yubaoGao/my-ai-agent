import type {
  AgentRequestBody,
  ChatMode,
  McpServerDefinition,
} from "../types";

export interface McpAdapterContext {
  body: AgentRequestBody;
  mode: ChatMode;
}

export interface McpAdapter {
  id: string;
  routeLabel: string;
  isEnabled(context: McpAdapterContext): boolean;
  buildInstruction(server: McpServerDefinition): string;
}

function includesAny(text: string, keywords: string[]) {
  const normalized = text.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

const mapsAdapter: McpAdapter = {
  id: "maps",
  routeLabel: "planner -> Maps MCP -> geo/place tools -> ranking",
  isEnabled: ({ body, mode }) => {
    if (mode === "nearby") {
      return true;
    }

    if (mode !== "default") {
      return false;
    }

    if (
      /(\u5929\u6c14|\u6e29\u5ea6|\u6e7f\u5ea6|\u964d\u96e8|\u4f4d\u7f6e|\u5728\u54ea|\u6211\u5728\u54ea|\u5f53\u524d|\u54ea\u91cc|\u9644\u8fd1|\u5468\u8fb9)/.test(
        body.message
      )
    ) {
      return true;
    }

    return includesAny(body.message, [
      "天气",
      "温度",
      "湿度",
      "降雨",
      "位置",
      "在哪",
      "我在哪",
      "当前",
      "哪里",
      "附近",
      "周边",
      "weather",
      "location",
      "nearby",
    ]);
  },
  buildInstruction(server) {
    return `${server.name}: ${server.description} Provider: ${server.provider.name}. Transport: ${server.provider.transport}. Capabilities: ${server.capabilities.join(", ")}.`;
  },
};

const browserAdapter: McpAdapter = {
  id: "browser",
  routeLabel: "planner -> Browser MCP -> search tool -> synthesis",
  isEnabled: ({ mode }) => mode === "web",
  buildInstruction(server) {
    return `${server.name}: ${server.description} Provider: ${server.provider.name}. Transport: ${server.provider.transport}. Capabilities: ${server.capabilities.join(", ")}.`;
  },
};

const workspaceAdapter: McpAdapter = {
  id: "workspace",
  routeLabel: "planner -> Workspace MCP -> attachment context -> synthesis",
  isEnabled: ({ body }) => Boolean(body.attachments?.length),
  buildInstruction(server) {
    return `${server.name}: ${server.description} Provider: ${server.provider.name}. Transport: ${server.provider.transport}. Capabilities: ${server.capabilities.join(", ")}.`;
  },
};

const ADAPTERS: Record<string, McpAdapter> = {
  maps: mapsAdapter,
  browser: browserAdapter,
  workspace: workspaceAdapter,
};

export function getMcpAdapter(adapterId: string) {
  return ADAPTERS[adapterId];
}
