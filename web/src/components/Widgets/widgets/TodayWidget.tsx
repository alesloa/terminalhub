import { occurrencesInRange, startOfDay, endOfDay } from "../../Calendar/calendarUtils";
import { useReminders } from "../../Calendar/useReminders";
import { useNow } from "../time";

// The calendar in Terminal Hub is reminder-backed (no separate "events" model), so "Today" lists
// today's reminder occurrences — recurrences expanded by the same util the calendar grid uses.
function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function TodayWidget() {
  const now = useNow(60_000); // a minute is plenty for an agenda; also re-styles past items
  const { reminders, isLoading } = useReminders();

  const today = new Date(now);
  const occ = occurrencesInRange(reminders, startOfDay(today).getTime(), endOfDay(today).getTime());

  if (isLoading && reminders.length === 0) {
    return <div className="py-3 text-center text-xs text-dim">Loading…</div>;
  }
  if (occ.length === 0) {
    return <div className="py-3 text-center text-xs text-dim">Nothing scheduled today.</div>;
  }

  return (
    <ul className="max-h-44 space-y-1.5 overflow-y-auto">
      {occ.map((o) => {
        const past = !o.reminder.allDay && o.start < now;
        return (
          <li key={`${o.reminder.id}-${o.start}`} className={`flex items-center gap-2 ${past ? "opacity-45" : ""}`}>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: o.reminder.color ?? "rgb(var(--tr-accent))" }} />
            <span className="w-16 shrink-0 text-[11px] tabular-nums text-dim">{o.reminder.allDay ? "All day" : timeLabel(o.start)}</span>
            <span className="truncate text-[12px] text-fg">{o.reminder.title}</span>
          </li>
        );
      })}
    </ul>
  );
}
