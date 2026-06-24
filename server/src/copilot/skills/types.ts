import type { AppContext } from "../../context.js";
import type { ToolDef } from "../types.js";

// A Copilot "skill" — a named, assignable capability bundle the user can see and toggle. The built-in
// `core` skill (app control + knowledge) is always on; optional skills (e.g. `email`) are opt-in and
// may manage their own accounts. A skill contributes tools to the agent's tool set when enabled.
export interface SkillMeta {
  id: string;                  // 'core' | 'email' | …
  name: string;
  description: string;
  icon: string;                // short glyph shown on the skill card
  builtin: boolean;            // always enabled, can't be turned off (core)
  accountsProvider: boolean;   // manages connected accounts the user adds (email)
  examples: string[];          // sample phrasings surfaced in the UI so the skill is discoverable
}

export interface Skill extends SkillMeta {
  // The tools this skill contributes while enabled. Given the live app context so a skill can build
  // tools from its configured state (e.g. email tools from connected accounts).
  tools(app: AppContext): ToolDef[];
}
