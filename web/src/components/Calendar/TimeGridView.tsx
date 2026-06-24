import { useMemo } from "react";
import type { Reminder } from "../../api/types";
import { type Occurrence, dateKey, isToday, fmtHour, fmtTime, WEEKDAYS_SHORT } from "./calendarUtils";
import { holidaysOn } from "./holidays";

const HOUR_H = 44;       // px per hour row
const DEFAULT_COLOR = "#3b82f6";
const DEFAULT_DUR_MS = 60 * 60_000;

/** Day (1 column) and Week (7 columns) share this time grid: an all-day strip on top, then a
 *  scrollable 24-hour body with each timed event positioned by its start/duration. Click a slot to
 *  add an event at that hour; click an event to edit. */
export function TimeGridView({ days, occurrences, onPickSlot, onEdit }: {
  days: Date[];
  occurrences: Occurrence[];
  onPickSlot: (ms: number) => void;
  onEdit: (r: Reminder) => void;
}) {
  // Split each day's occurrences into all-day vs timed.
  const byDay = useMemo(() => {
    const m = new Map<string, { allDay: Occurrence[]; timed: Occurrence[] }>();
    for (const d of days) m.set(dateKey(d), { allDay: [], timed: [] });
    for (const o of occurrences) {
      const bucket = m.get(dateKey(new Date(o.start)));
      if (!bucket) continue;
      (o.reminder.allDay ? bucket.allDay : bucket.timed).push(o);
    }
    return m;
  }, [days, occurrences]);

  const hours = Array.from({ length: 24 }, (_, h) => h);
  const single = days.length === 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Day headers + all-day strip */}
      <div className="flex shrink-0 border-b border-edge">
        <div className="w-14 shrink-0 border-r border-edge" />
        {days.map((d, i) => {
          const bucket = byDay.get(dateKey(d))!;
          const hols = holidaysOn(d);
          return (
            <div key={i} className="min-w-0 flex-1 border-r border-edge/60 px-1 py-1">
              <div className="flex items-baseline justify-center gap-1">
                {!single && <span className="text-[11px] uppercase text-dim">{WEEKDAYS_SHORT[d.getDay()]}</span>}
                <span className={`grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs tabular-nums
                  ${isToday(d) ? "bg-blue-600 font-semibold text-white" : "text-fg"}`}>
                  {single ? d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) : d.getDate()}
                </span>
              </div>
              {hols.map((h, j) => (
                <div key={j} className="mt-0.5 truncate rounded px-1 text-[10px]" style={{ color: h.country === "US" ? "#60a5fa" : "#34d399" }}>{h.name}</div>
              ))}
              {bucket.allDay.map((o, j) => (
                <button key={j} type="button" onClick={() => onEdit(o.reminder)}
                  className="mt-0.5 block w-full truncate rounded px-1 py-0.5 text-left text-[11px]"
                  style={{ background: `${o.reminder.color ?? DEFAULT_COLOR}22`, color: o.reminder.color ?? DEFAULT_COLOR }}>
                  {o.reminder.title}
                </button>
              ))}
            </div>
          );
        })}
      </div>

      {/* Scrollable hour grid */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex" style={{ height: HOUR_H * 24 }}>
          <div className="w-14 shrink-0 border-r border-edge">
            {hours.map((h) => (
              <div key={h} className="relative border-b border-edge/40" style={{ height: HOUR_H }}>
                {h > 0 && <span className="absolute -top-2 right-1 text-[10px] text-dim">{fmtHour(h)}</span>}
              </div>
            ))}
          </div>
          {days.map((d, i) => {
            const bucket = byDay.get(dateKey(d))!;
            return (
              <div key={i} className="relative min-w-0 flex-1 border-r border-edge/60">
                {hours.map((h) => (
                  <div key={h} onClick={() => { const s = new Date(d); s.setHours(h, 0, 0, 0); onPickSlot(s.getTime()); }}
                    className="border-b border-edge/40 hover:bg-elevated/30" style={{ height: HOUR_H }} />
                ))}
                {bucket.timed.map((o, j) => <TimedEvent key={j} o={o} onClick={() => onEdit(o.reminder)} />)}
                {isToday(d) && <NowLine />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TimedEvent({ o, onClick }: { o: Occurrence; onClick: () => void }) {
  const start = new Date(o.start);
  const startMin = start.getHours() * 60 + start.getMinutes();
  const durMs = o.end && o.end > o.start ? o.end - o.start : DEFAULT_DUR_MS;
  const top = (startMin / 60) * HOUR_H;
  const height = Math.max(18, (durMs / 3_600_000) * HOUR_H);
  const color = o.reminder.color ?? DEFAULT_COLOR;
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="absolute left-0.5 right-0.5 overflow-hidden rounded border-l-2 px-1 py-0.5 text-left text-[11px] leading-tight hover:brightness-110"
      style={{ top, height, background: `${color}22`, borderColor: color, color }}>
      <span className="block truncate font-medium text-fg">{o.reminder.title}</span>
      <span className="block truncate opacity-80">{fmtTime(o.start)}</span>
    </button>
  );
}

/** The red "now" line across today's column. */
function NowLine() {
  const now = new Date();
  const top = ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_H;
  return (
    <div className="pointer-events-none absolute left-0 right-0 z-[1] flex items-center" style={{ top }}>
      <span className="h-2 w-2 -ml-1 rounded-full bg-red-500" />
      <span className="h-px flex-1 bg-red-500" />
    </div>
  );
}
