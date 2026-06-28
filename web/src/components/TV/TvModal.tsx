import { forwardRef, useEffect, useImperativeHandle, useState, type CSSProperties, type TransitionEventHandler } from "react";
import type { WinRect } from "../../store/ui";
import { spacesBarBottom } from "../../store/ui";
import { useDraggableWindow, type WindowHandle } from "../../hooks/useDraggableWindow";
import { ResizeHandles } from "../ResizeHandles";
import { useTv, type TvMode as Mode } from "./store";
import { useTvSettings } from "./useTvData";
import { TvMode } from "./TvMode";
import { RadioMode } from "./RadioMode";
import { YouTubeMode } from "./YouTubeMode";
import { TvSettingsPopover } from "./TvSettingsPopover";
import { Tooltip } from "./Tooltip";
import { TvIcon, RadioIcon, YouTubeIcon, GearIcon, CloseIcon } from "./icons";

const RECT_KEY = "tr.tvRect";
const MIN_W = 920, MIN_H = 560; // sidebar (212) + a usable stage + browse rail (330)
const DURATION = 300;

function defaultRect(): WinRect {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(1180, Math.round(vw * 0.88));
  const h = Math.min(782, Math.round(vh * 0.86));
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

const TABS: { id: Mode; label: string; icon: React.ReactNode }[] = [
  { id: "tv", label: "Live TV", icon: <TvIcon size={14} /> },
  { id: "radio", label: "Radio", icon: <RadioIcon size={13} /> },
  { id: "youtube", label: "YouTube", icon: <YouTubeIcon size={14} /> },
];

/**
 * The TV / Media tool — a free-floating, draggable, resizable window (PM2-GUI dark/green desktop look)
 * with three modes: Live TV (iptv-org over the HLS proxy), Radio (radio-browser), and YouTube (Data API).
 * Title-bar tabs switch modes; each mode owns its sidebar, browse rail, transport, and PM2-style status
 * strip. Opening grows the window out of the launcher icon (`origin`); Close minimizes it back in.
 */
export const TvModal = forwardRef<WindowHandle, { origin?: WinRect | null; onClose: () => void }>(function TvModal({ origin, onClose }, ref) {
  const mode = useTv((s) => s.mode);
  const setMode = useTv((s) => s.setMode);
  const { settings, save } = useTvSettings();
  const [showSettings, setShowSettings] = useState(false);

  const [seed] = useState(loadRect);
  const { rect, beginDrag, beginResize } = useDraggableWindow(seed, MIN_W, MIN_H, undefined, undefined, "tv");

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
      className="tv-scope fixed z-50 flex flex-col rounded-xl overflow-hidden border border-edge-strong bg-canvas shadow-2xl">
      {/* title bar = drag handle */}
      <div onPointerDown={beginDrag} style={{ background: "var(--tv-grad-titlebar)" }}
        className="h-[42px] shrink-0 flex items-center gap-3.5 px-3.5 border-b border-edge cursor-move select-none">
        <div className="font-semibold text-[13px] text-bright flex items-center gap-2">
          <span className="text-accent"><TvIcon size={16} /></span> TV
        </div>
        <div className="flex gap-1 bg-elevated p-[3px] rounded-[9px] border border-edge" onPointerDown={(e) => e.stopPropagation()}>
          {TABS.map((t) => {
            const active = mode === t.id;
            return (
              <button key={t.id} onClick={() => setMode(t.id)}
                className={`px-3.5 py-1 rounded-[7px] font-medium flex gap-1.5 items-center text-[12.5px] ${active ? "bg-surface text-bright shadow" : "text-muted hover:text-fg"}`}>
                {active && t.id === "tv" ? <span className="w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_6px_var(--tw-shadow-color)] shadow-accent" /> : t.icon}
                {t.label}
              </button>
            );
          })}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
          <Tooltip label="TV settings" side="bottom">
            <button onClick={() => setShowSettings((s) => !s)}
              className={`w-[30px] h-[30px] rounded-lg grid place-items-center ${showSettings ? "bg-elevated text-fg" : "text-muted hover:bg-elevated hover:text-fg"}`}>
              <GearIcon size={16} />
            </button>
          </Tooltip>
          <Tooltip label="Close" side="bottom">
            <button onClick={handleClose}
              className="w-[30px] h-[30px] rounded-lg grid place-items-center text-muted hover:bg-elevated hover:text-fg">
              <CloseIcon size={15} />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* body — the active mode owns its sidebar + main + transport + status */}
      {mode === "tv" && <TvMode />}
      {mode === "radio" && <RadioMode />}
      {mode === "youtube" && <YouTubeMode hasKey={!!settings?.hasYoutubeKey} onOpenSettings={() => setShowSettings(true)} />}

      {showSettings && (
        <TvSettingsPopover settings={settings} onClose={() => setShowSettings(false)}
          onSave={(b) => save.mutate(b)} />
      )}

      <ResizeHandles onStart={beginResize} />
    </div>
  );
});
