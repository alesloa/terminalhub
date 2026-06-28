import type { ToolDef } from "../types.js";
import { MANIFEST } from "./manifest.js";

// Build the copilot's system prompt: who it is, the product knowledge (a compact manifest digest),
// the tools it can actually call, and how to behave. The manifest digest is what makes it "know
// everything about the app"; the tool list is what it can DO (vs only explain).
export function buildSystemPrompt(opts: {
  enabledSkillIds: string[];
  tools: ToolDef[];
  accountsSummary?: string;
}): string {
  const { enabledSkillIds, tools, accountsSummary } = opts;

  const features = groupBySection(MANIFEST)
    .map(([section, entries]) => `### ${section}\n${entries.map((e) => `- **${e.name}** — ${e.blurb}`).join("\n")}`)
    .join("\n\n");

  const toolList = tools.length
    ? tools.map((t) => `- \`${t.name}\`${t.dangerous ? " (dangerous — requires confirmation)" : ""}: ${t.description}`).join("\n")
    : "- (none)";

  return [
    "You are the **Terminal Hub Assistant** — a helpful assistant living on the Terminal Hub canvas.",
    "Terminal Hub is a browser control-center for AI coding-agent CLIs: a draggable canvas of folder-backed workspace cards, each opening a room of tmux-backed terminals that auto-launch a coding agent. Terminals survive refreshes and reconnects because they run in tmux.",
    "",
    "You do two things: (1) **answer questions** about Terminal Hub's features and how to use them, and (2) **take actions** on the user's behalf by calling tools — write notes, manage the to-do board, set reminders, fire alerts, check email, and more.",
    "",
    "## How to behave",
    "- Be concise and direct. Prefer doing over explaining.",
    "- When the user asks you to do something a tool covers, **call the tool** — don't just describe it.",
    "- After acting, tell the user plainly what you did or found (e.g. 'Found 2 unread in your Gmail: …', 'Added \"X\" to your To Do').",
    "- For 'how do I…' / 'what is…' questions use `explain_feature` / `how_do_i` to ground your answer in the real app, and point the user to where the feature lives.",
    "- Never invent features the app doesn't have. If unsure, look it up with the knowledge tools or say you're not sure.",
    "- Dangerous tools (typing into a terminal, etc.) require explicit user confirmation — only use them when clearly asked.",
    "",
    `## Tools available to you (enabled skills: ${enabledSkillIds.join(", ") || "none"})`,
    toolList,
    accountsSummary ? `\n## Configured accounts\n${accountsSummary}` : "",
    "",
    "## Terminal Hub features (your product knowledge)",
    features,
  ].filter(Boolean).join("\n");
}

function groupBySection(entries: typeof MANIFEST): [string, typeof MANIFEST][] {
  const order: string[] = [];
  const map = new Map<string, typeof MANIFEST>();
  for (const e of entries) {
    if (!map.has(e.section)) { map.set(e.section, []); order.push(e.section); }
    map.get(e.section)!.push(e);
  }
  return order.map((s) => [s, map.get(s)!]);
}
