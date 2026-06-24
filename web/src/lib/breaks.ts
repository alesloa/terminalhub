import type { BreakSettings } from "../api/types";

// Mirrors DEFAULT_BREAKS in server/src/db/store.ts — off until opted in; an hourly 10-minute break
// with a 20-second heads-up, skippable, pausing while the tab is hidden. Seeds the ui store before
// the server settings hydrate.
export const DEFAULT_BREAK_SETTINGS: BreakSettings = {
  enabled: false,
  intervalMinutes: 60,
  durationMinutes: 10,
  pauseWhenHidden: true,
  preWarnSeconds: 20,
  allowSkip: true,
  speak: false,
};

// The break cycle anchor: epoch ms the next break is due. Per-machine (localStorage) so a browser
// refresh resumes mid-cycle instead of resetting the countdown. NOT server-synced — breaks are about
// the physical person at this screen. The timer (useBreakTimer) owns writes; the Breaks window reads
// it to show a live "next break in …" countdown.
export const BREAK_ANCHOR_KEY = "tr.breaks.nextAt";
export function writeBreakAnchor(at: number) {
  try { localStorage.setItem(BREAK_ANCHOR_KEY, String(Math.round(at))); } catch { /* private mode */ }
}
export function readBreakAnchor(): number | null {
  try { const n = Number(localStorage.getItem(BREAK_ANCHOR_KEY)); return Number.isFinite(n) && n > 0 ? n : null; } catch { return null; }
}
