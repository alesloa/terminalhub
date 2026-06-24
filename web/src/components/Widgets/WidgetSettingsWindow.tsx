import {
  forwardRef, useEffect, useImperativeHandle, useRef, useState,
  type CSSProperties, type ReactNode, type TransitionEventHandler,
} from "react";
import { createPortal } from "react-dom";
import type { WinRect } from "../../store/ui";
import { spacesBarBottom } from "../../store/ui";
import { useDraggableWindow, type WindowHandle } from "../../hooks/useDraggableWindow";
import { ResizeHandles } from "../ResizeHandles";

// The per-widget settings window. Follows the house window convention (grow out of the opener — here
// the card's gear — minimize back into it on close) but lives OUTSIDE the widget card: it portals to
// <body> with fixed positioning and opens beside the card, so the widget stays fully visible and you
// watch your changes land in real time. Generic shell — the body is whatever the widget supplies via
// the registry's renderWidgetSettings. forwardRef exposes the same minimize-to-icon close() so a
// second press on the gear collapses it instead of an instant unmount.

const MIN_W = 220, MIN_H = 200, DURATION = 300;
const SEED_W = 260, SEED_H = 340;

/** Open beside the gear (flip left if there's no room), clamped below the spaces bar. */
function seedRect(origin?: WinRect | null): WinRect {
  const vw = window.innerWidth, vh = window.innerHeight;
  const top = spacesBarBottom() + 8;
  let x = origin ? origin.x + origin.w + 10 : Math.round((vw - SEED_W) / 2);
  if (origin && x + SEED_W > vw - 8) x = origin.x - SEED_W - 10; // no room right → flip to the left
  x = Math.max(8, Math.min(x, vw - SEED_W - 8));
  const y = Math.max(top, Math.min(origin ? origin.y : Math.round((vh - SEED_H) / 2), vh - SEED_H - 8));
  return { w: SEED_W, h: SEED_H, x, y };
}

export const WidgetSettingsWindow = forwardRef<WindowHandle, {
  title: string;
  origin?: WinRect | null;
  onClose: () => void;
  children: ReactNode;
}>(function WidgetSettingsWindow({ title, origin, onClose, children }, ref) {
  const [seed] = useState(() => seedRect(origin));
  const { rect, beginDrag, beginResize } = useDraggableWindow(seed, MIN_W, MIN_H);
  const winRef = useRef<HTMLDivElement>(null);

  // Grow-from-icon on open, minimize-to-icon on close — identical to HelpModal/QuickTimerModal.
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

  // Click away (canvas, another window, anywhere) minimizes it back into the gear — unlike the global
  // tool windows, a per-widget settings panel is a transient popover and should get out of the way.
  // Deferred a frame so the opening gear-click doesn't immediately re-close it; clicks inside the
  // window or an open color popover (portaled to <body>, so outside this DOM subtree) don't count.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (winRef.current?.contains(t) || t.closest("[data-widget-popover]")) return;
      handleClose();
    };
    const raf = requestAnimationFrame(() => window.addEventListener("mousedown", onDown));
    return () => { cancelAnimationFrame(raf); window.removeEventListener("mousedown", onDown); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  return createPortal(
    <div ref={winRef} onTransitionEnd={onTransitionEnd} style={style}
      className="fixed z-50 flex flex-col rounded-lg overflow-hidden border border-edge-strong bg-canvas shadow-2xl">
      <div onPointerDown={beginDrag}
        className="flex h-7 shrink-0 items-center justify-between border-b border-edge px-3 cursor-move select-none">
        <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</span>
        <button onClick={handleClose} title="Close" onPointerDown={(e) => e.stopPropagation()}
          className="grid h-5 w-5 place-items-center rounded text-dim hover:bg-edge hover:text-bright">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
      <ResizeHandles onStart={beginResize} />
    </div>,
    document.body,
  );
});
