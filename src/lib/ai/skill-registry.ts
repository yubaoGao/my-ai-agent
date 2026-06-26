import skillIndex from "./skills/index.json";

import type {
  AgentRequestBody,
  ChatMode,
  SkillDefinition,
  SkillIndexDefinition,
} from "./types";

const SKILL_INDEX = skillIndex as SkillIndexDefinition;
const SKILL_LIBRARY: SkillDefinition[] = SKILL_INDEX.skills;

function includesAny(text: string, keywords: string[]) {
  const normalized = text.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

function dedupeSkills(skills: SkillDefinition[]) {
  return Array.from(new Map(skills.map((skill) => [skill.id, skill])).values());
}

export function getSkillLibrary() {
  return SKILL_LIBRARY;
}

export function getSkillIndexVersion() {
  return SKILL_INDEX.version;
}

export function resolveActiveSkills(body: AgentRequestBody): SkillDefinition[] {
  const message = body.message.trim();
  const matched = SKILL_LIBRARY.filter((skill) =>
    includesAny(message, skill.whenToUse)
  );

  if (body.mode === "web") {
    matched.push(...getDefaultSkillsForMode("web"));
  }

  if (body.mode === "nearby") {
    matched.push(...getDefaultSkillsForMode("nearby"));
  }

  if (body.attachments?.length) {
    matched.push(
      ...SKILL_LIBRARY.filter((skill) => skill.id === "skill.attachment-reader")
    );
  }

  return dedupeSkills(matched);
}

export function buildSkillInstructions(skills: SkillDefinition[]) {
  if (skills.length === 0) {
    return "";
  }

  return [
    "当前激活的 skills：",
    ...skills.map(
      (skill) =>
        `- ${skill.name}: ${skill.description}。Rule: ${skill.instruction}`
    ),
  ].join("\n");
}

export function getDefaultSkillsForMode(mode: ChatMode) {
  if (mode === "web") {
    return SKILL_LIBRARY.filter((skill) => skill.id === "skill.web-research");
  }

  if (mode === "nearby") {
    return SKILL_LIBRARY.filter((skill) => skill.id === "skill.local-guide");
  }

  return [];
}
