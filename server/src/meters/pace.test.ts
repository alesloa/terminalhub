import { describe, it, expect } from "vitest";
import { computePace, dailyShare, DEFAULT_PER_DAY } from "./pace.js";

// Ported from token-gauge/tests/budget.test.js — the proven pacing cases, run under vitest.
const near = (a: number, b: number, eps = 1e-3) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);

describe("dailyShare", () => {
  it("auto vs override", () => {
    near(dailyShare(null), DEFAULT_PER_DAY);
    near(dailyShare(0), DEFAULT_PER_DAY);
    near(dailyShare("garbage" as unknown as number), DEFAULT_PER_DAY);
    near(dailyShare(20), 20);
  });
});

describe("computePace", () => {
  it("fresh start of week is calm", () => {
    const r = computePace({ weeklyPct: 0, weeklyResetMins: 10080, dayStartWeeklyPct: 0 });
    near(r.daysLeft, 7);
    near(r.perDay, 14.2857);
    near(r.todayBudget, 14.2857);
    near(r.usedToday, 0);
    near(r.todayRatio, 0);
    near(r.paceDelta, 0);
    expect(r.level).toBe("ok");
    expect(r.weekLevel).toBe("ok");
  });

  it("under pace mid-week => bigger forward budget (rollover)", () => {
    const r = computePace({ weeklyPct: 10, weeklyResetMins: 6480, dayStartWeeklyPct: 8 });
    near(r.daysLeft, 4.5);
    near(r.todayBudget, 20);
    near(r.usedToday, 2);
    near(r.todayRemaining, 18);
    near(r.paceDelta, -25.714);
    near(r.projectedWeekEnd, 28);
    expect(r.level).toBe("ok");
    expect(r.weekLevel).toBe("ok");
  });

  it("overspent earlier weeks shrinks the budget, but a LIGHT day stays calm", () => {
    const r = computePace({ weeklyPct: 58, weeklyResetMins: 5040, dayStartWeeklyPct: 56 });
    near(r.daysLeft, 3.5);
    near(r.todayBudget, 12);
    near(r.usedToday, 2);
    expect(r.todayRatio).toBeLessThan(0.85);
    expect(r.level).toBe("ok");
    near(r.paceDelta, 8);
    near(r.projectedWeekEnd, 116);
    expect(r.weekLevel).toBe("over");
  });

  it("blowing through today's budget => over", () => {
    const r = computePace({ weeklyPct: 30, weeklyResetMins: 7920, dayStartWeeklyPct: 12 });
    near(r.usedToday, 18);
    near(r.todayBudget, 12.727);
    expect(r.todayRatio).toBeGreaterThanOrEqual(1);
    expect(r.todayRemaining).toBeLessThan(0);
    expect(r.level).toBe("over");
  });

  it("approaching today's budget => warn", () => {
    const r = computePace({ weeklyPct: 24, weeklyResetMins: 7920, dayStartWeeklyPct: 12 });
    near(r.usedToday, 12);
    near(r.todayBudget, 13.818);
    expect(r.todayRatio).toBeGreaterThanOrEqual(0.85);
    expect(r.todayRatio).toBeLessThan(1);
    expect(r.level).toBe("warn");
  });

  it("manual override pins the daily budget", () => {
    const r = computePace({ weeklyPct: 0, weeklyResetMins: 10080, dayStartWeeklyPct: 0, perDayOverride: 20 });
    near(r.perDay, 20);
    near(r.todayBudget, 20);
  });

  it("manual override never exceeds what is left this week", () => {
    const r = computePace({ weeklyPct: 95, weeklyResetMins: 5040, dayStartWeeklyPct: 80, perDayOverride: 20 });
    near(r.todayBudget, 5);
  });

  it("weekly near max is always over", () => {
    const r = computePace({ weeklyPct: 96, weeklyResetMins: 5040, dayStartWeeklyPct: 80 });
    expect(r.level).toBe("over");
    expect(r.weekLevel).toBe("over");
  });

  it("near the weekly reset the budget stays finite and sane", () => {
    const r = computePace({ weeklyPct: 50, weeklyResetMins: 10, dayStartWeeklyPct: 49 });
    expect(Number.isFinite(r.todayBudget)).toBe(true);
    expect(r.todayBudget).toBeLessThanOrEqual(100);
    near(r.usedToday, 1);
    expect(r.level).toBe("ok");
  });
});
