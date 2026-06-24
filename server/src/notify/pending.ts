import type { Store } from "../db/store.js";
import type { NotifyBus, NotifyLevel, NotifyCategory, NotifySource } from "./bus.js";

// Agent notifications (an agent finishing a terminal, or a /api/notify message) are shown as a toast
// FIRST and only land in the persistent notification center if you IGNORE them. Each one is held
// "pending" for a grace window: handle the toast in time — click / ✕ it, or open the terminal —
// and it's resolved (never persisted, and dropped from every other browser's toast). Let the window
// lapse (nobody was watching) and it's written to the center as history, so it's there when you get
// back to the computer — even if no browser was open when it fired (the timer lives here, server-side).
// Reminders skip this entirely: a scheduled event is always recorded, so the scheduler persists at fire.

const DEFAULT_DELAY_MS = 10000; // mirror the client toast TTL (web/src/store/toasts.ts)

export interface PendingInput {
  title?: string; text: string; level: NotifyLevel; category: NotifyCategory; source: NotifySource;
  speak: boolean; voice?: string; workspaceId?: string; terminalId?: string; imageUrl?: string;
}

export interface PendingNotifier {
  fire(input: PendingInput): string;   // show it as a toast now; persist it later UNLESS resolved first
  resolve(id: string): boolean;        // handled in time → cancel persistence + drop the toast everywhere
  stop(): void;                        // cancel all outstanding timers (shutdown / tests)
}

export function createPendingNotifier(deps: { store: Store; notify: NotifyBus; delayMs?: number }): PendingNotifier {
  const { store, notify } = deps;
  const delayMs = deps.delayMs ?? DEFAULT_DELAY_MS;
  let seq = 0;
  const pending = new Map<string, ReturnType<typeof setTimeout>>(); // id → its grace-window timer

  function persist(id: string, input: PendingInput) {
    if (!pending.has(id)) return; // resolved in the meantime
    pending.delete(id);
    store.createNotification({
      title: input.title ?? "", body: input.text, level: input.level, category: input.category,
      workspaceId: input.workspaceId ?? null, terminalId: input.terminalId ?? null,
    });
    notify.emit({ type: "changed" }); // the toast has timed out by now — refresh the center + badge
  }

  return {
    fire(input) {
      const id = `pn_${Date.now().toString(36)}${(seq++).toString(36)}`;
      notify.publish({ id, ts: Date.now(), ...input }); // toast everywhere, carrying this pending id
      pending.set(id, setTimeout(() => persist(id, input), delayMs));
      return id;
    },
    resolve(id) {
      const timer = pending.get(id);
      if (!timer) return false; // already persisted / unknown — nothing to cancel
      clearTimeout(timer);
      pending.delete(id);
      notify.emit({ type: "removed", id }); // drop the toast in every browser; it never reaches the center
      return true;
    },
    stop() { for (const t of pending.values()) clearTimeout(t); pending.clear(); },
  };
}
