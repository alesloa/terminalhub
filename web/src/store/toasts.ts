import { create } from "zustand";

/** A toast may carry a target so clicking it opens that workspace's room and selects the
 *  terminal that fired it. `title` is a small label (e.g. an agent name); `level` colors the chip.
 *  `notifId` links it to the persisted server notification: dismissing or clicking the toast deletes
 *  that row (you handled it), letting it timeout instead keeps it in the notification center as
 *  history — and a cross-browser "removed" broadcast drops the toast here by this id too.
 *  `leaving` is set while the slide-out animation plays, just before the toast is removed. */
export type ToastLevel = "info" | "success" | "warn" | "error";
/** An optional button on a toast (e.g. "Force Push" on a diverged-push error). In-memory only — the
 *  callback can't be persisted/broadcast, so action toasts are ephemeral UI toasts (no notifId). */
export interface ToastAction { label: string; onClick: () => void }
export interface Toast { id: string; text: string; title?: string; level?: ToastLevel; notifId?: string; workspaceId?: string; terminalId?: string; imageUrl?: string; action?: ToastAction; leaving?: boolean }

interface ToastState {
  toasts: Toast[];
  push(text: string, opts?: { workspaceId?: string; terminalId?: string; sticky?: boolean; ttl?: number; title?: string; level?: ToastLevel; notifId?: string; imageUrl?: string; action?: ToastAction }): void;
  dismiss(id: string): void;
  dismissByNotif(notifId: string): void;
}

let seq = 0;
const TTL = 10000;   // ms a (non-sticky) toast stays before it auto-dismisses
const EXIT_MS = 260; // ms the slide-out animation runs before the toast is actually removed

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (text, opts) => {
    const id = `toast_${++seq}`;
    const { sticky, ttl, ...target } = opts ?? {};
    set((s) => ({ toasts: [...s.toasts, { id, text, ...target }] }));
    // Auto-dismiss after the TTL (overridable per-push). A timed-out agent toast just slides away —
    // its persisted server notification stays in the center as history (you ignored it). The ✕ / a
    // click delete that row instead (handled in the Toaster). Sticky toasts never time out.
    if (!sticky) setTimeout(() => get().dismiss(id), ttl ?? TTL);
  },
  // Two-phase removal: flag the toast `leaving` so the Toaster plays the exit animation, then drop
  // it once that animation has run. Calling dismiss twice is harmless (re-flags + re-schedules).
  dismiss: (id) => {
    set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)) }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), EXIT_MS);
  },
  // A cross-browser "removed" broadcast (another browser dismissed/cleared it, or its terminal was
  // viewed) drops the matching toast here too, by its persisted notification id.
  dismissByNotif: (notifId) => {
    for (const t of get().toasts) if (t.notifId === notifId) get().dismiss(t.id);
  },
}));
