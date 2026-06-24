// Per-agent brand identity — the DEFAULT icon + color a terminal wears when it's running that agent.
// Both are derived from the terminal's launch command and are overridable per terminal: the user can
// pick any codicon (icon picker) or hex (color picker), and clearing an override drops back to these
// defaults. The SVGs live at web/public/agents/<id>.svg; the binaries mirror the agent registry
// (server/src/agents/registry.ts) and the command parsing mirrors agentBinary
// (server/src/activity/working.ts) — keep them in sync by hand.

export type AgentId = "claude" | "codex" | "gemini" | "opencode" | "cursor";

/** Brand accent color per agent (hex). Tints the terminal's label/glyph when no custom color is set. */
export const AGENT_COLORS: Record<AgentId, string> = {
  claude: "#d27354",
  codex: "#0ea47e",
  gemini: "#157bf5",
  opencode: "#029dc9",
  cursor: "#cfceca",
};

/** Agent BINARY (basename of the launch command) → registry id. The Cursor CLI's binary is
 *  `cursor-agent` but its id/icon is `cursor`. */
const BIN_TO_ID: Record<string, AgentId> = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
  opencode: "opencode",
  "cursor-agent": "cursor",
};

/** The agent a launch command runs, or null for a plain shell / unknown CLI. Mirrors the server's
 *  agentBinary: first token's lowercased basename, with a `headroom wrap <agent> …` launcher
 *  unwrapped to the wrapped agent. */
export function agentIdForCommand(cmd: string | null | undefined): AgentId | null {
  const tokens = (cmd ?? "").trim().split(/\s+/);
  const base = (tok: string) => (tok.split("/").pop() ?? tok).toLowerCase();
  let bin = base(tokens[0] ?? "");
  if (bin === "headroom" && (tokens[1] ?? "").toLowerCase() === "wrap" && tokens[2]) bin = base(tokens[2]);
  return BIN_TO_ID[bin] ?? null;
}

/** SVG icon path for an agent id (served from web/public/agents). */
export function agentIconPath(id: AgentId): string {
  return `/agents/${id}.svg`;
}
