// Enrich a raw usage poll (Claude or Codex) with the forward-looking pacing payload the meter
// widgets render. The raw poll (5h + weekly %, reset timestamps) is cached/single-flight upstream;
// this runs per request so the baseline rolls at local midnight and the pace numbers stay fresh even
// when the underlying poll is served from cache. Shared by both meter routes.

import { computePace, type PaceResult } from "./pace.js";
import { rollBaselines, type MeterAgent, type MeterBaselineStore } from "./baseline.js";

interface UsageWindow { pct: number; resetsAt: string | null }
interface AvailableUsage { available: true; session: UsageWindow; weekly: UsageWindow }
type RawUsage = AvailableUsage | { available: false; reason: string };

export interface DecoratedUsage {
  at: number;               // epoch-ms the pace was computed (drives the "updated HH:MM" footer)
  sessionResetMins: number; // minutes until the 5-hour window resets
  weeklyResetMins: number;  // minutes until the weekly window resets
  pace: PaceResult;
}

/** Minutes from now until an ISO reset timestamp; 0 if absent/elapsed. */
export function minsUntil(resetsAt: string | null, nowMs: number): number {
  if (!resetsAt) return 0;
  const t = Date.parse(resetsAt);
  if (!Number.isFinite(t)) return 0;
  const mins = Math.round((t - nowMs) / 60_000);
  return mins > 0 ? mins : 0;
}

/** Attach `at` + reset-minute countdowns + the computed pace to an available usage result. An
 *  unavailable result passes through untouched. */
export function decorateUsage<T extends RawUsage>(
  agent: MeterAgent,
  result: T,
  store: MeterBaselineStore,
  nowMs: number = Date.now(),
): T | (T & DecoratedUsage) {
  if (!result.available) return result;
  const weeklyResetMins = minsUntil(result.weekly.resetsAt, nowMs);
  const sessionResetMins = minsUntil(result.session.resetsAt, nowMs);
  const dayStartWeeklyPct = rollBaselines(store, agent, result.weekly.pct, weeklyResetMins, nowMs);
  const pace = computePace({ weeklyPct: result.weekly.pct, weeklyResetMins, dayStartWeeklyPct });
  return { ...result, at: nowMs, sessionResetMins, weeklyResetMins, pace };
}
