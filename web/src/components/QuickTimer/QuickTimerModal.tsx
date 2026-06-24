import {
  forwardRef, useEffect, useImperativeHandle, useRef, useState,
  type CSSProperties, type TransitionEventHandler,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { WinRect } from "../../store/ui";
import { spacesBarBottom } from "../../store/ui";
import { useDraggableWindow, type WindowHandle } from "../../hooks/useDraggableWindow";
import { ResizeHandles } from "../ResizeHandles";
import { useReminders } from "../Calendar/useReminders";
import { useToasts } from "../../store/toasts";
import { useTimers } from "../../store/timers";

// A lightweight "ping me in N minutes" window — the quick alternative to a full calendar event.
// Title + optional note + optional image + a relative timer; on fire it routes through the same
// reminder scheduler, so it lands as both a Pushover push (if enabled) and an in-app notification.
// Follows the window convention: grows out of the launcher tile, minimizes back into it.

const RECT_KEY = "tr.quickTimerRect";
const MIN_W = 340, MIN_H = 400;
const DURATION = 300;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const PRESETS: { m: number; label: string }[] = [
  { m: 5, label: "5m" },
  { m: 15, label: "15m" },
  { m: 30, label: "30m" },
  { m: 45, label: "45m" },
  { m: 60, label: "1h" },
  { m: 120, label: "2h" },
];

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Human label for a minute count: "45 min", "1 hr", "1 hr 30 min". */
function humanizeMinutes(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), rem = m % 60;
  return rem ? `${h} hr ${rem} min` : `${h} hr`;
}

function defaultRect(): WinRect {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = 380, h = 512;
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

export const QuickTimerModal = forwardRef<WindowHandle, { origin?: WinRect | null; onClose: () => void }>(
  function QuickTimerModal({ origin, onClose }, ref) {
    const { create } = useReminders();
    const pushToast = useToasts((s) => s.push);
    const addTimer = useTimers((s) => s.addTimer);
    const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
    const pushoverConfigured = settings?.pushoverConfigured ?? false;

    const [seed] = useState(loadRect);
    const { rect, beginDrag, beginResize } = useDraggableWindow(seed, MIN_W, MIN_H, undefined, undefined, "timer");

    // Grow-from-icon / minimize-to-icon (identical to the other windows).
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

    const [title, setTitle] = useState("");
    const [body, setBody] = useState("");
    const [minutes, setMinutes] = useState(30);
    // The whole point is the phone push — default it on; the amber hint covers the unconfigured case.
    const [pushover, setPushover] = useState(true);
    const [image, setImage] = useState<string | undefined>(undefined);
    const [imgError, setImgError] = useState("");
    const fileRef = useRef<HTMLInputElement>(null);

    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const mins = Math.max(1, Math.min(525_600, Math.round(minutes) || 0));
    const canSave = title.trim().length > 0 && mins >= 1 && !busy;
    const fireTimeLabel = new Date(Date.now() + mins * 60_000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

    const pickImage = async (file: File | undefined) => {
      setImgError("");
      if (!file) return;
      if (file.size > MAX_IMAGE_BYTES) { setImgError("Image must be under 5 MB."); return; }
      try { setImage(await readFileAsDataUrl(file)); }
      catch { setImgError("Couldn't read that image."); }
    };
    const clearImage = () => { setImage(undefined); if (fileRef.current) fileRef.current.value = ""; };

    const submit = async () => {
      if (!canSave) return;
      setBusy(true); setError("");
      try {
        const reminder = await create({
          title: title.trim(),
          body: body.trim(),
          fireInMinutes: mins,
          channels: { inApp: true, pushover, speak: false },
          ...(image !== undefined ? { image } : {}),
        });
        // Drive the top-bar countdown pill off the server-computed fire instant.
        addTimer({ id: reminder.id, title: reminder.title, fireAt: reminder.fireAt });
        pushToast(`“${title.trim()}” fires in ${humanizeMinutes(mins)}`, { level: "success", title: "Timer set" });
        handleClose();
      } catch (e) { setError((e as Error).message); setBusy(false); }
    };

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
          <div className="font-semibold">Quick timer</div>
          <div onPointerDown={(e) => e.stopPropagation()}>
            <button onClick={handleClose} title="Close" className="px-3 h-6 inline-flex items-center bg-elevated rounded text-sm">Close</button>
          </div>
        </div>

        <div className="flex-1 min-h-0 space-y-3 overflow-y-auto p-4 text-sm">
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && canSave) submit(); }}
            placeholder="What should it say?"
            className="w-full rounded border border-edge-strong bg-canvas px-3 py-2 text-bright outline-none focus:border-blue-500" />

          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="Note (optional)"
            className="w-full resize-none rounded border border-edge-strong bg-canvas px-3 py-2 text-fg outline-none focus:border-blue-500" />

          <div>
            <input ref={fileRef} type="file" accept="image/*" onChange={(e) => pickImage(e.target.files?.[0])}
              className="text-xs text-dim file:mr-2 file:rounded file:border-0 file:bg-elevated file:px-2 file:py-1 file:text-fg hover:file:bg-edge" />
            {image && (
              <div className="relative mt-2 inline-block">
                <img src={image} alt="" className="max-h-24 rounded border border-edge" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                <button type="button" onClick={clearImage}
                  className="absolute -right-2 -top-2 grid h-5 w-5 place-items-center rounded-full bg-error/80 text-xs text-white">×</button>
              </div>
            )}
            {imgError && <div className="mt-1 text-xs text-red-400">{imgError}</div>}
          </div>

          <div className="space-y-2 rounded border border-edge bg-canvas/50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-dim">Fire in</div>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button key={p.m} type="button" onClick={() => setMinutes(p.m)}
                  className={`rounded border px-2.5 py-1 text-xs transition ${
                    mins === p.m ? "border-blue-500 bg-blue-600/20 text-bright" : "border-edge bg-elevated text-fg hover:bg-edge"}`}>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input type="number" min={1} max={525_600} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}
                className="w-20 rounded border border-edge-strong bg-canvas px-2 py-1 text-right text-bright outline-none focus:border-blue-500" />
              <span className="text-xs text-dim">minutes · fires around {fireTimeLabel}</span>
            </div>
          </div>

          <label className="flex items-center justify-between">
            <span className="text-fg">Pushover (phone)</span>
            <input type="checkbox" checked={pushover} onChange={(e) => setPushover(e.target.checked)} className="h-4 w-4 accent-blue-500" />
          </label>
          {pushover && !pushoverConfigured && (
            <div className="text-xs text-amber-400">Add your Pushover keys in Settings → Voice &amp; Speech for the phone push. It still shows in Terminal Hub.</div>
          )}
          <div className="text-xs text-dim">Always shows as a Terminal Hub notification too.</div>
        </div>

        <div className="shrink-0 border-t border-edge px-4 py-3">
          {error && <div className="mb-2 rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-200">{error}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={handleClose} className="rounded bg-surface px-3 py-1.5 text-sm text-fg hover:bg-elevated">Cancel</button>
            <button onClick={submit} disabled={!canSave}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-50">
              {busy ? "Setting…" : "Start timer"}
            </button>
          </div>
        </div>

        <ResizeHandles onStart={beginResize} />
      </div>
    );
  },
);
