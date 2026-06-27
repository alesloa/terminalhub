import type { CSSProperties } from "react";
import type { TimeEntry } from "../../api/types";
import { dayStart, entriesForDay, fmtHM, sumSeconds } from "./util";

interface Props {
  days: number[];          // 7 local midnights (Mon→Sun or Sun→Sat)
  entries: TimeEntry[];
  now: number;
  selected: number;        // selected day (ms midnight)
  accent: string | null;
  onSelect: (dayMs: number) => void;
}

/** The Mon–Sun strip with a per-day total and a Week total — the header from the reference screenshot.
 *  Clicking a day selects it (drilling into that day's entries below). */
export function WeekStrip({ days, entries, now, selected, accent, onSelect }: Props) {
  const weekTotal = days.reduce((acc, d) => acc + sumSeconds(entriesForDay(entries, d), now), 0);
  const selStart = dayStart(selected);

  return (
    <div className="flex items-stretch gap-1 border-b border-edge pb-2">
      {days.map((d) => {
        const total = sumSeconds(entriesForDay(entries, d), now);
        const isSel = d === selStart;
        const isToday = d === dayStart(now);
        const underline: CSSProperties = isSel ? { borderColor: accent ?? "rgb(var(--tr-accent))" } : {};
        return (
          <button key={d} onClick={() => onSelect(d)}
            className={`flex-1 px-1 py-1.5 rounded text-left border-b-2 ${isSel ? "bg-panel/50" : "border-transparent hover:bg-panel/30"}`}
            style={underline}>
            <div className={`text-[11px] ${isToday ? "text-fg font-semibold" : "text-dim"}`}>
              {new Date(d).toLocaleDateString([], { weekday: "short" })}
            </div>
            <div className={`text-sm tabular-nums ${total ? "text-fg" : "text-dim"}`}>{fmtHM(total)}</div>
          </button>
        );
      })}
      <div className="pl-2 self-end text-right">
        <div className="text-[11px] text-dim">Week total</div>
        <div className="text-sm font-semibold tabular-nums">{fmtHM(weekTotal)}</div>
      </div>
    </div>
  );
}
