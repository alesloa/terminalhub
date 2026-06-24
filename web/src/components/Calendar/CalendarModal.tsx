import {
  forwardRef, useEffect, useImperativeHandle, useMemo, useState,
  type CSSProperties, type TransitionEventHandler,
} from "react";
import type { Reminder } from "../../api/types";
import type { WinRect } from "../../store/ui";
import { spacesBarBottom } from "../../store/ui";
import { useDraggableWindow, type WindowHandle } from "../../hooks/useDraggableWindow";
import { ResizeHandles } from "../ResizeHandles";
import { useReminders } from "./useReminders";
import { MonthView } from "./MonthView";
import { TimeGridView } from "./TimeGridView";
import { YearView } from "./YearView";
import { ReminderForm } from "./ReminderForm";
import {
  occurrencesInRange, startOfDay, endOfDay, startOfWeek, addDays, addMonths,
  monthGrid, MONTHS, MONTHS_SHORT,
} from "./calendarUtils";

const RECT_KEY = "tr.calendarRect";
const MIN_W = 720, MIN_H = 480;
const DURATION = 300;

type View = "day" | "week" | "month" | "year";

function defaultRect(): WinRect {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(1040, Math.round(vw * 0.8));
  const h = Math.min(720, Math.round(vh * 0.82));
  const top = spacesBarBottom() + 8;
  return { w, h, x: Math.max(8, Math.round((vw - w) / 2)), y: Math.max(top, Math.round((vh - h) / 2)) };
}
function loadRect(): WinRect {
  try {
    const raw = localStorage.getItem(RECT_KEY);
    if (raw) {
      const r = JSON.parse(raw) as Partial<WinRect>;
      if (typeof r.x === "number" && typeof r.y === "number" && typeof r.w === "number" && typeof r.h === "number") {
        const vw = window.innerWidth, vh = window.innerHeight;
        const w = Math.max(MIN_W, Math.min(r.w, vw - 16));
        const h = Math.max(MIN_H, Math.min(r.h, vh - 16));
        return { w, h, x: Math.max(8, Math.min(vw - 80, r.x)), y: Math.max(8, Math.min(vh - 60, r.y)) };
      }
    }
  } catch { /* ignore */ }
  return defaultRect();
}

interface FormState { initial?: Reminder | null; defaultStart?: number }

/** The Calendar window — an Apple-Calendar-style view (Day / Week / Month / Year) over the reminders
 *  store, plus the New Event editor sheet. Follows the window convention: grows out of the launcher
 *  tile, minimizes back into it, draggable + resizable, geometry remembered per-browser. */
