import type { TimeEntry } from "../../../api/types";
import type { TimeCatalog } from "../useTimeCatalog";
import type { useTimeSheet } from "../useTimeSheet";
import { EntryRow } from "../EntryRow";
import { NewEntryForm } from "../NewEntryForm";
import { entriesForDay, fmtHM, sumSeconds } from "../util";

export interface DayViewProps {
  sheet: ReturnType<typeof useTimeSheet>;
  catalog: TimeCatalog;
  now: number;
  accent: string | null;
  day: number;            // local midnight of the day to show
  showTotal?: boolean;    // WeekView hides it (the strip already shows totals)
}

/** A single day: the new-entry form, that day's rows (newest first), and a day total. Reused by
 *  WeekView for the day picked in the strip. */
export function DayView({ sheet, catalog, now, accent, day, showTotal = true }: DayViewProps) {
  const dayEntries: TimeEntry[] = entriesForDay(sheet.entries, day);
  const total = sumSeconds(dayEntries, now);

  return (
    <div className="space-y-3">
      <NewEntryForm
        catalog={catalog} accent={accent} day={day}
        onStart={(b) => sheet.start(b)}
        onAdd={(b) => sheet.add(b)}
      />

      {showTotal && (
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-dim">{dayEntries.length} {dayEntries.length === 1 ? "entry" : "entries"}</span>
          <span className="text-sm">Day total <span className="font-semibold tabular-nums">{fmtHM(total)}</span></span>
        </div>
      )}

      <div className="rounded-lg border border-edge overflow-hidden">
        {dayEntries.length === 0
          ? <div className="px-3 py-6 text-center text-dim text-sm">No time logged. Start a timer above.</div>
          : dayEntries.map((e) => (
            <EntryRow key={e.id} entry={e} now={now} catalog={catalog}
              onStop={(id) => sheet.stop({ id })}
              onSave={(id, patch) => sheet.save(id, patch)}
              onDelete={(id) => sheet.remove(id)} />
          ))}
      </div>
    </div>
  );
}
