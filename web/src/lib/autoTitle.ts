// Auto-titling for terminal tabs. A freshly-created terminal keeps its placeholder name
// ("Terminal 3") until the first command runs in it, then renames itself after that command —
// EXCEPT when the command launches an AI coding CLI (claude/codex/gemini/…), where it waits and
// names the tab after the FIRST few words of the user's first PROMPT to that tool ("fix the login
// bug for the") — no agent prefix; the user types their own if they want one. These are the pure
// helpers; the stateful wiring — when a line is committed, where the "waiting" flag lives — is in
// useTerminalSocket + the room store.

const TITLE_WORDS = 6; // cap the prompt portion of an AI tab name to its first N words

// Known AI coding-agent CLIs → the display name used as the tab's title prefix. Match is on the
// bare command or a `<cli> ` prefix (case-insensitive). Add a row to support a new agent.
export const AI_TOOLS = [
  { cli: "claude", label: "Claude" },
  { cli: "codex", label: "Codex" },
  { cli: "gemini", label: "Gemini" },
  { cli: "aider", label: "Aider" },
  { cli: "opencode", label: "OpenCode" },
] as const;

export type AiTool = (typeof AI_TOOLS)[number]["label"];

/** The server names new terminals `Terminal <n>` (POST /api/workspaces/:id/terminals). A tab still
 *  wearing that placeholder has no preset/override name and is "armed" to auto-name itself. A custom
 *  name (created-with-title or a manual rename) never matches, so an override always wins. */
export function isPlaceholderTitle(title: string): boolean {
  return /^Terminal \d+$/.test(title.trim());
}

/** Is this command an AI-CLI launch? True for exactly the CLI name or a `<cli> ` prefix
 *  (case-insensitive), for any agent in AI_TOOLS. Returns its display name (for the title
 *  prefix), else null. */
export function detectAiTool(command: string): AiTool | null {
  const c = command.trim().toLowerCase();
  for (const { cli, label } of AI_TOOLS) {
    if (c === cli || c.startsWith(cli + " ")) return label;
  }
  return null;
}

/** Strip the shell prompt off a visually-read terminal line: keep everything AFTER the LAST prompt
 *  character (`%`, `$`, `>`, `#`), trimmed. No prompt char found → the whole line, trimmed. */
export function stripPrompt(line: string): string {
  let last = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "%" || ch === "$" || ch === ">" || ch === "#") last = i;
  }
  return line.slice(last + 1).trim();
}

/** First line of a (possibly multi-line) pasted string. */
export function firstLine(text: string): string {
  return text.split(/\r?\n/, 1)[0] ?? "";
}

/** First N words (whitespace-collapsed) of a string — keeps an AI tab name short, the way the
 *  session browser previews a session by its opening words instead of the whole prompt. */
export function firstWords(text: string, max = TITLE_WORDS): string {
  return text.trim().split(/\s+/).filter(Boolean).slice(0, max).join(" ");
}

/** Resolve the command into the tab's auto-title given the current waiting state. Returns the new
 *  title to apply, or a state transition (`wait`) when the command is an AI-CLI launch that should
 *  hold for the next line. `null` = do nothing (empty command). */
export function resolveAutoTitle(command: string, waiting: AiTool | null):
  | { kind: "wait"; tool: AiTool }
  | { kind: "title"; title: string }
  | null {
  const c = command.trim();
  if (!c) return null;
  const launch = detectAiTool(c);
  if (launch && !waiting) return { kind: "wait", tool: launch };
  // Waiting on an AI prompt → the first 6 words of the prompt (no agent prefix). A plain command
  // names the tab as-is.
  return { kind: "title", title: waiting ? firstWords(c) : c };
}
