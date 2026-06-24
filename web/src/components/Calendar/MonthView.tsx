import { useMemo } from "react";
import type { Reminder } from "../../api/types";
import { type Occurrence, monthGrid, dateKey, isToday, WEEKDAYS_SHORT, startOfDay, fmtTime } from "./calendarUtils";
import { holidayMap, type Holiday } from "./holidays";

const DEFAULT_COLOR = "#3b82f6";

/** Month grid (Apple-style): 6 weeks of day cells, each with the day number, any US/MX holidays, and
 *  the day's event chips (capped, with a "+N more" overflow). Click empty space to add on that day. */
export function MonthView({ anchor, occurrences, onPickDay, onEdit }: {
  anchor: Date;
  occurrences: Occurrence[];
  onPickDay: (ms: number) => void;
  onEdit: (r: Reminder) => void;
}) {
  const year = anchor.getFullYear(), month = anchor.getMonth();
  const days = useMemo(() => monthGrid(year, month), [year, month]);
  const holidays = holidayMap(year);

  // Bucket occurrences by the local day they start on.
  const byDay = useMemo(() => {
    const m = new Map<string, Occurrence[]>();
    for (const o of occurrences) {
      const k = dateKey(new Date(o.start));
      (m.get(k) ?? m.set(k, []).get(k)!).push(o);
    }
    return m;
  }, [occurrences]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-7 border-b border-edge">
        {WEEKDAYS_SHORT.map((d) => (
          <div key={d} className="px-2 py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-dim">{d}</div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {days.map((d, i) => {
          const k = dateKey(d);
          const inMonth = d.getMonth() === month;
          const today = isToday(d);
          const evs = byDay.get(k) ?? [];
          const hols = holidays.get(k) ?? [];
          return (
            <button key={i} type="button" onClick={() => onPickDay(startOfDay(d).getTime())}
              className={`group relative flex flex-col gap-0.5 overflow-hidden border-b border-r border-edge/60 p-1 text-left
                ${inMonth ? "bg-canvas hover:bg-elevated/40" : "bg-panel/40 text-dim hover:bg-elevated/20"}`}>
              <div className="flex items-center justify-between">
                <span className={`grid h-6 w-6 place-items-center rounded-full text-xs tabular-nums
                  ${today ? "bg-blue-600 font-semibold text-white" : inMonth ? "text-fg" : "text-dim"}`}>
                  {d.getDate()}
                </span>
              </div>
              {hols.map((h, j) => <HolidayChip key={j} h={h} />)}
              <div className="flex min-h-0 flex-col gap-0.5 overflow-hidden">
                {evs.slice(0, 3).map((o, j) => (
                  <EventChip key={j} o={o} onClick={(e) => { e.stopPropagation(); onEdit(o.reminder); }} />
                ))}
                {evs.length > 3 && <span className="px-1 text-[10px] text-dim">+{evs.length - 3} more</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EventChip({ o, onClick }: { o: Occurrence; onClick: (e: React.MouseEvent) => void }) {
  const color = o.reminder.color ?? DEFAULT_COLOR;
  const dim = o.reminder.status === "cancelled";
  return (
    <span role="button" tabIndex={0} onClick={onClick}
      className={`flex items-center gap-1 truncate rounded px-1 py-0.5 text-[11px] leading-tight hover:brightness-110 ${dim ? "line-through opacity-50" : ""}`}
      style={{ background: `${color}22`, color }}>
      {!o.reminder.allDay && <span className="shrink-0 opacity-80">{fmtTime(o.start)}</span>}
      <span className="truncate text-fg">{o.reminder.title}</span>
    </span>
  );
}

function HolidayChip({ h }: { h: Holiday }) {
  const color = h.country === "US" ? "#60a5fa" : "#34d399";
  return (
    <span className="truncate rounded px-1 text-[10px] leading-tight" style={{ color }} title={`${h.name} (${h.country})`}>
      {h.name}
    </span>
  );
}
