import type { AppContext } from "../../context.js";
import type { ToolDef } from "../types.js";
import type { Skill, SkillMeta } from "./types.js";
import { coreSkill } from "./core.js";
import { emailSkill } from "./email/index.js";
import { mcpSkill } from "./mcp/index.js";

// Every skill the copilot knows about. `core` is always present + always on; `email` is opt-in; `mcp`
// is always-on but contributes tools only for the MCP servers the user has connected + enabled.
const SKILLS: Skill[] = [coreSkill, emailSkill, mcpSkill];

export function listSkills(): Skill[] { return SKILLS; }
export function getSkill(id: string): Skill | undefined { return SKILLS.find((s) => s.id === id); }

// A skill is active if it's built-in (core) or the user enabled it in the DB.
export function isSkillEnabled(app: AppContext, s: Skill): boolean {
  return s.builtin || (app.store.getCopilotSkillState(s.id)?.enabled ?? false);
}
export function enabledSkills(app: AppContext): Skill[] {
  return SKILLS.filter((s) => isSkillEnabled(app, s));
}

// The tool set for a turn: every enabled skill's tools, flattened.
export function collectTools(app: AppContext): ToolDef[] {
  return enabledSkills(app).flatMap((s) => s.tools(app));
}

// UI-facing metadata for one skill: its static meta + its live enabled state.
export interface SkillCard extends SkillMeta { enabled: boolean; }
export function skillCards(app: AppContext): SkillCard[] {
  return SKILLS.map((s) => ({
    id: s.id, name: s.name, description: s.description, icon: s.icon,
    builtin: s.builtin, accountsProvider: s.accountsProvider, examples: s.examples,
    enabled: isSkillEnabled(app, s),
  }));
}
