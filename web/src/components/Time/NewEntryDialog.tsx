import { useEffect } from "react";
import type { TimeCatalog } from "./useTimeCatalog";
import type { useTimeSheet } from "./useTimeSheet";
import { NewEntryForm } from "./NewEntryForm";

interface Props {
  catalog: TimeCatalog;
  sheet: ReturnType<typeof useTimeSheet>;
  accent: string | null;
  day: number;            // selected day (ms) — manual "past entry" defaults land here
  onClose: () => void;
}

/** Harvest-style "new time entry" popup — the green + button opens it over the Timesheet window.
 *  Starts a timer (or logs a past entry) then closes itself. Click the backdrop or press Escape to
 *  dismiss. Rendered inside the Timesheet window (absolute), so the window's overflow clips it. */
export function NewEntryDialog({ catalog, sheet, accent, day, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="absolute inset-0 z-[60] flex items-start justify-center p-6 bg-black/40" onPointerDown={onClose}>
      <div className="w-full max-w-lg mt-4 rounded-lg border border-edge-strong bg-canvas shadow-2xl" onPointerDown={(e) => e.stopPropagation()}>
        <div className="h-9 flex items-center justify-between px-3 border-b border-edge">
          <span className="font-semibold text-sm">New time entry</span>
          <button onClick={onClose} title="Close" className="px-2.5 h-6 inline-flex items-center bg-elevated rounded text-xs">Close</button>
        </div>
        <div className="p-3">
          <NewEntryForm catalog={catalog} accent={accent} day={day}
            onStart={(b) => sheet.start(b)}
            onAdd={(b) => sheet.add(b)}
            onDone={onClose} />
        </div>
      </div>
    </div>
  );
}
