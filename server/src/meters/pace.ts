// Forward-looking usage pacing — the math behind the meter widgets' "Today" panel. Ported verbatim
// from TokenGauge (token-gauge/src/budget.js); shared by the Claude and Codex meters since both
// report weekly usage as a 0..100 % of the plan's weekly limit. Pure: no I/O, no DB — unit-tested.
//
//   today's budget = (what's LEFT of the week) / (days until the week resets)
//
// It only ever looks forward: a light day banks rollover (tomorrow's budget grows); a heavy day or
// being ahead tightens it. It never blames today for what earlier days spent — so a calm day stays
// calm even when the week as a whole is ahead. Separately it reports week posture (paceDelta +
// projection) so "you're trending past 100%" shows without the daily bar screaming on a light day.

export const WEEK_MINUTES = 7 * 24 * 60; // 10080
export const DEFAULT_PER_DAY = 100 / 7; // ~14.2857 — even split, the baseline reference

export type MeterLevel = "ok" | "warn" | "over";

export interface PaceResult {
  perDay: number;
  elapsedDays: number;
  daysLeft: number;
  remainingWeek: number;
  todayBudget: number;
  usedToday: number;
  todayRemaining: number;
  todayRatio: number;
  paceLine: number;
  paceDelta: number;
  projectedWeekEnd: number;
  level: MeterLevel;
  weekLevel: MeterLevel;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

// Baseline daily budget in %. A positive `override` pins a manual daily target; blank/0/invalid
// falls back to the auto 100/7 split.
export function dailyShare(override?: number | null): number {
  const v = Number(override);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_PER_DAY;
}

/** Core pacing computation. `weeklyPct`/`dayStartWeeklyPct` are 0..100; `weeklyResetMins` is the
 *  minutes until the weekly window resets; `warnRatio` (0..1) is how full today's budget gets before
 *  we warn (default .85). */
export function computePace(input: {
  weeklyPct: number;
  weeklyResetMins: number;
  dayStartWeeklyPct?: number;
  perDayOverride?: number | null;
  warnRatio?: number;
}): PaceResult {
  const { weeklyPct, weeklyResetMins, dayStartWeeklyPct = 0, perDayOverride = null, warnRatio = 0.85 } = input;

  const perDay = dailyShare(perDayOverride);
  const used = clamp(Number(weeklyPct) || 0, 0, 100);
  const dayStart = clamp(Number(dayStartWeeklyPct) || 0, 0, 100);

  const resetMin = clamp(Number(weeklyResetMins) || 0, 0, WEEK_MINUTES);
  const elapsedDays = (WEEK_MINUTES - resetMin) / 1440; // 0..7 continuous
  const daysLeft = resetMin / 1440; // 0..7 — literally the weekly reset countdown

  const remainingWeek = clamp(100 - used, 0, 100);

  // Forward-looking "today's budget": spread what's left across the days that remain. Floor daysLeft
  // so we don't divide by ~0 in the final hour and blow up.
  const daysLeftSafe = Math.max(daysLeft, 1 / 24); // >= ~1h
  const autoDaily = clamp(remainingWeek / daysLeftSafe, 0, 100);
  const override = Number(perDayOverride);
  const hasOverride = Number.isFinite(override) && override > 0;
  // A pinned daily target still can't exceed what's actually left this week.
  const todayBudget = hasOverride ? Math.min(override, remainingWeek) : autoDaily;

  const usedToday = Math.max(0, used - dayStart);
  const todayRemaining = todayBudget - usedToday;
  const todayRatio = todayBudget > 0 ? usedToday / todayBudget : 1.5;

  // Overall week posture (for the pace tag + week ring + footer projection).
  const paceLine = elapsedDays * perDay; // even-split "you should be at" line
  const paceDelta = used - paceLine; // + ahead (burning fast), - behind (banked)
  const projectedWeekEnd = elapsedDays > 0 ? (used / elapsedDays) * 7 : used;

  // Today's pressure — keyed ONLY on today's budget, so a light day never alarms even if the week is ahead.
  let level: MeterLevel = "ok";
  if (used >= 100 || todayBudget <= 0 || todayRatio >= 1) level = "over";
  else if (todayRatio >= warnRatio) level = "warn";

  // Week posture — are you trending past your weekly limit?
  let weekLevel: MeterLevel = "ok";
  if (projectedWeekEnd >= 100) weekLevel = "over";
  else if (projectedWeekEnd >= 90) weekLevel = "warn";

  return {
    perDay,
    elapsedDays,
    daysLeft,
    remainingWeek,
    todayBudget,
    usedToday,
    todayRemaining,
    todayRatio,
    paceLine,
    paceDelta,
    projectedWeekEnd,
    level,
    weekLevel,
  };
}
