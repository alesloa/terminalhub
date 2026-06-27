import type { CSSProperties } from "react";
import type { TimeEntry } from "../../../api/types";
import { dayStart, entriesForDay, fmtHM, monthGrid, sumSeconds } from "../util";

interface Props {
  monthTs: number;        // any ms inside the month being shown
  entries: TimeEntry[];   // entries fetched for the whole visible month
  now: number;
  weekStart: 0 | 1;
  accent: string | null;
  onPickDay: (dayMs: number) => void;   // click a cell → drill into Day view
}

/** Month grid of per-day totals. Click a day to open it in the Day view. Days outside the current
 *  month are dimmed; today is outlined. */
export function CalendarView({ monthTs, entries, now, weekStart, accent, onPickDay }: Props) {
  const cells = monthGrid(monthTs, weekStart);
  const month = new Date(monthTs).getMonth();
  const dow = weekStart === 1 ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const todayMs = dayStart(now);
  const monthTotal = cells.filter((d) => new Date(d).getMonth() === month).reduce((a, d) => a + sumSeconds(entriesForDay(entries, d), now), 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-sm text-dim">{new Date(monthTs).toLocaleDateString([], { month: "long", year: "numeric" })}</span>
        <span className="text-sm">Month total <span className="font-semibold tabular-nums">{fmtHM(monthTotal)}</span></span>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {dow.map((d) => <div key={d} className="text-[11px] text-dim text-center py-1">{d}</div>)}
        {cells.map((d) => {
          const inMonth = new Date(d).getMonth() === month;
          const total = sumSeconds(entriesForDay(entries, d), now);
          const isToday = d === todayMs;
          const ring: CSSProperties = isToday ? { borderColor: accent ?? "rgb(var(--tr-accent))" } : {};
          return (
            <button key={d} onClick={() => onPickDay(d)}
              className={`h-16 rounded border text-left p-1.5 ${isToday ? "border-2" : "border-edge"} ${inMonth ? "bg-panel/30 hover:bg-panel/60" : "opacity-40 hover:opacity-70"}`}
              style={ring}>
              <div className="text-[11px] text-dim">{new Date(d).getDate()}</div>
              {total > 0 && <div className="text-xs font-medium tabular-nums mt-1">{fmtHM(total)}</div>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
