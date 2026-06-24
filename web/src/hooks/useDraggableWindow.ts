import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { WinRect } from "../store/ui";
import { spacesBarBottom, useUi } from "../store/ui";
import { usePresence } from "../store/presence";
import type { ResizeDir } from "./useWindowDrag";
import { lockCursor } from "../lib/dragCursor";

// Cursor to lock for the whole drag, per direction — matches ResizeHandles' per-handle cursors.
const RESIZE_CURSOR: Record<ResizeDir, string> = {
  n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
  nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
};

// Keep a grabbable strip of the title bar on-screen so the window can't be lost off an edge.
const KEEP = 48;

// Imperative handle a floating window exposes to its opener (via forwardRef) so a second press on
// the TopBar icon can trigger the SAME minimize-to-icon close the window's own ✕ runs — not an
// instant unmount. `close()` starts the collapse animation; the window unmounts itself when it ends.
export type WindowHandle = { close: () => void };

/**
 * Drag + resize for a free-floating window whose geometry lives in local React state — the
 * generic sibling of useWindowDrag (which is bound to the room store). The title bar's top is
 * clamped below the spaces bar so it can never slide under it and become unreachable. Both
 * handlers mutate the rect live via pointer-move listeners and lock the cursor for the drag.
 */
export function useDraggableWindow(initial: WinRect, minW: number, minH: number, maxW = Infinity, maxH = Infinity, panelId?: string) {
  // Presentation mirroring (opt-in per panel via panelId). A mirror viewer opens the panel at the host's
  // geometry instead of its own default; the owner publishes geometry to the store so it can be mirrored.
  const role = usePresence((s) => s.role);
  const startRect = panelId && usePresence.getState().role === "key"
    ? (useUi.getState().panels[panelId]?.rect ?? initial)
    : initial;
  const [rect, setRect] = useState<WinRect>(startRect);

  // Owner: publish geometry (mount + live while dragging/resizing, throttled below, + an exact final
  // publish on release). A mirror viewer follows this for the panel, so the window tracks the host as
  // it moves — not just where it lands. No-op unless this is an owner with a mirrored panelId.
  const report = (r: WinRect) => {
    if (panelId && usePresence.getState().role === "main") useUi.getState().setPanelRect(panelId, r);
  };
  useEffect(() => {
    if (!panelId) return;
    if (role === "main") { useUi.getState().setPanelRect(panelId, rect); return; }
    if (role === "key") {
      return useUi.subscribe((s) => {
        const r = s.panels[panelId]?.rect;
        if (r) setRect((cur) => (cur.x === r.x && cur.y === r.y && cur.w === r.w && cur.h === r.h ? cur : r));
      });
    }
  }, [panelId, role]); // eslint-disable-line react-hooks/exhaustive-deps
  // Clamp a dragged dimension into [min, max]. maxW/maxH default to Infinity, so callers that don't
  // pass them keep the old min-only behavior (no upper cap).
  const cw = (w: number) => Math.min(maxW, Math.max(minW, w));
  const ch = (h: number) => Math.min(maxH, Math.max(minH, h));

  const clamp = (r: WinRect, minY: number): WinRect => {
    const vw = window.innerWidth, vh = window.innerHeight;
    return {
      w: r.w, h: r.h,
      x: Math.max(KEEP - r.w, Math.min(vw - KEEP, r.x)),
      y: Math.max(minY, Math.min(vh - KEEP, r.y)),
    };
  };

  // Move the window by dragging its title bar. Ignores drags that start on a button.
  const beginDrag = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const release = lockCursor("move");
    const sx = e.clientX, sy = e.clientY, start = { ...rect };
    const minY = spacesBarBottom(); // fixed for this drag — the bar's height doesn't change mid-move
    let latest = start;
    let lastReport = 0; // throttle the live mirror-publish to ~30fps so the viewer tracks the move smoothly
    const onMove = (ev: PointerEvent) => {
      latest = clamp({ ...start, x: start.x + (ev.clientX - sx), y: start.y + (ev.clientY - sy) }, minY);
      setRect(latest);
      const now = Date.now();
      if (now - lastReport >= 33) { lastReport = now; report(latest); }
    };
    const onUp = () => { release(); window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); report(latest); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Resize from an edge or corner. Edges anchored opposite the dragged side.
  const beginResize = (dir: ResizeDir) => (e: ReactPointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const release = lockCursor(RESIZE_CURSOR[dir]);
    const sx = e.clientX, sy = e.clientY, start = { ...rect };
    const minY = spacesBarBottom();
    let latest = start;
    let lastReport = 0; // throttle the live mirror-publish to ~30fps so the viewer tracks the resize smoothly
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      let { x, y, w, h } = start;
      if (dir.includes("e")) w = cw(start.w + dx);
      if (dir.includes("s")) h = ch(start.h + dy);
      if (dir.includes("w")) { w = cw(start.w - dx); x = start.x + (start.w - w); }
      // North edge: keep the top below the spaces bar — give back any height that would cross it.
      if (dir.includes("n")) { h = ch(start.h - dy); y = start.y + (start.h - h); if (y < minY) { h -= minY - y; y = minY; } }
      latest = { x, y, w, h };
      setRect(latest);
      const now = Date.now();
      if (now - lastReport >= 33) { lastReport = now; report(latest); }
    };
    const onUp = () => { release(); window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); report(latest); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return { rect, setRect, beginDrag, beginResize };
}
