import { useCallback, useState } from "react";

// Timesheet UI preferences — per-browser only (the catalog + entries live in the DB). Appearance and
// view defaults belong here so they never need a server round-trip. A `confetti` slot is reserved for
// a later celebration-on-stop feature (not built yet).
export type TimeView = "day" | "week" | "calendar";

export interface TimePrefs {
  bg: string | null;        // window background tint (hex; null = theme default --tr-canvas)
  accent: string | null;    // accent for the active day / Start button (hex; null = theme blue)
  defaultView: TimeView;
  weekStart: 0 | 1;         // 1 = Monday (default), 0 = Sunday
  confetti: boolean;        // reserved — celebration on stop (not implemented yet)
}

export const DEFAULT_TIME_PREFS: TimePrefs = {
  bg: null,
  accent: null,
  defaultView: "week",
  weekStart: 1,
  confetti: false,
};

const KEY = "tr.timesheetPrefs";

function load(): TimePrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_TIME_PREFS };
    const p = JSON.parse(raw) as Partial<TimePrefs>;
    return {
      bg: typeof p.bg === "string" ? p.bg : null,
      accent: typeof p.accent === "string" ? p.accent : null,
      defaultView: p.defaultView === "day" || p.defaultView === "week" || p.defaultView === "calendar" ? p.defaultView : DEFAULT_TIME_PREFS.defaultView,
      weekStart: p.weekStart === 0 ? 0 : 1,
      confetti: !!p.confetti,
    };
  } catch {
    return { ...DEFAULT_TIME_PREFS };
  }
}

/** Read + persist Timesheet prefs. `set` merges a patch and writes through to localStorage. */
export function useTimePrefs(): [TimePrefs, (patch: Partial<TimePrefs>) => void] {
  const [prefs, setPrefs] = useState<TimePrefs>(load);
  const set = useCallback((patch: Partial<TimePrefs>) => {
    setPrefs((cur) => {
      const next = { ...cur, ...patch };
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }, []);
  return [prefs, set];
}
