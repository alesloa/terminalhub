import { type PointerEvent as ReactPointerEvent } from "react";
import { spacesBarBottom, type WinRect } from "../store/ui";
import { useRoom } from "../store/room";
import { lockCursor } from "../lib/dragCursor";

// Min height keeps both panes usable at the smallest window: title(32) + bottombar(28) +
// dock resizer(6) + editor floor(120) + dock floor(120). Below this the editor would crush.
const MIN_W = 360, MIN_H = 306;

// Gap below the spaces bar that a dragged/resized window's top can't cross. spacesBarBottom()
// measures the inner strip, which paints ~5px short of the bar's actual bottom; adding the same 8px
// the open path uses (defaultWindowRect) and the maximized room uses (Room's MAXIMIZED_GAP) clears
// the bar AND lands a window dragged to the top on the exact same line a fresh/maximized one opens at,
// instead of letting its top border slide under the bar. One source for the window's top floor.
const TOP_GAP = 8;
const topFloor = () => spacesBarBottom() + TOP_GAP;

/** Resize direction: any combination of n/s/e/w (e.g. "se" = bottom-right corner). */
export type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

// Cursor to lock for the whole drag, per direction — matches ResizeHandles' per-handle cursors.
const RESIZE_CURSOR: Record<ResizeDir, string> = {
  n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
  nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
};

// Keep just a grabbable strip of the window on-screen — don't trap the whole thing inside the
// viewport. This lets you shove a window almost entirely off any edge (the old full-containment
// clamp pinned a screen-sized window at 0,0, so it couldn't move at all). The top is clamped the
// same as every other edge (a KEEP strip stays on-screen) — NOT pinned below the spaces bar: the
// canvas is infinite and a windowed room pans with the canvas camera (RoomPanLayer), so a window
// dragged up under the bar / off the top is always recoverable by panning the board back down (or
// via the room taskbar). `minY` is still passed through for the north-resize edge below.
const KEEP = 48;
const clampDraggable = (r: WinRect): WinRect => {
  const vw = window.innerWidth, vh = window.innerHeight;
  return {
    w: r.w, h: r.h,
    x: Math.max(KEEP - r.w, Math.min(vw - KEEP, r.x)),
    y: Math.max(KEEP - r.h, Math.min(vh - KEEP, r.y)),
  };
};

/**
 * Drag and resize handlers for the floating room window. Geometry lives in the UI
 * store (session-remembered); these mutate it live via pointer move listeners — the
 * same pattern as the dock resizer in Room. Both no-op while maximized (rect null).
 */
export function useWindowDrag(setDragging?: (dragging: boolean) => void) {
  const rect = useRoom(s => s.windowRect);
  const setRect = useRoom(s => s.setWindowRect);

  // Run a live pointer-drag against the window rect, coalescing writes to one per animation frame.
  // pointermove fires far faster than the display refresh (120-1000Hz on modern trackpads/mice), and
  // every write re-renders the room — so we stash the latest computed rect and flush at most once per
  // frame. The window is positioned with a transform (see Room.tsx), so moving it is GPU-composited:
  // no per-frame layout/paint, which is what made a big Markdown document jank. `setDragging(true)`
  // drops the transform transition for the duration so the window tracks the pointer 1:1; the final
  // rect is committed straight from the last pointer position on release, so it lands exactly there.
  const runDrag = (
    cursor: string,
    compute: (ev: PointerEvent, start: WinRect, minY: number) => WinRect,
  ) => {
    const start = { ...rect! };
    const release = lockCursor(cursor);
    const minY = topFloor(); // fixed for this drag — the bar's height doesn't change mid-move
    setDragging?.(true);
    let pending = start, raf = 0;
    const flush = () => { raf = 0; setRect(pending); };
    const onMove = (ev: PointerEvent) => {
      pending = compute(ev, start, minY);
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const onUp = () => {
      release();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (raf) cancelAnimationFrame(raf);
      setRect(pending); // commit the exact final pointer position — no rounding, no snap-back
      setDragging?.(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Move the window by dragging its title bar. Ignores drags that start on a button.
  const beginDrag = (e: ReactPointerEvent) => {
    // Left button only: a MIDDLE-button press on the title bar must fall through to the canvas
    // grab-pan (the Figma hand tool works over an open IDE window too), and right never starts a move.
    if (e.button !== 0 || !rect || (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    runDrag("move", (ev, start) =>
      clampDraggable({ ...start, x: start.x + (ev.clientX - sx), y: start.y + (ev.clientY - sy) }));
  };

  // Resize from an edge or corner. Edges anchored opposite the dragged side.
  const beginResize = (dir: ResizeDir) => (e: ReactPointerEvent) => {
    // Left button only — a middle-click on a resize edge pans the canvas instead of resizing.
    if (e.button !== 0 || !rect) return;
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY;
    runDrag(RESIZE_CURSOR[dir], (ev, start, minY) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      let { x, y, w, h } = start;
      if (dir.includes("e")) w = Math.max(MIN_W, start.w + dx);
      if (dir.includes("s")) h = Math.max(MIN_H, start.h + dy);
      if (dir.includes("w")) { w = Math.max(MIN_W, start.w - dx); x = start.x + (start.w - w); }
      // North edge: keep the top below the spaces bar — give back any height that would cross it.
      if (dir.includes("n")) { h = Math.max(MIN_H, start.h - dy); y = start.y + (start.h - h); if (y < minY) { h -= minY - y; y = minY; } }
      return { x, y, w, h };
    });
  };

  return { beginDrag, beginResize };
}
