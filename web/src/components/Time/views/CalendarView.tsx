import type { TimeEntry } from "../../../api/types";
import { dayStart, entriesForDay, entrySeconds, fmtHM, sumSeconds } from "../util";

interface Props {
  days: number[];          // the week's 7 local midnights
  entries: TimeEntry[];    // entries fetched for the visible week
  now: number;
  accent: string | null;
  onPickDay: (dayMs: number) => void;       // click a day header → open it in the Day view
  onAddDay: (dayMs: number) => void;        // click empty space in a day column → add an entry there
  onEditEntry: (entry: TimeEntry) => void;  // click a block → edit/delete that entry
}

const PX = 48;             // pixels per hour on the vertical axis
const MIN_BLOCK = 18;      // a short entry still gets a clickable block

/** The week as a Harvest-style calendar: a column per day, entries stacked from the top with height
 *  proportional to their duration, an hour axis on the left, per-day totals up top, and the week total.
 *  Click a block to edit/delete it, empty space in a column to add time there, a day header to drill in. */
export function CalendarView({ days, entries, now, accent, onPickDay, onAddDay, onEditEntry }: Props) {
  const ACCENT = accent ?? "#2563eb";
  const todayMs = dayStart(now);

  const perDay = days.map((d) => entriesForDay(entries, d).slice().sort((a, b) => a.startedAt - b.startedAt));
  const dayTotals = perDay.map((es) => sumSeconds(es, now));
  const weekTotal = dayTotals.reduce((a, b) => a + b, 0);
  const maxHours = Math.max(8, Math.ceil(Math.max(0, ...dayTotals) / 3600));
  const bodyH = maxHours * PX;

  return (
    <div className="overflow-auto">
      <div className="min-w-[660px]">
        {/* Day headers with per-day totals; far right shows the week total. */}
        <div className="flex border-b border-edge">
          <div className="w-11 shrink-0" />
          {days.map((d, i) => {
            const today = d === todayMs;
            return (
              <button key={d} onClick={() => onPickDay(d)} title="Open this day"
                className="flex-1 min-w-0 text-left px-2 py-1.5 hover:bg-panel/40">
                <div className="text-sm" style={today ? { color: ACCENT, fontWeight: 600 } : undefined}>
                  {new Date(d).toLocaleDateString([], { weekday: "short", day: "numeric" })}
                </div>
                <div className="text-xs tabular-nums" style={today ? { color: ACCENT } : undefined}>
                  <span className={today ? "" : "text-dim"}>{fmtHM(dayTotals[i])}</span>
                </div>
              </button>
            );
          })}
          <div className="w-20 shrink-0 px-2 py-1.5 text-right">
            <div className="text-sm">Week total</div>
            <div className="text-xs font-semibold tabular-nums">{fmtHM(weekTotal)}</div>
          </div>
        </div>

        {/* Time axis + stacked day columns. */}
        <div className="flex" style={{ height: bodyH }}>
          <div className="w-11 shrink-0 relative">
            {Array.from({ length: maxHours }, (_, i) => (
              <div key={i} className="absolute right-1 text-[10px] text-dim -translate-y-1/2" style={{ top: (i + 1) * PX }}>{i + 1}hr</div>
            ))}
          </div>
          {perDay.map((es, i) => {
            const today = days[i] === todayMs;
            let top = 0;
            return (
              <div key={days[i]} onClick={() => onAddDay(days[i])} title="Click to add time"
                className="flex-1 min-w-0 relative border-l border-surface cursor-pointer"
                style={today ? { backgroundColor: "rgba(37,99,235,0.06)" } : undefined}>
                {/* hour gridlines */}
                {Array.from({ length: maxHours }, (_, h) => (
                  <div key={h} className="absolute left-0 right-0 border-t border-surface" style={{ top: (h + 1) * PX }} />
                ))}
                {es.map((e) => {
                  const sec = entrySeconds(e, now);
                  const h = Math.max(MIN_BLOCK, (sec / 3600) * PX);
                  const blockTop = top;
                  top += (sec / 3600) * PX;
                  return (
                    <button key={e.id} onClick={(ev) => { ev.stopPropagation(); onEditEntry(e); }} title="Edit entry"
                      className="absolute left-0 right-0 mx-0.5 rounded px-1.5 py-0.5 text-left text-white overflow-hidden text-[11px] leading-tight hover:brightness-110"
                      style={{ top: blockTop, height: h, backgroundColor: ACCENT }}>
                      <div className="flex items-baseline justify-between gap-1">
                        <span className="font-medium truncate">{e.project || e.client || "—"}</span>
                        <span className="tabular-nums shrink-0">{fmtHM(sec)}</span>
                      </div>
                      {e.task && h > 30 && <div className="opacity-90 truncate">{e.task}</div>}
                      {e.project && e.client && h > 46 && <div className="opacity-75 truncate">{e.client}</div>}
                    </button>
                  );
                })}
              </div>
            );
          })}
          <div className="w-20 shrink-0" />
        </div>
      </div>
    </div>
  );
}
