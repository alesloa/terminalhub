import type { Recurrence } from "../types.js";

const DAY_MS = 86_400_000;

// Add `months` calendar months to an epoch-ms instant, in UTC, clamping the day-of-month to the
// target month's length (Jan 31 + 1mo -> Feb 28) and preserving the time-of-day. UTC math keeps it
// deterministic regardless of the server's timezone — `fireAt` is an absolute instant, not local.
function addMonthsUTC(from: number, months: number): number {
  const d = new Date(from);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const day = d.getUTCDate();
  // Date.UTC(y, m+1, 0) = the last day of month m (month overflow normalizes the year), so its
  // date component is the number of days in that month.
  const daysInTargetMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, daysInTargetMonth);
  return Date.UTC(y, m, clampedDay, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
}

// The next fire instant after `from` for a repeat rule, or null when the series has ended (the next
// occurrence would fall past `until`). Daily/weekly advance by exact fixed intervals; monthly/yearly
// advance by calendar months with day clamping. `count` (occurrence cap) is handled by the store on
// fire, not here — this is purely the date math.
export function computeNextOccurrence(rec: Recurrence, from: number): number | null {
  let next: number;
  switch (rec.freq) {
    case "daily":   next = from + rec.interval * DAY_MS; break;
    case "weekly":  next = from + rec.interval * 7 * DAY_MS; break;
    case "monthly": next = addMonthsUTC(from, rec.interval); break;
    case "yearly":  next = addMonthsUTC(from, rec.interval * 12); break;
  }
  if (rec.until != null && next > rec.until) return null;
  return next;
}
