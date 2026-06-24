import { describe, it, expect } from "vitest";
import { rollBaselines, localDayKey, weekKeyFromReset, type MeterBaselineStore } from "./baseline.js";
import type { MeterBaseline } from "../types.js";

function fakeStore(initial: Record<string, MeterBaseline> = {}): MeterBaselineStore & { rows: Record<string, MeterBaseline> } {
  const rows = { ...initial };
  return {
    rows,
    getMeterBaseline: (agent) => rows[agent] ?? null,
    saveMeterBaseline: (agent, b) => { rows[agent] = { ...b }; },
  };
}

// A fixed local noon so the test is timezone-stable (same calendar day regardless of offset).
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0).getTime();
const WEEK = 10080;

describe("rollBaselines", () => {
  it("first poll seeds the baseline at the current weekly %", () => {
    const store = fakeStore();
    const ds = rollBaselines(store, "claude", 40, WEEK, day(2026, 6, 14));
    expect(ds).toBe(40);
    expect(store.rows.claude.dayStartWeeklyPct).toBe(40);
  });

  it("same day, same week, rising usage keeps the original baseline", () => {
    const store = fakeStore();
    rollBaselines(store, "claude", 40, 5040, day(2026, 6, 14));
    const ds = rollBaselines(store, "claude", 47, 5040, day(2026, 6, 14)); // later same day
    expect(ds).toBe(40); // usedToday would be 7
  });

  it("a new local day re-baselines at the current weekly %", () => {
    const store = fakeStore();
    rollBaselines(store, "claude", 40, 5040, day(2026, 6, 14));
    const ds = rollBaselines(store, "claude", 52, 4000, day(2026, 6, 15));
    expect(ds).toBe(52); // today starts fresh
  });

  it("a new week (reset day flips) re-baselines even on the same calendar day", () => {
    const store = fakeStore();
    // Week resets ~3.5 days out.
    rollBaselines(store, "claude", 80, 5040, day(2026, 6, 14));
    // Same calendar day but the weekly window just reset (reset now ~7 days out) → new weekKey.
    const ds = rollBaselines(store, "claude", 3, WEEK, day(2026, 6, 14));
    expect(ds).toBe(3);
  });

  it("a mid-day counter drop lowers the baseline (clock skew / partial reset)", () => {
    const store = fakeStore();
    rollBaselines(store, "claude", 40, 5040, day(2026, 6, 14));
    const ds = rollBaselines(store, "claude", 30, 5040, day(2026, 6, 14));
    expect(ds).toBe(30);
  });

  it("agents keep independent baselines", () => {
    const store = fakeStore();
    rollBaselines(store, "claude", 40, WEEK, day(2026, 6, 14));
    rollBaselines(store, "codex", 12, WEEK, day(2026, 6, 14));
    expect(store.rows.claude.dayStartWeeklyPct).toBe(40);
    expect(store.rows.codex.dayStartWeeklyPct).toBe(12);
  });

  it("localDayKey + weekKeyFromReset are stable across same-day polls", () => {
    expect(localDayKey(day(2026, 6, 14))).toBe(localDayKey(day(2026, 6, 14) + 3_600_000));
    const a = weekKeyFromReset(5040, day(2026, 6, 14));
    const b = weekKeyFromReset(5040 - 60, day(2026, 6, 14) + 3_600_000); // 1h later, reset 1h closer
    expect(a).toBe(b);
  });
});
