import { create } from "zustand";

/** A running Quick Timer the top-bar countdown pill tracks. `fireAt` is epoch ms (the reminder's
 *  server-computed fire instant). These are the few one-off timers the user set from the Quick Timer
 *  window — kept here (and mirrored to localStorage) so the countdown survives a refresh and only
 *  ever shows quick timers, not every calendar reminder. */
export interface ActiveTimer { id: string; title: string; fireAt: number }

const KEY = "tr.activeTimers";

function load(): ActiveTimer[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    const now = Date.now();
    // Drop any that already fired while the tab was closed — the notification went out server-side.
    return arr.filter((t): t is ActiveTimer =>
      t && typeof t.id === "string" && typeof t.title === "string" && typeof t.fireAt === "number" && t.fireAt > now);
  } catch { return []; }
}
function save(timers: ActiveTimer[]) {
  try { localStorage.setItem(KEY, JSON.stringify(timers)); } catch { /* private mode */ }
}

interface TimersState {
  timers: ActiveTimer[];
  addTimer(t: ActiveTimer): void;     // register a freshly-set quick timer
  removeTimer(id: string): void;      // drop one (it fired, or was cleared)
}

export const useTimers = create<TimersState>((set) => ({
  timers: load(),
  addTimer: (t) => set((s) => {
    const next = [...s.timers.filter((x) => x.id !== t.id), t];
    save(next);
    return { timers: next };
  }),
  removeTimer: (id) => set((s) => {
    if (!s.timers.some((t) => t.id === id)) return s;
    const next = s.timers.filter((t) => t.id !== id);
    save(next);
    return { timers: next };
  }),
}));