export const CalendarModal = forwardRef<WindowHandle, { origin?: WinRect | null; onClose: () => void }>(
  function CalendarModal({ origin, onClose }, ref) {
    const { reminders, isLoading } = useReminders();
    const [view, setView] = useState<View>("month");
    const [anchor, setAnchor] = useState<Date>(() => new Date());
    const [form, setForm] = useState<FormState | null>(null);
    const [seed] = useState(loadRect);
    const { rect, beginDrag, beginResize } = useDraggableWindow(seed, MIN_W, MIN_H, undefined, undefined, "calendar");

    // Grow-from-icon / minimize-to-icon, identical to the other windows.
    const reduce = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const [expanded, setExpanded] = useState(reduce);
    useEffect(() => {
      if (reduce) return;
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setExpanded(true)));
      return () => cancelAnimationFrame(id);
    }, [reduce]);
    const handleClose = () => { if (reduce) { onClose(); return; } setExpanded(false); };
    useImperativeHandle(ref, () => ({ close: handleClose }));
    const onTransitionEnd: TransitionEventHandler = (e) => {
      if (e.target === e.currentTarget && e.propertyName === "transform" && !expanded) onClose();
    };
    useEffect(() => {
      const t = window.setTimeout(() => { try { localStorage.setItem(RECT_KEY, JSON.stringify(rect)); } catch { /* blocked */ } }, 300);
      return () => window.clearTimeout(t);
    }, [rect]);

    // Visible range (epoch ms) for the active view → expanded occurrences (recurrences included).
    const [rangeStart, rangeEnd] = useMemo<[number, number]>(() => {
      if (view === "day") return [startOfDay(anchor).getTime(), endOfDay(anchor).getTime()];
      if (view === "week") { const s = startOfWeek(anchor); return [s.getTime(), endOfDay(addDays(s, 6)).getTime()]; }
      if (view === "year") return [new Date(anchor.getFullYear(), 0, 1).getTime(), new Date(anchor.getFullYear(), 11, 31, 23, 59, 59, 999).getTime()];
      const grid = monthGrid(anchor.getFullYear(), anchor.getMonth());
      return [grid[0].getTime(), endOfDay(grid[41]).getTime()];
    }, [view, anchor]);
    const occurrences = useMemo(() => occurrencesInRange(reminders, rangeStart, rangeEnd), [reminders, rangeStart, rangeEnd]);

    const title = useMemo(() => {
      if (view === "year") return String(anchor.getFullYear());
      if (view === "day") return anchor.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
      if (view === "week") {
        const s = startOfWeek(anchor), e = addDays(s, 6);
        const left = `${MONTHS_SHORT[s.getMonth()]} ${s.getDate()}`;
        const right = s.getMonth() === e.getMonth() ? `${e.getDate()}` : `${MONTHS_SHORT[e.getMonth()]} ${e.getDate()}`;
        return `${left} – ${right}, ${e.getFullYear()}`;
      }
      return `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`;
    }, [view, anchor]);

    const nav = (dir: -1 | 1) => setAnchor((a) => {
      if (view === "day") return addDays(a, dir);
      if (view === "week") return addDays(a, dir * 7);
      if (view === "year") return new Date(a.getFullYear() + dir, a.getMonth(), 1);
      return addMonths(a, dir);
    });

    const openNew = (ms?: number) => setForm({ defaultStart: ms ?? nextHour() });
    const pickDay = (ms: number) => { const d = new Date(ms); d.setHours(9, 0, 0, 0); setForm({ defaultStart: d.getTime() }); };
    const edit = (r: Reminder) => setForm({ initial: r });

    const collapsed = origin
      ? `translate(${origin.x - rect.x}px, ${origin.y - rect.y}px) scale(${origin.w / rect.w}, ${origin.h / rect.h})`
      : "scale(0.94)";
    const style: CSSProperties = {
      left: rect.x, top: rect.y, width: rect.w, height: rect.h,
      ...(reduce ? {} : {
        transformOrigin: origin ? "0 0" : "50% 50%",
        transform: expanded ? "translate(0px, 0px) scale(1, 1)" : collapsed,
        opacity: expanded ? 1 : 0,
        transition: `transform ${DURATION}ms cubic-bezier(.22,.61,.36,1), opacity ${DURATION}ms ease`,
        willChange: "transform, opacity",
      }),
    };

    return (
      <div onTransitionEnd={onTransitionEnd} style={style}
        className="fixed z-50 flex flex-col rounded-lg overflow-hidden border border-edge-strong bg-canvas shadow-2xl">
        {/* Title bar = drag handle */}
        <div onPointerDown={beginDrag}
          className="h-8 shrink-0 flex items-center justify-between px-4 border-b border-edge cursor-move select-none">
          <div className="font-semibold">Calendar</div>
          <div className="flex items-center gap-2" onPointerDown={(e) => e.stopPropagation()}>
            <button onClick={handleClose} title="Close" className="px-3 h-6 inline-flex items-center bg-elevated rounded text-sm">Close</button>
          </div>
        </div>

        {/* Toolbar: nav + title on the left, view switcher + New on the right */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-edge px-3 py-2">
          <div className="flex items-center gap-2">
            <button onClick={() => setAnchor(new Date())} className="rounded border border-edge bg-elevated px-2.5 py-1 text-xs hover:bg-edge">Today</button>
            <div className="flex items-center">
              <button onClick={() => nav(-1)} aria-label="Previous" className="grid h-7 w-7 place-items-center rounded text-dim hover:bg-elevated hover:text-fg">‹</button>
              <button onClick={() => nav(1)} aria-label="Next" className="grid h-7 w-7 place-items-center rounded text-dim hover:bg-elevated hover:text-fg">›</button>
            </div>
            <div className="text-sm font-semibold text-bright">{title}</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded border border-edge-strong bg-canvas p-0.5">
              {(["day", "week", "month", "year"] as View[]).map((v) => (
                <button key={v} onClick={() => setView(v)}
                  className={`rounded px-2.5 py-1 text-xs capitalize ${view === v ? "bg-edge-strong text-bright" : "text-dim hover:text-fg"}`}>{v}</button>
              ))}
            </div>
            <button onClick={() => openNew()} className="rounded bg-blue-600 px-2.5 py-1 text-xs text-white hover:bg-blue-500">+ New</button>
          </div>
        </div>

        {/* View body (relative so the editor sheet anchors to the right edge) */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          {isLoading && <div className="p-6 text-sm text-dim">loading…</div>}
          {!isLoading && view === "month" && <MonthView anchor={anchor} occurrences={occurrences} onPickDay={pickDay} onEdit={edit} />}
          {!isLoading && view === "week" && (
            <TimeGridView days={Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i))} occurrences={occurrences} onPickSlot={(ms) => setForm({ defaultStart: ms })} onEdit={edit} />
          )}
          {!isLoading && view === "day" && (
            <TimeGridView days={[anchor]} occurrences={occurrences} onPickSlot={(ms) => setForm({ defaultStart: ms })} onEdit={edit} />
          )}
          {!isLoading && view === "year" && (
            <YearView year={anchor.getFullYear()} occurrences={occurrences}
              onJumpToMonth={(d) => { setAnchor(d); setView("month"); }}
              onJumpToDay={(d) => { setAnchor(d); setView("day"); }} />
          )}

          {form && (
            <ReminderForm initial={form.initial} defaultStart={form.defaultStart} onClose={() => setForm(null)} />
          )}
        </div>

        <ResizeHandles onStart={beginResize} />
      </div>
    );
  },
);

/** Now rounded up to the next hour — the sensible default start for a brand-new event. */
function nextHour(): number {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d.getTime();
}
