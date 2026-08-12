import { agentBinary, effectiveLaunch } from "../activity/working.js";
import type { Terminal, Workspace } from "../types.js";
import type { GuiAgent } from "./types.js";

// Which agent a GUI-mode terminal talks to.
//
// GUI mode is not a Claude feature any more: the same chat surface drives Claude Code through the
// Agent SDK or Codex through `codex app-server`. Which one a terminal gets is decided by the command
// it would have launched in its pane, so flipping a `codex` terminal into the chat gives you Codex —
// the surface changes, the agent doesn't.

export type { GuiAgent };

/** The agent a launch command runs, for GUI purposes. Anything that isn't recognisably Codex falls
 *  back to Claude: that is what GUI mode has always meant, and a plain shell has no agent of its own
 *  to honour. Mirrors the web's `agentIdForCommand` (web/src/lib/agents.ts). */
export function guiAgentForCommand(command: string | null | undefined): GuiAgent {
  return agentBinary(command ?? "").toLowerCase() === "codex" ? "codex" : "claude";
}

/** The agent for a terminal, honouring its per-terminal launch override over the workspace default. */
export function guiAgentFor(term: Terminal, ws: Workspace | undefined): GuiAgent {
  return guiAgentForCommand(effectiveLaunch(term, ws));
}
