import { dateKey } from "./calendarUtils";

// US + Mexico public holidays, computed by rule (no hardcoded year tables — these are the actual
// statutory rules, so they're correct for any year). Country tags drive the chip color. Each holiday
// is an all-day, date-only entry keyed by local "YYYY-MM-DD".

export type HolidayCountry = "US" | "MX";
export interface Holiday { name: string; country: HolidayCountry }

/** The date of the `n`-th `weekday` (0=Sun..6=Sat) of a month (1-based n). */
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + offset + (n - 1) * 7);
}
/** The date of the LAST `weekday` of a month. */
function lastWeekday(year: number, month: number, weekday: number): Date {
  const last = new Date(year, month + 1, 0);
  const offset = (last.getDay() - weekday + 7) % 7;
  return new Date(year, month, last.getDate() - offset);
}
const fixed = (year: number, month: number, day: number) => new Date(year, month, day);

const MON = 1, THU = 4;

/** Build the holiday map for a given local year: "YYYY-MM-DD" → Holiday[]. */
export function holidaysForYear(year: number): Map<string, Holiday[]> {
  const rows: { date: Date; h: Holiday }[] = [
    // United States — federal holidays
    { date: fixed(year, 0, 1), h: { name: "New Year's Day", country: "US" } },
    { date: nthWeekday(year, 0, MON, 3), h: { name: "Martin Luther King Jr. Day", country: "US" } },
    { date: nthWeekday(year, 1, MON, 3), h: { name: "Presidents' Day", country: "US" } },
    { date: lastWeekday(year, 4, MON), h: { name: "Memorial Day", country: "US" } },
    { date: fixed(year, 5, 19), h: { name: "Juneteenth", country: "US" } },
    { date: fixed(year, 6, 4), h: { name: "Independence Day", country: "US" } },
    { date: nthWeekday(year, 8, MON, 1), h: { name: "Labor Day", country: "US" } },
    { date: nthWeekday(year, 9, MON, 2), h: { name: "Columbus Day", country: "US" } },
    { date: fixed(year, 10, 11), h: { name: "Veterans Day", country: "US" } },
    { date: nthWeekday(year, 10, THU, 4), h: { name: "Thanksgiving", country: "US" } },
    { date: fixed(year, 11, 25), h: { name: "Christmas Day", country: "US" } },
    // México — días feriados oficiales (Ley Federal del Trabajo)
    { date: fixed(year, 0, 1), h: { name: "Año Nuevo", country: "MX" } },
    { date: nthWeekday(year, 1, MON, 1), h: { name: "Día de la Constitución", country: "MX" } },
    { date: nthWeekday(year, 2, MON, 3), h: { name: "Natalicio de Benito Juárez", country: "MX" } },
    { date: fixed(year, 4, 1), h: { name: "Día del Trabajo", country: "MX" } },
    { date: fixed(year, 8, 16), h: { name: "Día de la Independencia", country: "MX" } },
    { date: nthWeekday(year, 10, MON, 3), h: { name: "Día de la Revolución", country: "MX" } },
    { date: fixed(year, 11, 25), h: { name: "Navidad", country: "MX" } },
  ];
  const map = new Map<string, Holiday[]>();
  for (const { date, h } of rows) {
    const k = dateKey(date);
    (map.get(k) ?? map.set(k, []).get(k)!).push(h);
  }
  return map;
}

// Tiny memoized cache so re-renders / multiple views don't recompute the same year repeatedly.
const cache = new Map<number, Map<string, Holiday[]>>();
export function holidayMap(year: number): Map<string, Holiday[]> {
  let m = cache.get(year);
  if (!m) { m = holidaysForYear(year); cache.set(year, m); }
  return m;
}
/** Holidays on a given local day (across both countries), or [] if none. */
export function holidaysOn(d: Date): Holiday[] {
  return holidayMap(d.getFullYear()).get(dateKey(d)) ?? [];
}
