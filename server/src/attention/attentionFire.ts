import type { Store } from "../db/store.js";
import type { PendingNotifier } from "../notify/pending.js";
import { agentBinaries, effectiveLaunch, isAgentTerminal } from "../activity/working.js";

// Fire a "needs attention" notification for a terminal whose agent rang the bell while its pane was
// NOT focused. This is the case the bell-flag watcher (attention/attentionWatcher.ts) is blind to:
// when a room is open, its active terminal has a live PTY attach, and an attached client clears
// tmux's window_bell_flag — so the watcher's flag poll never sees the bell. The browser still
// receives the bell byte through that attach (xterm's onBell) and, when you're not actually in the
// pane (no green focus bar / another room/space/tab/app), pings us here to fire the same toast you'd
// get if the room were closed. Detached terminals keep going through the flag watcher instead — the
// two paths partition cleanly by attach state, so they never double-fire for one bell.
//
// A short per-terminal cooldown collapses duplicates: several open browsers each ping on the same
// bell, and one finish can emit a quick burst of bells — both should be one notification.

const COOLDOWN_MS = 4000;

export interface AttentionFirer {
  /** Fire a needs-attention notification for this terminal. An optional `message` (carried by an OSC
   *  notify sequence) becomes the toast text; otherwise it falls back to "needs attention · <ws>".
   *  Returns false if deduped (within the cooldown) or the terminal is unknown. */
  fire(terminalId: string, message?: string): boolean;
}

export function createAttentionFirer(deps: {
  store: Pick<Store, "getTerminal" | "getWorkspace" | "listCustomAgents">;
  pending: Pick<PendingNotifier, "fire">;
  cooldownMs?: number;
  now?: () => number;
}): AttentionFirer {
  const { store, pending } = deps;
  const cooldownMs = deps.cooldownMs ?? COOLDOWN_MS;
  const now = deps.now ?? (() => Date.now());
  const lastFired = new Map<string, number>(); // terminalId → last fire time (cooldown gate)

  return {
    fire(terminalId, message) {
      const term = store.getTerminal(terminalId);
      if (!term) return false;

      // Only AI-agent sessions notify — a plain shell or dev-server terminal ringing the bell or going
      // quiet must never fire (same agent test as the attention list / working indicator).
      const ws = store.getWorkspace(term.workspaceId);
      if (!isAgentTerminal(effectiveLaunch(term, ws), agentBinaries(store.listCustomAgents()))) return false;

      const t = now();
      const prev = lastFired.get(terminalId);
      if (prev !== undefined && t - prev < cooldownMs) return false;
      lastFired.set(terminalId, t);

      const wsName = ws?.name ?? "";
      const msg = message?.trim();
      pending.fire({
        title: term.title || "Terminal",
        text: msg || (wsName ? `needs attention · ${wsName}` : "needs attention"),
        level: "info",
        category: "agent",
        source: "attention",
        speak: true,
        workspaceId: term.workspaceId,
        terminalId: term.id,
      });
      return true;
    },
  };
}
