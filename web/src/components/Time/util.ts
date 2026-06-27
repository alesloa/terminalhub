import { useEffect, useState } from "react";
import type { TimeEntry } from "../../api/types";

export const DAY_MS = 86_400_000;

/** A ticking clock: re-renders the caller every `ms` so running timers count up live. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Local midnight of the day containing `ts`. */
export function dayStart(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** [from,to) covering the local day of `ts`. */
export function dayRange(ts: number): { from: number; to: number } {
  const from = dayStart(ts);
  return { from, to: from + DAY_MS };
}

/** The seven local midnights of the week containing `ts`. weekStart: 1 = Monday, 0 = Sunday. */
export function weekDays(ts: number, weekStart: 0 | 1): number[] {
  const start = dayStart(ts);
  const dow = new Date(start).getDay(); // 0=Sun..6=Sat
  const back = weekStart === 1 ? (dow + 6) % 7 : dow;
  const monday = start - back * DAY_MS;
  return Array.from({ length: 7 }, (_, i) => monday + i * DAY_MS);
}

/** [from,to) covering the whole week containing `ts`. */
export function weekRange(ts: number, weekStart: 0 | 1): { from: number; to: number } {
  const days = weekDays(ts, weekStart);
  return { from: days[0], to: days[6] + DAY_MS };
}

/** The calendar-grid days for the month of `ts`: leading/trailing days padded to full weeks. */
export function monthGrid(ts: number, weekStart: 0 | 1): number[] {
  const d = new Date(ts);
  const first = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const dow = new Date(first).getDay();
  const back = weekStart === 1 ? (dow + 6) % 7 : dow;
  const gridStart = first - back * DAY_MS;
  return Array.from({ length: 42 }, (_, i) => gridStart + i * DAY_MS);
}

export function monthRange(ts: number): { from: number; to: number } {
  const d = new Date(ts);
  const from = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  return { from, to };
}

/** Seconds an entry has logged: stopped → fixed; running → counts up to `now`. */
export function entrySeconds(e: TimeEntry, now: number): number {
  return Math.max(0, Math.floor(((e.stoppedAt ?? now) - e.startedAt) / 1000));
}

/** H:MM:SS — for a single entry's elapsed time (ticks while running). */
export function fmtHMS(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** H:MM — Harvest-style totals (e.g. "4:12"). */
export function fmtHM(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** A clock time like "9:05 am" from an epoch ms. */
export function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** "Sat, 27 Jun" style label for a day. */
export function fmtDayLabel(ts: number): string {
  return new Date(ts).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

/** Sum logged seconds across entries (running included, counted to `now`). */
export function sumSeconds(entries: TimeEntry[], now: number): number {
  return entries.reduce((acc, e) => acc + entrySeconds(e, now), 0);
}

/** Entries that belong to the local day starting at `dayStartMs`. */
export function entriesForDay(entries: TimeEntry[], dayStartMs: number): TimeEntry[] {
  const end = dayStartMs + DAY_MS;
  return entries.filter((e) => e.startedAt >= dayStartMs && e.startedAt < end);
}

/** Build the `datetime-local` input value for an epoch ms in local time. */
export function toLocalInput(ts: number): string {
  const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

/** Parse a `datetime-local` value back to epoch ms (local). Returns null on empty. */
export function fromLocalInput(v: string): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}
