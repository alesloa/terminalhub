import { useEffect, useRef, useState, type CSSProperties, type TransitionEventHandler } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { CanvasBackground, Space } from "../api/types";
import type { WinRect } from "../store/ui";
import { spacesBarBottom } from "../store/ui";
import { useDraggableWindow } from "../hooks/useDraggableWindow";
import { ResizeHandles } from "./ResizeHandles";
import { CanvasBackgroundEditor } from "./CanvasBackgroundEditor";

const MIN_W = 360, MIN_H = 420, DURATION = 300;

/** A comfortable default box, placed near the opener point and clamped into the viewport / below the
 *  spaces bar. */
function defaultRect(origin: WinRect | null): WinRect {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(460, Math.round(vw * 0.9));
  const h = Math.min(580, Math.round(vh * 0.82));
  const top = spacesBarBottom() + 8;
  const x = origin ? Math.min(vw - w - 8, Math.max(8, origin.x - w / 2)) : Math.round((vw - w) / 2);
  const y = origin ? Math.min(vh - h - 8, Math.max(top, origin.y + 8)) : Math.max(top, Math.round((vh - h) / 2));
  return { w, h, x, y };
}

/** Per-space backdrop editor in a floating, draggable, resizable window that grows out of the
 *  right-click point and minimizes back into it on close (the Mac "change wallpaper" entry point).
 *  Edits this space's `background` override; persists optimistically (debounced PATCH). "Use global
 *  default" clears the override so the space follows Settings → Appearance again. */
export function SpaceBackgroundWindow({ spaceId, spaceName, initial, hasOverride, origin, onClose }: {
  spaceId: string; spaceName: string; initial: CanvasBackground; hasOverride: boolean; origin: WinRect | null; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [seed] = useState(() => defaultRect(origin));
  const { rect, beginDrag, beginResize } = useDraggableWindow(seed, MIN_W, MIN_H);
  const [value, setValue] = useState<CanvasBackground>(initial);
  const [override, setOverride] = useState(hasOverride);

  // Optimistically patch the spaces cache so the backdrop tracks edits instantly, and debounce the
  // PATCH so a slider drag doesn't hammer the server.
  const timer = useRef<number | null>(null);
  const persist = (bg: CanvasBackground | null) => {
    qc.setQueryData<{ spaces: Space[]; homeSpaceId: string | null; desktopWorkspaceId: string | null }>(["spaces"], (old) =>
      old ? { ...old, spaces: old.spaces.map(s => s.id === spaceId ? { ...s, background: bg } : s) } : old);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { api.updateSpace(spaceId, { background: bg }).catch(() => {}); }, 250);
  };
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const onChange = (next: CanvasBackground) => { setValue(next); setOverride(true); persist(next); };
  const useGlobal = () => { setOverride(false); persist(null); }; // clear override; keep showing the effective look

  // Grow-from-point on open, minimize-to-point on close.
  const reduce = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [expanded, setExpanded] = useState(reduce);
  useEffect(() => {
    if (reduce) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setExpanded(true)));
    return () => cancelAnimationFrame(id);
  }, [reduce]);
  const handleClose = () => { if (reduce) { onClose(); return; } setExpanded(false); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const onTransitionEnd: TransitionEventHandler = (e) => {
    if (e.target === e.currentTarget && e.propertyName === "transform" && !expanded) onClose();
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
      className="fixed z-[60] flex flex-col overflow-hidden rounded-lg border border-edge-strong bg-canvas shadow-2xl">
      <div onPointerDown={beginDrag}
        className="flex h-9 shrink-0 cursor-move select-none items-center justify-between border-b border-edge px-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-bright">Background</div>
        </div>
        <div className="flex items-center gap-2" onPointerDown={(e) => e.stopPropagation()}>
          <span className="truncate text-xs text-dim">{spaceName}</span>
          <button onClick={handleClose} title="Close"
            className="flex h-6 w-6 items-center justify-center rounded text-muted leading-none hover:bg-elevated hover:text-bright">×</button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <CanvasBackgroundEditor value={value} onChange={onChange} />
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-edge px-3 py-2">
        <span className="text-xs text-dim">{override ? "This space has its own background." : "Following the global default."}</span>
        <button onClick={useGlobal} disabled={!override}
          className="rounded bg-surface px-2.5 py-1 text-xs text-fg hover:bg-elevated disabled:opacity-40">
          Use global default
        </button>
      </div>

      <ResizeHandles onStart={beginResize} />
    </div>
  );
}
