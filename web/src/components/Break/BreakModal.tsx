import { forwardRef, useEffect, useImperativeHandle, useState, type CSSProperties, type ReactNode, type TransitionEventHandler } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { BreakSettings, SettingsResponse } from "../../api/types";
import type { WinRect } from "../../store/ui";
import { spacesBarBottom, useUi } from "../../store/ui";
import { useDraggableWindow, type WindowHandle } from "../../hooks/useDraggableWindow";
import { ResizeHandles } from "../ResizeHandles";
import { speechSupported } from "../../lib/speech";
import { readBreakAnchor } from "../../lib/breaks";

const RECT_KEY = "tr.breaksRect"; // remembered window geometry (per-browser)
const MIN_W = 380, MIN_H = 420;
const DURATION = 300; // ms — grow-from-icon / minimize-to-icon animation

const clampInt = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? Math.round(n) : min));

function defaultRect(): WinRect {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(440, Math.round(vw * 0.6));
  const h = Math.min(560, Math.round(vh * 0.74));
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
  } catch { /* ignore corrupt/blocked storage */ }
  return defaultRect();
}

/**
 * The Breaks tool window — a free-floating, draggable, resizable panel (opened from the launcher's
 * Breaks tile) for configuring the recurring stand-up enforcer and turning it on/off. Edits apply
 * LIVE: the ui-store config updates immediately (the timer reacts on the spot) and a debounced PATCH
 * persists them — no Save button, unlike the Settings tab. The break *overlay* itself stays a
 * full-screen veil (BreakOverlay); this is just its control panel, so it follows the normal window
 * convention: grows out of the launcher icon on open, minimizes back into it on close.
 */
export const BreakModal = forwardRef<WindowHandle, { origin?: WinRect | null; onClose: () => void }>(function BreakModal({ origin, onClose }, ref) {
  const breaks = useUi((s) => s.breaks);
  const setBreaks = useUi((s) => s.setBreaks);
  const testBreak = useUi((s) => s.testBreak);
  const qc = useQueryClient();

  const [seed] = useState(loadRect);
  const { rect, beginDrag, beginResize } = useDraggableWindow(seed, MIN_W, MIN_H, undefined, undefined, "breaks");

  // Apply a config change: update the store (so the timer reacts now) + the settings cache, and
  // persist to the server RIGHT AWAY. No debounce — break edits are infrequent toggles/numbers, and
  // debouncing risked losing the last change if the modal closed before it flushed (which left a
  // toggled-off break stuck enabled in the DB → it kept firing on refresh).
  const apply = (next: BreakSettings) => {
    setBreaks(next);
    qc.setQueryData<SettingsResponse>(["settings"], (old) => (old ? { ...old, breaks: next } : old));
    api.updateSettings({ breaks: next }).catch(() => {});
  };
  const set = <K extends keyof BreakSettings>(k: K, v: BreakSettings[K]) => apply({ ...breaks, [k]: v });

  // Grow-from-icon on open, minimize-to-icon on close (the shared window convention).
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

  // Remember geometry, debounced so a drag/resize doesn't hammer localStorage every frame.
  useEffect(() => {
    const t = window.setTimeout(() => { try { localStorage.setItem(RECT_KEY, JSON.stringify(rect)); } catch { /* blocked */ } }, 300);
    return () => window.clearTimeout(t);
  }, [rect]);

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
      <div onPointerDown={beginDrag}
        className="h-8 shrink-0 flex items-center justify-between px-4 border-b border-edge cursor-move select-none">
        <div className="font-semibold">Breaks</div>
        <div className="flex items-center gap-2" onPointerDown={(e) => e.stopPropagation()}>
          <button onClick={handleClose} title="Close"
            className="px-3 h-6 inline-flex items-center bg-elevated rounded text-sm">Close</button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 text-sm">
        <p className="mb-4 text-xs text-dim">
          A full-screen reminder to get up and move, on a schedule you set. It only veils your screen —
          terminals and agents keep running underneath.
        </p>

        <NextBreakCountdown />

        <div className="space-y-4">
          <Toggle title="Enable breaks" hint="Turn the recurring reminder on or off." checked={breaks.enabled} onChange={(v) => set("enabled", v)} />

          <Row title="Break every" hint="How often a break fires.">
            <MinutePicker value={breaks.intervalMinutes} presets={[30, 45, 60, 90, 120]} min={1} max={600} onChange={(n) => set("intervalMinutes", n)} />
          </Row>
          <Row title="Break lasts" hint="The overlay's countdown length.">
            <MinutePicker value={breaks.durationMinutes} presets={[5, 10, 15]} min={1} max={120} onChange={(n) => set("durationMinutes", n)} />
          </Row>
          <Row title="Heads-up" hint="Seconds of warning before the screen locks (0 = immediate).">
            <input type="number" min={0} max={300} value={breaks.preWarnSeconds}
              onChange={(e) => set("preWarnSeconds", clampInt(Number(e.target.value), 0, 300))}
              className="w-20 rounded border border-edge-strong bg-canvas px-2 py-1 text-right text-bright outline-none focus:border-blue-500" />
          </Row>

          <Toggle title="Pause when tab hidden" hint="Don't count down while this tab is in the background." checked={breaks.pauseWhenHidden} onChange={(v) => set("pauseWhenHidden", v)} />
          <Toggle title="Allow skip" hint="Show a 'keep working' button to force past a break." checked={breaks.allowSkip} onChange={(v) => set("allowSkip", v)} />
          {speechSupported() && (
            <Toggle title="Speak the prompt" hint="Read the break aloud when it starts." checked={breaks.speak} onChange={(v) => set("speak", v)} />
          )}

          <div className="flex items-center justify-between gap-4 border-t border-edge pt-4">
            <div className="min-w-0">
              <div className="text-fg">Preview</div>
              <div className="text-xs text-dim">Try the overlay now with the duration above.</div>
            </div>
            <button type="button" onClick={() => testBreak({ durationMinutes: breaks.durationMinutes, speak: breaks.speak })}
              className="rounded bg-surface px-3 py-1.5 text-xs text-fg hover:bg-elevated">Test now</button>
          </div>
        </div>

        <p className="mt-4 text-[11px] text-dim">Changes apply instantly and save automatically.</p>
      </div>

      <ResizeHandles onStart={beginResize} />
    </div>
  );
});

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-fg">{title}</div>
        {hint && <div className="text-xs text-dim">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ title, hint, checked, onChange }: { title: string; hint: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-4">
      <span>
        <span className="block text-fg">{title}</span>
        <span className="block text-xs text-dim">{hint}</span>
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-blue-500" />
    </label>
  );
}

