import type { PendingNotifier } from "../notify/pending.js";
import type { AttentionItem } from "./attention.js";

// Server-side watcher that turns "an agent rang the bell while you weren't looking" into a single,
// cross-browser agent notification — the server is the one firing authority, so two open browsers see
// ONE shared toast, not a duplicate each. A polling ticker mirroring the reminder scheduler:
//   • a terminal NEWLY ringing → fire a *pending* notification (a toast everywhere) — it persists to
//     the center only if you ignore it for the grace window (see notify/pending.ts).
//   • a terminal that STOPPED ringing (bell cleared = you opened/viewed it) → resolve it: cancel the
//     pending persist + drop the toast everywhere, so viewing the terminal handles it like a click.
// The first tick after boot only records what's already ringing (pre-existing bells aren't toasted).

const DEFAULT_INTERVAL_MS = 3000;

export interface AttentionWatcher {
  tick(): Promise<void>;  // one diff pass (also used once at boot to seed)
  start(): void;
  stop(): void;
}

export interface AttentionWatcherDeps {
  // How to read the current attention list. Composition passes a tmux-backed reader; tests pass a fake.
  getAttention: () => Promise<AttentionItem[]>;
  pending: Pick<PendingNotifier, "fire" | "resolve">;
  intervalMs?: number;
}

export function createAttentionWatcher(deps: AttentionWatcherDeps): AttentionWatcher {
  const { getAttention, pending } = deps;
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;

  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false; // never let a slow tmux read overlap with the next interval
  let seeded = false;
  // terminalId → the notification id we created for its current bell (null = seeded at boot, i.e. it
  // was already ringing before we started watching, so there's nothing of ours to resolve).
  const active = new Map<string, string | null>();

  async function tick() {
    if (running) return;
    running = true;
    try {
      const items = await getAttention();
      const current = new Map(items.map((i) => [i.terminalId, i]));

      // Boot seed: record what's already ringing, fire nothing (don't replay a backlog of bells).
      if (!seeded) {
        for (const tid of current.keys()) active.set(tid, null);
        seeded = true;
        return;
      }

      // Newly ringing → fire one pending agent notification (a toast now; persists if ignored).
      for (const [tid, i] of current) {
        if (active.has(tid)) continue;
        const title = i.title || "Terminal";
        const body = i.workspaceName ? `needs attention · ${i.workspaceName}` : "needs attention";
        active.set(tid, pending.fire({
          title, text: body, level: "info", category: "agent", source: "attention",
          speak: true, workspaceId: i.workspaceId, terminalId: i.terminalId,
        }));
      }

      // Stopped ringing (you opened/viewed the terminal) → resolve in time so it never reaches the
      // center (no-op if the grace window already lapsed and it persisted as history).
      for (const [tid, id] of active) {
        if (current.has(tid)) continue;
        if (id) pending.resolve(id);
        active.delete(tid);
      }
    } catch { /* a tmux hiccup must not kill the loop — try again next tick */ }
    finally { running = false; }
  }

  return {
    tick,
    start() { if (timer) return; timer = setInterval(() => { void tick(); }, intervalMs); },
    stop() { if (timer) { clearInterval(timer); timer = null; } },
  };
}
