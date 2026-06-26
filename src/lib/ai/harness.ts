import type { AgentRequestBody, AgentRunContext, HarnessTrace } from "./types";
import { summarizeMcpRoute } from "./mcp-registry";

function createRunId() {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createHarnessTrace(
  body: AgentRequestBody,
  context: Omit<AgentRunContext, "harness">
): HarnessTrace {
  const mode = body.mode ?? "default";
  const checks = [
    {
      name: "tool-grounding",
      expectation:
        mode === "web"
          ? "latest questions should rely on retrieval instead of memory"
          : mode === "nearby"
          ? "nearby questions should use location-aware search"
          : "weather and location questions should prefer tools",
    },
    {
      name: "skill-activation",
      expectation: "response should reflect the selected skill pack behavior",
    },
    {
      name: "answer-shape",
      expectation: "answer should be concise first, then supporting detail",
    },
  ];

  return {
    runId: createRunId(),
    mode,
    plannedRoute: summarizeMcpRoute(mode, context.activeMcpServers),
    activeSkillIds: context.activeSkills.map((skill) => skill.id),
    activeMcpServerIds: context.activeMcpServers.map((server) => server.id),
    checks,
  };
}

export function buildHarnessInstructions(harness: HarnessTrace) {
  return [
    "当前运行附带 harness 检查：",
    `- route: ${harness.plannedRoute}`,
    ...harness.checks.map(
      (check) => `- ${check.name}: ${check.expectation}`
    ),
    "请让最终回答符合这些检查项。",
  ].join("\n");
}
