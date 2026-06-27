import { forwardRef, useEffect, useImperativeHandle, useMemo, useState, type CSSProperties, type TransitionEventHandler } from "react";
import type { WinRect } from "../../store/ui";
import { spacesBarBottom } from "../../store/ui";
import { useDraggableWindow, type WindowHandle } from "../../hooks/useDraggableWindow";
import { ResizeHandles } from "../ResizeHandles";
import { useTimeSheet } from "./useTimeSheet";
import { useTimeCatalog } from "./useTimeCatalog";
import { useTimePrefs, type TimeView } from "./prefs";
import { DAY_MS, dayRange, dayStart, fmtDayLabel, monthGrid, useNow, weekDays, weekRange } from "./util";
import { DateNav } from "./DateNav";
import { DayView } from "./views/DayView";
import { WeekView } from "./views/WeekView";
import { CalendarView } from "./views/CalendarView";
import { SettingsTab } from "./SettingsTab";

const RECT_KEY = "tr.timesheetRect";
const MIN_W = 560, MIN_H = 440;
const DURATION = 300;

function defaultRect(): WinRect {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(900, Math.round(vw * 0.72));
  const h = Math.min(680, Math.round(vh * 0.78));
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

function shortDay(ts: number): string {
  return new Date(ts).toLocaleDateString([], { day: "numeric", month: "short" });
}

/**
 * Timesheet — a Harvest-style time tracker as a floating, draggable, resizable window (grows out of
 * its TopBar icon, minimizes back into it). Two tabs: the Timesheet (Day / Week / Calendar views with
 * a new-entry form, live-ticking running timers, and per-day + range totals) and Settings (manage
 * clients/projects/tasks + appearance). Timers can also be driven by a terminal agent over the
 * loopback REST API — see docs/FEATURES.md.
 */
export const TimeSheetModal = forwardRef<WindowHandle, { origin?: WinRect | null; onClose: () => void }>(function TimeSheetModal({ origin, onClose }, ref) {
  const [prefs, setPrefs] = useTimePrefs();
  const [tab, setTab] = useState<"sheet" | "settings">("sheet");
  const [view, setView] = useState<TimeView>(prefs.defaultView);
  const [selected, setSelected] = useState(() => Date.now());
  const now = useNow(1000);
  const catalog = useTimeCatalog();

  // Visible range + nav label, derived from the view + selected day + week-start preference.
  const { from, to, days, label } = useMemo(() => {
    if (view === "day") {
      const r = dayRange(selected);
      const lbl = (dayStart(selected) === dayStart(now) ? "Today, " : "") + fmtDayLabel(selected);
      return { ...r, days: [] as number[], label: lbl };
    }
    if (view === "week") {
      const d = weekDays(selected, prefs.weekStart);
      return { ...weekRange(selected, prefs.weekStart), days: d, label: `${shortDay(d[0])} – ${shortDay(d[6])}` };
    }
    const cells = monthGrid(selected, prefs.weekStart);
    return { from: cells[0], to: cells[41] + DAY_MS, days: [] as number[], label: new Date(selected).toLocaleDateString([], { month: "long", year: "numeric" }) };
  }, [view, selected, prefs.weekStart, now]);

  const sheet = useTimeSheet(from, to);

  const step = (dir: 1 | -1) => setSelected((cur) => {
    if (view === "day") return cur + dir * DAY_MS;
    if (view === "week") return cur + dir * 7 * DAY_MS;
    const d = new Date(cur); return new Date(d.getFullYear(), d.getMonth() + dir, Math.min(d.getDate(), 28)).getTime();
  });

  // Grow-from-icon / minimize-to-icon animation (same as NotesModal).
  const reduce = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [seed] = useState(loadRect);
  const { rect, beginDrag, beginResize } = useDraggableWindow(seed, MIN_W, MIN_H, undefined, undefined, "timesheet");
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

  const collapsed = origin
    ? `translate(${origin.x - rect.x}px, ${origin.y - rect.y}px) scale(${origin.w / rect.w}, ${origin.h / rect.h})`
    : "scale(0.94)";
  const style: CSSProperties = {
    left: rect.x, top: rect.y, width: rect.w, height: rect.h,
    ...(prefs.bg ? { backgroundColor: prefs.bg } : {}),
    ...(reduce ? {} : {
      transformOrigin: origin ? "0 0" : "50% 50%",
      transform: expanded ? "translate(0px, 0px) scale(1, 1)" : collapsed,
      opacity: expanded ? 1 : 0,
      transition: `transform ${DURATION}ms cubic-bezier(.22,.61,.36,1), opacity ${DURATION}ms ease`,
      willChange: "transform, opacity",
    }),
  };

  const tabBtn = (active: boolean) => `px-3 h-6 inline-flex items-center rounded text-sm ${active ? "bg-edge text-bright" : "bg-elevated hover:bg-edge text-dim"}`;
  const viewBtn = (v: TimeView) => {
    const active = view === v;
    return (
      <button key={v} onClick={() => setView(v)} style={active && prefs.accent ? { backgroundColor: prefs.accent, color: "#fff" } : undefined}
        className={`px-2.5 h-7 inline-flex items-center rounded text-xs capitalize ${active ? (prefs.accent ? "" : "bg-orange-600 text-white") : "bg-elevated hover:bg-edge text-dim"}`}>{v}</button>
    );
  };

  return (
    <div onTransitionEnd={onTransitionEnd} style={style}
      className="fixed z-50 flex flex-col rounded-lg overflow-hidden border border-edge-strong bg-canvas shadow-2xl">
      <div onPointerDown={beginDrag}
        className="h-8 shrink-0 flex items-center justify-between px-4 border-b border-edge cursor-move select-none">
        <div className="flex items-center gap-3">
          <span className="font-semibold">Timesheet</span>
          <div className="flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
            <button onClick={() => setTab("sheet")} className={tabBtn(tab === "sheet")}>Timesheet</button>
            <button onClick={() => setTab("settings")} className={tabBtn(tab === "settings")}>Settings</button>
          </div>
        </div>
        <div onPointerDown={(e) => e.stopPropagation()}>
          <button onClick={handleClose} title="Close" className="px-3 h-6 inline-flex items-center bg-elevated rounded text-sm">Close</button>
        </div>
      </div>

      {tab === "sheet" && (
        <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-2 border-b border-edge">
          <DateNav label={label} onPrev={() => step(-1)} onNext={() => step(1)} onToday={() => setSelected(Date.now())} />
          <div className="flex items-center gap-1">{(["day", "week", "calendar"] as TimeView[]).map(viewBtn)}</div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto p-4">
        {tab === "settings"
          ? <SettingsTab catalog={catalog} prefs={prefs} setPrefs={setPrefs} />
          : view === "day" ? <DayView sheet={sheet} catalog={catalog} now={now} accent={prefs.accent} day={dayStart(selected)} />
          : view === "week" ? <WeekView sheet={sheet} catalog={catalog} now={now} accent={prefs.accent} day={dayStart(selected)} days={days} onSelectDay={(d) => setSelected(d)} />
          : <CalendarView monthTs={selected} entries={sheet.entries} now={now} weekStart={prefs.weekStart} accent={prefs.accent} onPickDay={(d) => { setSelected(d); setView("day"); }} />}
      </div>

      <ResizeHandles onStart={beginResize} />
    </div>
  );
});
