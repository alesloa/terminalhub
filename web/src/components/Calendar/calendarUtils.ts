import type { Reminder, RecurrenceFreq } from "../../api/types";

// All calendar math runs in the VIEWER'S LOCAL ZONE. Reminders store an absolute epoch-ms instant;
// here we turn those into local Date objects to lay out on a grid, and turn the date/time pickers'
// local strings back into epoch ms on submit. Never persist a naive local datetime — only epoch ms.

export const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAYS_NARROW = ["S", "M", "T", "W", "T", "F", "S"];
export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const DAY_MS = 86_400_000;

export function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
export function endOfDay(d: Date): Date { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
export function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
export function endOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999); }
/** Sunday-start week (Apple's default), at 00:00 local. */
export function startOfWeek(d: Date): Date { const x = startOfDay(d); return addDays(x, -x.getDay()); }

/** Add `n` calendar months, clamping the day to the target month's length (Jan 31 + 1mo → Feb 28/29). */
export function addMonths(d: Date, n: number): Date {
  const day = d.getDate();
  const x = new Date(d.getFullYear(), d.getMonth() + n, 1, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
  const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
  x.setDate(Math.min(day, last));
  return x;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
export function isToday(d: Date): boolean { return isSameDay(d, new Date()); }
/** "YYYY-MM-DD" in local time — the key used to bucket events/holidays by day. */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The 6×7 grid of local Dates covering a month (leading/trailing days from adjacent months). */
export function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

// --- <input type="datetime-local"> / "date" round-tripping (all local) ---
/** epoch ms → "YYYY-MM-DDTHH:mm" for a datetime-local input. */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  return `${dateKey(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
/** "YYYY-MM-DDTHH:mm" (local) → epoch ms. */
export function fromLocalInput(value: string): number { return new Date(value).getTime(); }
/** epoch ms → "YYYY-MM-DD" for a date input. */
export function toLocalDate(ms: number): string { return dateKey(new Date(ms)); }
/** "YYYY-MM-DD" (local, midnight) → epoch ms. */
export function fromLocalDate(value: string): number { const [y, m, d] = value.split("-").map(Number); return new Date(y, m - 1, d).getTime(); }

export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
/** Compact "9 AM", "1:30 PM" — minutes dropped on the hour, for axis labels + chips. */
export function fmtHour(hour: number): string {
  const d = new Date(); d.setHours(hour, 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric" });
}
export function fmtDayLong(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

// --- recurrence expansion (DISPLAY ONLY) -------------------------------------------------------
// A reminder stores ONE row (its next fireAt). To paint a recurring series across the grid we expand
// it locally over the visible range. Stepping is calendar-based (keeps the same weekday/wall time):
// daily/weekly add days, monthly/yearly add months with day-clamp — mirroring the spirit of the
// server's scheduler/recurrence.ts. The authoritative fire is always server-side.

export interface Occurrence { reminder: Reminder; start: number; end: number | null }

const MAX_OCCURRENCES = 1000; // safety cap so a misconfigured rule can't spin forever

function stepDate(d: Date, freq: RecurrenceFreq, interval: number): Date {
  switch (freq) {
    case "daily": return addDays(d, interval);
    case "weekly": return addDays(d, 7 * interval);
    case "monthly": return addMonths(d, interval);
    case "yearly": return addMonths(d, 12 * interval);
  }
}

/** Every occurrence of `r` that intersects [rangeStart, rangeEnd] (epoch ms), recurrence-expanded. */
export function expandOccurrences(r: Reminder, rangeStart: number, rangeEnd: number): Occurrence[] {
  const span = r.endAt != null && r.endAt > r.fireAt ? r.endAt - r.fireAt : 0;
  const out: Occurrence[] = [];
  if (!r.recurrence) {
    if (r.fireAt <= rangeEnd && r.fireAt + span >= rangeStart) out.push({ reminder: r, start: r.fireAt, end: r.endAt });
    return out;
  }
  const { interval, until, count } = r.recurrence;
  const step = Math.max(1, interval);
  let cur = new Date(r.fireAt);
  let n = 0;
  for (let i = 0; i < MAX_OCCURRENCES; i++) {
    const start = cur.getTime();
    if (count != null && n >= count) break;
    if (until != null && start > until) break;
    if (start > rangeEnd) break;
    const end = span ? start + span : null;
    if (start + span >= rangeStart) out.push({ reminder: r, start, end });
    cur = stepDate(cur, r.recurrence.freq, step);
    n++;
  }
  return out;
}

/** All occurrences of every reminder across [rangeStart, rangeEnd], sorted by start. */
export function occurrencesInRange(reminders: Reminder[], rangeStart: number, rangeEnd: number): Occurrence[] {
  return reminders
    .flatMap((r) => expandOccurrences(r, rangeStart, rangeEnd))
    .sort((a, b) => a.start - b.start);
}