function Segment({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button onClick={onClick} className={`min-w-8 rounded px-2 py-1 text-xs ${active ? "bg-edge-strong text-bright" : "text-dim hover:text-fg"}`}>
      {children}
    </button>
  );
}

/** Live "next break in …" readout, ticking every second off the localStorage cycle anchor the timer
 *  maintains (so it agrees with the actual countdown, survives refreshes, and reflects snoozes). Shows
 *  "Off" when disabled and "Now" while a break is up. */
function NextBreakCountdown() {
  const enabled = useUi((s) => s.breaks.enabled);
  const active = useUi((s) => s.breakActive);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  let value: string, hint: string;
  if (active) { value = "Now"; hint = "Break in progress."; }
  else if (!enabled) { value = "Off"; hint = "Enable breaks to start the countdown."; }
  else {
    const at = readBreakAnchor();
    value = at != null ? fmtCountdown(at - Date.now()) : "—";
    hint = "Counting down on this machine.";
  }

  return (
    <div className="mb-4 flex items-center justify-between gap-4 rounded-lg border border-edge bg-surface px-4 py-3">
      <div className="min-w-0">
        <div className="text-fg">Next break</div>
        <div className="text-xs text-dim">{hint}</div>
      </div>
      <div className="text-2xl font-semibold tabular-nums text-bright">{value}</div>
    </div>
  );
}

/** ms → "MM:SS", or "H:MM:SS" once an hour or more remains (intervals go up to 600 min). */
function fmtCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Preset minute chips + a custom number input; both clamp to [min,max]. */
function MinutePicker({ value, presets, min, max, onChange }: { value: number; presets: number[]; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex rounded border border-edge-strong bg-canvas p-0.5">
        {presets.map((p) => <Segment key={p} active={value === p} onClick={() => onChange(p)}>{String(p)}</Segment>)}
      </div>
      <input type="number" min={min} max={max} value={value}
        onChange={(e) => onChange(clampInt(Number(e.target.value), min, max))}
        className="w-14 rounded border border-edge-strong bg-canvas px-2 py-1 text-right text-bright outline-none focus:border-blue-500" />
      <span className="text-xs text-muted">min</span>
    </div>
  );
}
