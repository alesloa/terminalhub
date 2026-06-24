// Per-space wizard config + the global-catalog card shapes the wizard renders. Mirrored by hand in
// web/src/api/types.ts (keep in sync — see the project CLAUDE.md note on duplicated cross-cutting types).

/** What the user picked in the Space Creation Wizard, stored as a JSON blob on the space row. */
export interface SpaceConfig {
  skills: string[];      // global skill folder names (~/.claude/skills/<name>) to install per workspace
  commands: string[];    // global slash-command names (~/.claude/commands/<name>.md) to install
  mcpServers: string[];  // global MCP server names (from ~/.claude.json) to write into <folder>/.mcp.json
  env: string;           // raw pasted .env text (KEY=value lines); written verbatim to <folder>/.env
  claudeMd: { mode: "pin" | "append"; content: string }; // managed CLAUDE.md/AGENTS.md content
  seedTarget: "AGENTS.md" | "CLAUDE.md" | "both"; // which rules file(s) the managed block lands in
  presetId: string | null; // provenance: the preset this space was created from (a COPY, not a link)
  version: 1;
}

/** Empty config = a "blank" space that seeds nothing. */
export const EMPTY_SPACE_CONFIG: SpaceConfig = {
  skills: [], commands: [], mcpServers: [], env: "",
  claudeMd: { mode: "append", content: "" }, seedTarget: "both", presetId: null, version: 1,
};

/** A reusable named template — a saved copy of a SpaceConfig. */
export interface SpacePreset {
  id: string;
  name: string;
  icon: string | null;
  config: SpaceConfig;
  createdAt: number;
  updatedAt: number;
}

// --- Catalog cards (the global skills/commands/MCP the wizard offers to add) ----------------------
// `category` is the heuristic topic bucket (see spaces/classify.ts) the wizard's left rail groups by.
export interface SkillCard { name: string; displayName: string; description: string | null; category: string; }
export interface CommandCard { name: string; description: string | null; category: string; }
export interface McpCard { name: string; description: string | null; transport: "stdio" | "sse" | "http"; category: string; }
export interface SpaceCatalog { skills: SkillCard[]; commands: CommandCard[]; mcpServers: McpCard[]; }

/** Coerce an unknown blob (parsed from the DB or a request) into a valid SpaceConfig, dropping
 *  anything malformed. Never throws — a corrupt config degrades to fields that are safe to seed. */
export function normalizeSpaceConfig(raw: unknown): SpaceConfig {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const cm = (o.claudeMd && typeof o.claudeMd === "object" ? o.claudeMd : {}) as Record<string, unknown>;
  const mode = cm.mode === "pin" ? "pin" : "append";
  const target = o.seedTarget === "AGENTS.md" || o.seedTarget === "CLAUDE.md" ? o.seedTarget : "both";
  return {
    skills: strArr(o.skills),
    commands: strArr(o.commands),
    mcpServers: strArr(o.mcpServers),
    env: typeof o.env === "string" ? o.env : "",
    claudeMd: { mode, content: typeof cm.content === "string" ? cm.content : "" },
    seedTarget: target,
    presetId: typeof o.presetId === "string" ? o.presetId : null,
    version: 1,
  };
}

/** True when the config would seed nothing — lets callers skip the seeder entirely. */
export function isEmptySpaceConfig(c: SpaceConfig): boolean {
  return c.skills.length === 0 && c.commands.length === 0 && c.mcpServers.length === 0
    && c.env.trim() === "" && c.claudeMd.content.trim() === "";
}
