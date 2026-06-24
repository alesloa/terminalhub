// Daily pacing baselines — the persisted half of the meter's "used today" math (TokenGauge model,
// ported from token-gauge/src/config.js rollBaselines). The weekly % is captured at the START of each
// local day and stored per agent ("claude" | "codex"), so "used today" = current weekly % − that
// baseline survives restarts. The week is identified by the day its 7-day window resets; when that
// flips, the baseline restarts for the new week. State lives in SQLite (meter_baselines) so it's
// shared across browser tabs and survives reboots — the server is the single source of truth.

import type { MeterBaseline } from "../types.js";

export type MeterAgent = "claude" | "codex";

/** The slice of the store this module needs — keeps it unit-testable with a fake. */
export interface MeterBaselineStore {
  getMeterBaseline(agent: string): MeterBaseline | null;
  saveMeterBaseline(agent: string, b: MeterBaseline): void;
}

// LOCAL calendar day (NOT UTC): getFullYear/getMonth/getDate are local-time getters, so "today"
// flips at the machine's local midnight, not 00:00 UTC.
export function localDayKey(nowMs: number): string {
  const d = new Date(nowMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// The day (in epoch-days) on which the current weekly window resets — stable across polls, flips when
// a new week begins.
export function weekKeyFromReset(weeklyResetMins: number, nowMs: number): number {
  const nowSec = nowMs / 1000;
  return Math.floor((nowSec + (Number(weeklyResetMins) || 0) * 60) / 86400);
}

/** Given a fresh weekly reading, roll the daily/weekly baseline forward and return the weekly % to
 *  treat as "start of today". Writes back only when something actually changed. */
export function rollBaselines(
  store: MeterBaselineStore,
  agent: MeterAgent,
  weeklyPct: number,
  weeklyResetMins: number,
  nowMs: number,
): number {
  const today = localDayKey(nowMs);
  const wk = weekKeyFromReset(weeklyResetMins, nowMs);
  const st: MeterBaseline = store.getMeterBaseline(agent) ?? { weekKey: null, dayKey: null, dayStartWeeklyPct: 0 };
  let changed = false;

  if (st.weekKey !== wk) {
    // New week: the weekly counter just reset — start fresh from the current value.
    st.weekKey = wk;
    st.dayKey = today;
    st.dayStartWeeklyPct = weeklyPct;
    changed = true;
  } else if (st.dayKey !== today) {
    // New day, same week: begin measuring "used today" from the current count.
    st.dayKey = today;
    st.dayStartWeeklyPct = weeklyPct;
    changed = true;
  } else if (weeklyPct < st.dayStartWeeklyPct) {
    // Counter dropped mid-day (partial reset / clock skew): keep the baseline sane.
    st.dayStartWeeklyPct = weeklyPct;
    changed = true;
  }

  if (changed) store.saveMeterBaseline(agent, st);
  return st.dayStartWeeklyPct;
}
