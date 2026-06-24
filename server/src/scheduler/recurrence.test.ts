import { describe, it, expect } from "vitest";
import { computeNextOccurrence } from "./recurrence.js";
import type { Recurrence } from "../types.js";

const rule = (over: Partial<Recurrence>): Recurrence => ({ freq: "daily", interval: 1, until: null, count: null, ...over });

describe("computeNextOccurrence", () => {
  it("advances daily by interval days (exact 24h steps)", () => {
    const from = Date.UTC(2026, 5, 13, 9, 0, 0);
    expect(computeNextOccurrence(rule({ freq: "daily", interval: 1 }), from)).toBe(Date.UTC(2026, 5, 14, 9, 0, 0));
    expect(computeNextOccurrence(rule({ freq: "daily", interval: 3 }), from)).toBe(Date.UTC(2026, 5, 16, 9, 0, 0));
  });

  it("advances weekly by interval weeks", () => {
    const from = Date.UTC(2026, 5, 13, 9, 0, 0);
    expect(computeNextOccurrence(rule({ freq: "weekly", interval: 1 }), from)).toBe(Date.UTC(2026, 5, 20, 9, 0, 0));
    expect(computeNextOccurrence(rule({ freq: "weekly", interval: 2 }), from)).toBe(Date.UTC(2026, 5, 27, 9, 0, 0));
  });

  it("advances monthly keeping the day-of-month and time-of-day", () => {
    const from = Date.UTC(2026, 0, 15, 9, 30, 0);
    expect(computeNextOccurrence(rule({ freq: "monthly", interval: 1 }), from)).toBe(Date.UTC(2026, 1, 15, 9, 30, 0));
  });

  it("clamps a too-long day to the target month's last day (Jan 31 -> Feb 28)", () => {
    const from = Date.UTC(2026, 0, 31, 9, 0, 0); // 2026 is not a leap year
    expect(computeNextOccurrence(rule({ freq: "monthly", interval: 1 }), from)).toBe(Date.UTC(2026, 1, 28, 9, 0, 0));
  });

  it("rolls monthly across the year boundary (Dec -> Jan next year)", () => {
    const from = Date.UTC(2026, 11, 15, 9, 0, 0);
    expect(computeNextOccurrence(rule({ freq: "monthly", interval: 1 }), from)).toBe(Date.UTC(2027, 0, 15, 9, 0, 0));
  });

  it("advances yearly and clamps Feb 29 -> Feb 28 on a non-leap year", () => {
    const from = Date.UTC(2024, 1, 29, 9, 0, 0); // leap day
    expect(computeNextOccurrence(rule({ freq: "yearly", interval: 1 }), from)).toBe(Date.UTC(2025, 1, 28, 9, 0, 0));
  });

  it("returns null when the next occurrence would pass `until`", () => {
    const from = Date.UTC(2026, 5, 13, 9, 0, 0);
    const justBeforeNext = Date.UTC(2026, 5, 14, 8, 0, 0);
    expect(computeNextOccurrence(rule({ freq: "daily", interval: 1, until: justBeforeNext }), from)).toBeNull();
  });

  it("returns the next occurrence when it lands on or before `until`", () => {
    const from = Date.UTC(2026, 5, 13, 9, 0, 0);
    const next = Date.UTC(2026, 5, 14, 9, 0, 0);
    expect(computeNextOccurrence(rule({ freq: "daily", interval: 1, until: next }), from)).toBe(next);
  });
});
