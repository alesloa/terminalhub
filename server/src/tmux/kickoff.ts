import type { TmuxController } from "./controller.js";

/** Foreground commands that mean "still at the shell" — i.e. the auto-launched CLI hasn't started. */
const SHELLS = new Set(["zsh", "bash", "sh", "fish", "dash", "ksh", "tcsh", "csh",
  "powershell", "pwsh", "cmd"]);

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export interface KickoffOpts {
  pollMs?: number;    // gap between pane-command checks
  settleMs?: number;  // pause after the CLI appears, so its TUI finishes drawing its input box
  submitMs?: number;  // pause between typing the line and pressing Enter, so the CR submits (not newline)
  timeoutMs?: number; // give up after this long if no non-shell command ever appears
}

/**
 * Type a command into a freshly-launched terminal once its agent CLI is actually running.
 *
 * Used to kick off a Claude loop: the terminal launches `claude` via send-keys, then this waits
 * until the pane's foreground command is no longer the shell (claude/node is up) — a real readiness
 * signal, not a guessed delay — settles briefly so the TUI's input box has rendered, then sends the
 * `/loop …` or `/goal …` line + Enter. If the CLI never comes up (e.g. not installed) it gives up
 * without typing, so a stray slash command never lands at a bare shell prompt. Best-effort: any tmux
 * error (the session vanished) is swallowed.
 */
export async function runKickoff(
  tmux: Pick<TmuxController, "paneCommand" | "typeText" | "sendEnter">,
  session: string,
  command: string,
  opts: KickoffOpts = {},
): Promise<void> {
  const pollMs = opts.pollMs ?? 250;
  const settleMs = opts.settleMs ?? 1200;
  const submitMs = opts.submitMs ?? 300;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const deadline = Date.now() + timeoutMs;

  let launched = false;
  while (Date.now() < deadline) {
    let cmd = "";
    try { cmd = (await tmux.paneCommand(session)).toLowerCase(); } catch { /* session race — retry */ }
    if (cmd && !SHELLS.has(cmd)) { launched = true; break; }
    await delay(pollMs);
  }
  if (!launched) return; // CLI never started — don't type a slash command into the shell

  await delay(settleMs);
  try {
    // Type the line, then submit with a SEPARATE Enter after a beat. Claude Code's TUI treats a CR
    // that arrives in the same keystroke burst as the text as a soft-newline (the Shift+Enter case),
    // so the line would sit unsent; a standalone Enter a moment later is read as submit.
    await tmux.typeText(session, command);
    await delay(submitMs);
    await tmux.sendEnter(session);
  } catch { /* session gone — ignore */ }
}
