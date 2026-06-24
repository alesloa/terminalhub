import type { AgentType } from "./types.js";
import { detectSessionForPid } from "./terminalDetect.js";

// Two-way name sync between a Terminal (DB row) and the coding-agent Session running inside it.
// They're separate entities — a terminal lives in SQLite, a session is a JSONL transcript under
// ~/.claude — so "rename one, rename both" needs a link between them. There are two ways to bind a
// terminal to a session id:
//   1. launch command — a terminal resumed from the Sessions panel carries `claude … --resume <id>`
//      or `codex resume <id>` (incl. the `headroom wrap …` variants). Cheap, stored, both agents.
//   2. live PID detection — a FRESH `claude` terminal gets a brand-new session id at runtime; we
//      find it by matching the pane's process tree against ~/.claude/sessions PID files. Claude only
//      (Codex writes no PID files), so a fresh Codex terminal can't be auto-linked.

export interface SessionLink { agent: AgentType; sessionId: string; }

/** Parse the resume session id out of a terminal's launch command. Matches both agents and the
 *  `headroom wrap …` wrappers. Returns null for a non-resume launch (a fresh `claude`/`codex`). */
export function sessionLinkFromLaunch(cmd: string | null | undefined): SessionLink | null {
  if (!cmd) return null;
  const claude = cmd.match(/\bclaude\b.*?--resume\s+(\S+)/i);
  if (claude) return { agent: "claude", sessionId: claude[1] };
  const codex = cmd.match(/\bcodex\b\s+resume\s+(\S+)/i);
  if (codex) return { agent: "codex", sessionId: codex[1] };
  return null;
}

/** Resolve the session a terminal is bound to: launch command first (cheap, both agents), then live
 *  PID detection (Claude-only). Returns null when nothing is detectable (e.g. a fresh Codex). */
export async function resolveTerminalSession(
  term: { tmuxSession: string; launchCommandOverride: string | null },
  folder: string,
  panePid: (name: string) => Promise<number | undefined>,
): Promise<SessionLink | null> {
  const fromLaunch = sessionLinkFromLaunch(term.launchCommandOverride);
  if (fromLaunch) return fromLaunch;
  const sessionId = await detectSessionForPid(await panePid(term.tmuxSession), undefined, folder);
  return sessionId ? { agent: "claude", sessionId } : null;
}

/** Of the candidate terminals (already scoped to the session's folder), the ones running `link`'s
 *  session. Launch-command matches are free; only the unmatched Claude terminals fall back to a PID
 *  walk (Codex can't be PID-detected, so Codex matching is launch-command-only). */
export async function terminalsRunningSession<T extends { tmuxSession: string; launchCommandOverride: string | null }>(
  link: SessionLink,
  candidates: T[],
  folder: string,
  panePid: (name: string) => Promise<number | undefined>,
): Promise<T[]> {
  const matched: T[] = [];
  const unmatched: T[] = [];
  for (const t of candidates) {
    const fromLaunch = sessionLinkFromLaunch(t.launchCommandOverride);
    if (fromLaunch && fromLaunch.agent === link.agent && fromLaunch.sessionId === link.sessionId) matched.push(t);
    else unmatched.push(t);
  }
  if (link.agent === "claude") {
    for (const t of unmatched) {
      const sessionId = await detectSessionForPid(await panePid(t.tmuxSession), undefined, folder);
      if (sessionId === link.sessionId) matched.push(t);
    }
  }
  return matched;
}
