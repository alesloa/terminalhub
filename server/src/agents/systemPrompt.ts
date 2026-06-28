// Layered agent system prompts. The effective prompt an agent launches with is built from up to
// three layers — a per-agent GLOBAL (settings), a per-WORKSPACE prompt, and a per-TERMINAL prompt —
// each with a toggle deciding whether it builds on the layers above or stands alone. See
// docs/superpowers/specs/2026-06-28-agent-system-prompts-design.md.

import { promises as fs } from "node:fs";
import path from "node:path";
import { applyManagedBlock, SYSTEM_PROMPT_MARKERS } from "../spaces/managedBlock.js";

export interface WorkspacePrompt {
  text: string;
  includeGlobal: boolean; // false = ignore the agent's global prompt, use this text alone
}

export interface TerminalPrompt {
  text: string;
  includeParent: boolean; // false = ignore global+workspace, use this text alone
}

/** Join the non-empty, trimmed parts with a blank line between them. */
function join(parts: string[]): string {
  return parts.map((p) => p.trim()).filter(Boolean).join("\n\n");
}

/**
 * Merge the three layers into the final system-prompt text.
 * - No overrides (ws and term both null) → the agent's global prompt.
 * - A blank layer contributes nothing.
 * - `ws.includeGlobal=false` → workspace text only. `term.includeParent=false` → terminal text only.
 * Result is trimmed; an empty string means "no prompt" (no injection downstream).
 */
export function resolveEffective(
  global: string,
  ws: WorkspacePrompt | null,
  term: TerminalPrompt | null,
): string {
  const wsBase = (ws?.includeGlobal ?? true) ? global : "";
  const wsEffective = join([wsBase, ws?.text ?? ""]);

  const termBase = (term?.includeParent ?? true) ? wsEffective : "";
  return join([termBase, term?.text ?? ""]);
}

// ── Injection ────────────────────────────────────────────────────────────────
// How the effective prompt reaches each agent. Only Claude has a native per-launch flag; the others
// read instruction FILES from the working folder, written non-destructively (own managed block / own
// file) so a user's hand-authored content is never clobbered.

export type Injection =
  | { kind: "flag"; args: string[] } // extra CLI args to append to the launch command
  | { kind: "file" }                 // a folder file was written/updated; no args
  | { kind: "none" };                // nothing injected (empty prompt or unknown agent)

type Strategy =
  | { kind: "flag" }                // claude → --append-system-prompt-file
  | { kind: "block"; file: string } // codex/gemini/opencode → managed block in a folder file
  | { kind: "rule" };               // cursor → own .cursor/rules/*.mdc

const STRATEGY: Record<string, Strategy> = {
  claude: { kind: "flag" },
  codex: { kind: "block", file: "AGENTS.md" },
  gemini: { kind: "block", file: "GEMINI.md" },
  opencode: { kind: "block", file: "AGENTS.md" },
  cursor: { kind: "rule" },
};

export interface InjectOpts {
  folder: string;     // the workspace folder the agent launches in
  tmpDir: string;     // Terminal Hub-owned dir for ephemeral claude prompt files
  terminalId: string; // names the per-terminal temp file
}

const CURSOR_RULE = path.join(".cursor", "rules", "terminalhub.mdc");

/**
 * Inject the effective system prompt for `agentId` and return how the launch command must change.
 * Empty `effective` removes any prior injection (temp file skipped, managed block stripped, cursor
 * rule deleted) so a cleared prompt never lingers. Unknown / null agent → no-op.
 */
export async function applySystemPrompt(
  agentId: string | null,
  effective: string,
  opts: InjectOpts,
): Promise<Injection> {
  const strat = agentId ? STRATEGY[agentId] : undefined;
  if (!strat) return { kind: "none" };
  const text = effective.trim();

  if (strat.kind === "flag") {
    if (!text) return { kind: "none" };
    await fs.mkdir(opts.tmpDir, { recursive: true });
    const file = path.join(opts.tmpDir, `${opts.terminalId}.md`);
    await fs.writeFile(file, text);
    return { kind: "flag", args: ["--append-system-prompt-file", file] };
  }

  if (strat.kind === "block") {
    const dest = path.join(opts.folder, strat.file);
    let existing: string | null = null;
    try { existing = await fs.readFile(dest, "utf8"); } catch { /* new file */ }
    const next = applyManagedBlock(existing, text, "append", SYSTEM_PROMPT_MARKERS);
    if (next !== (existing ?? "") && !(next === "" && existing == null)) {
      await fs.writeFile(dest, next);
    }
    return { kind: "file" };
  }

  // cursor: our own rule file — overwrite wholesale, or delete when the prompt is cleared.
  const dest = path.join(opts.folder, CURSOR_RULE);
  if (!text) {
    await fs.rm(dest, { force: true });
    return { kind: "file" };
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const frontmatter = "---\ndescription: Terminal Hub system prompt\nalwaysApply: true\n---\n";
  await fs.writeFile(dest, frontmatter + text + "\n");
  return { kind: "file" };
}
