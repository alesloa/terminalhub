import { useMemo } from "react";
import { type Occurrence, monthGrid, dateKey, isToday, MONTHS, WEEKDAYS_NARROW } from "./calendarUtils";

/** Year overview: 12 mini-months. A dot marks any day with an event; today is circled. Click a month
 *  title to open it, or any day to jump straight to that day. */
export function YearView({ year, occurrences, onJumpToMonth, onJumpToDay }: {
  year: number;
  occurrences: Occurrence[];
  onJumpToMonth: (d: Date) => void;
  onJumpToDay: (d: Date) => void;
}) {
  const eventDays = useMemo(() => new Set(occurrences.map((o) => dateKey(new Date(o.start)))), [occurrences]);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-2 gap-4 overflow-y-auto p-3 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 12 }, (_, m) => (
        <MiniMonth key={m} year={year} month={m} eventDays={eventDays}
          onTitle={() => onJumpToMonth(new Date(year, m, 1))} onDay={onJumpToDay} />
      ))}
    </div>
  );
}

function MiniMonth({ year, month, eventDays, onTitle, onDay }: {
  year: number; month: number; eventDays: Set<string>;
  onTitle: () => void; onDay: (d: Date) => void;
}) {
  const days = monthGrid(year, month);
  return (
    <div className="select-none">
      <button type="button" onClick={onTitle} className="mb-1 text-sm font-semibold text-accent hover:underline">{MONTHS[month]}</button>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WEEKDAYS_NARROW.map((d, i) => <div key={i} className="text-[9px] text-dim">{d}</div>)}
        {days.map((d, i) => {
          const inMonth = d.getMonth() === month;
          const today = isToday(d);
          const hasEvent = inMonth && eventDays.has(dateKey(d));
          return (
            <button key={i} type="button" onClick={() => onDay(d)}
              className={`relative grid h-5 place-items-center rounded text-[10px] tabular-nums hover:bg-elevated
                ${today ? "bg-blue-600 font-semibold text-white" : inMonth ? "text-fg" : "text-dim/50"}`}>
              {d.getDate()}
              {hasEvent && !today && <span className="absolute bottom-0 h-1 w-1 rounded-full bg-accent" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
