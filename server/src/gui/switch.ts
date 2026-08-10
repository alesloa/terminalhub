import type { Terminal, TerminalMode } from "../types.js";
import type { TmuxController } from "../tmux/controller.js";
import { resolveTerminalSession } from "../claude/terminalLink.js";
import { computeSessionState } from "../claude/activity.js";
import { transcriptPathFor } from "./history.js";

// Moving one terminal between the tmux pane and the GUI chat.
//
// The rule that makes this safe: exactly ONE live Claude per conversation. Two processes holding the
// same session id would both append to the same transcript and corrupt it. So a switch is a handoff
// — stop the agent on the side being left, start it on the side being entered, both pointed at the
// same session id.
//
// The tmux session itself is never killed. Only the `claude` process inside it exits, leaving the
// pane at a shell, so switching back is a `send-keys` away and everything else in the app that
// reads the pane (cwd, previews, process tree) keeps working.

/** Keys that quit an interactive Claude Code TUI: cancel anything in flight, then EOF the prompt. */
const QUIT_KEYS = ["C-c", "C-c", "C-d"] as const;

export interface SwitchDeps {
  tmux: TmuxController;
  /** Stop the GUI-side agent for this terminal, if one is running. */
  stopGui: (terminalId: string) => Promise<void>;
  /** Persist the new mode. */
  setMode: (terminalId: string, mode: TerminalMode) => void;
  /** Persist the resolved Claude session id. */
  setAgentSession: (terminalId: string, sessionId: string | null) => void;
}

export interface SwitchResult {
  mode: TerminalMode;
  sessionId: string | null;
}

export class SwitchBlocked extends Error {}

/** The launch line used to put a Claude session back into a tmux pane. Must stay parseable by
 *  `sessionLinkFromLaunch` in claude/terminalLink.ts, which is what re-binds the pane to the
 *  session afterwards — change the shape here and the link silently stops matching. */
export function resumeCommand(sessionId: string): string {
  return `claude --model "opus[1m]" --resume ${sessionId}`;
}

/**
 * tmux → gui. Detects which Claude session the pane is running, refuses while a turn is in flight
 * (quitting mid-turn would strand the work), quits the agent in the pane, and flips the mode.
 * Returns the session id the GUI should resume, or null for a pane that had no agent running —
 * in which case the GUI simply starts a fresh conversation in the same folder.
 */
export async function switchToGui(
  term: Terminal, folder: string, deps: SwitchDeps,
): Promise<SwitchResult> {
  const link = await resolveTerminalSession(term, folder, (name) => deps.tmux.panePid(name));
  const sessionId = link?.agent === "claude" ? link.sessionId : null;

  if (sessionId) {
    const transcript = await transcriptPathFor(sessionId, folder);
    // Mid-turn means the agent is actively working. Killing it now loses that work with no way to
    // recover it, so make the user interrupt or wait rather than deciding for them.
    if (transcript && (await computeSessionState(transcript)) === "active") {
      throw new SwitchBlocked("Claude is still working in this terminal. Interrupt it or wait, then switch.");
    }
  }

  // Only send quit keys when something is actually running — otherwise C-d would close the pane's
  // shell, which is the one thing this handoff must never do.
  if (link) {
    for (const key of QUIT_KEYS) await deps.tmux.sendKey(term.tmuxSession, key);
  }

  deps.setAgentSession(term.id, sessionId);
  deps.setMode(term.id, "gui");
  return { mode: "gui", sessionId };
}

/**
 * gui → tmux. Stops the SDK-backed agent, then types into the pane that was waiting at a shell the
 * whole time: the resume command when there's a conversation to carry over, otherwise a fresh
 * `launchCommand` — a GUI terminal that was never prompted has nothing to resume, and dropping the
 * user at a bare shell would make the switch look broken.
 */
export async function switchToTmux(
  term: Terminal, launchCommand: string, deps: SwitchDeps,
): Promise<SwitchResult> {
  // Stop first and await it: the child must have released the session before the pane re-opens it.
  await deps.stopGui(term.id);

  const sessionId = term.agentSessionId;
  const command = sessionId ? resumeCommand(sessionId) : launchCommand.trim();
  if (command) await deps.tmux.sendKeys(term.tmuxSession, command);

  deps.setMode(term.id, "tmux");
  return { mode: "tmux", sessionId };
}
