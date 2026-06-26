import servers from "./mcp/servers.json";
import { getMcpAdapter } from "./mcp/adapters";

import type {
  AgentRequestBody,
  ChatMode,
  McpServerDefinition,
} from "./types";

const MCP_SERVER_REGISTRY = servers as McpServerDefinition[];

export function getMcpServerRegistry() {
  return MCP_SERVER_REGISTRY;
}

export function resolveActiveMcpServers(
  body: AgentRequestBody
): McpServerDefinition[] {
  const mode = body.mode ?? "default";

  return MCP_SERVER_REGISTRY.filter((server) => {
    if (server.enabled === false || !server.modes.includes(mode)) {
      return false;
    }

    const adapter = getMcpAdapter(server.adapter);
    return adapter ? adapter.isEnabled({ body, mode }) : false;
  });
}

export function buildMcpInstructions(serversToUse: McpServerDefinition[]) {
  if (serversToUse.length === 0) {
    return "";
  }

  const lines = serversToUse
    .map((server) => {
      const adapter = getMcpAdapter(server.adapter);
      return adapter ? `- ${adapter.buildInstruction(server)}` : "";
    })
    .filter(Boolean);

  return [
    "当前会话接入的 MCP 能力层：",
    ...lines,
    "回答时体现你基于这些能力做了路由，但不要暴露内部推理细节。",
  ].join("\n");
}

export function summarizeMcpRoute(
  mode: ChatMode,
  serversToUse: McpServerDefinition[]
) {
  const routes = serversToUse
    .map((server) => getMcpAdapter(server.adapter)?.routeLabel ?? "")
    .filter(Boolean);

  if (routes.length > 0) {
    return routes.join(" + ");
  }

  if (mode === "web") {
    return "planner -> Browser MCP -> retrieval";
  }

  if (mode === "nearby") {
    return "planner -> Maps MCP -> location search";
  }

  return "planner -> native tools -> direct answer";
}
