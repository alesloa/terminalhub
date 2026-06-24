import { useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import type { ResizeDir } from "../hooks/useWindowDrag";

// All 8 resize grab targets live in a body portal that mirrors the window's screen rect, NOT inside the
// window frame. Two reasons the in-frame approach fell short:
//   1. The frame is rounded-lg + overflow-hidden, so a corner handle inside it gets its outer pixels
//      clipped by the rounded corner — you had to reach into the window before a diagonal resize armed.
//   2. The frame is its own stacking context, so in-frame chrome (e.g. the Room's BottomBar) painted
//      over an in-frame edge handle, swallowing the bottom edge.
// A body-level fixed overlay sits above the ENTIRE frame and every descendant, and isn't clipped — so
// the handles can overhang the window by OVERHANG px and arm right at (or just past) the real border.
// The grab area lives mostly OUTSIDE the window (the overhang) plus the border — it deliberately
// reaches only ~2px past the window edge so it doesn't sit on top of content that hugs the edge. The
// right edge in particular runs alongside the 10px scrollbar (theme.css), and because these handles
// portal above the whole frame, any deeper inward reach would steal the scrollbar thumb's pointer.
const OVERHANG = 8;    // px the grab band sticks out past each window edge — the real grab zone is here
const EDGE = 9;        // edge band thickness: OVERHANG out + ~1px lip over the border (clears the bar)
const CORNER = 12;     // corner square footprint: OVERHANG out + ~4px reaching to the corner
const EDGE_INSET = 10; // gap from each overlay end where the edge band starts — corners own past this

// Cursors use the high-visibility custom vars (dark arrow + white outline, theme.css) so the cursor is
// readable on a dark terminal; falls back to the native keyword if unset. Corners come AFTER edges in
// the list so they render on top and win the overlapping pointer area near each corner.
const HANDLES: { dir: ResizeDir; pos: CSSProperties; cursor: string }[] = [
  { dir: "n", pos: { top: 0, left: EDGE_INSET, right: EDGE_INSET, height: EDGE },    cursor: "var(--cur-ns-resize, ns-resize)" },
  { dir: "s", pos: { bottom: 0, left: EDGE_INSET, right: EDGE_INSET, height: EDGE }, cursor: "var(--cur-ns-resize, ns-resize)" },
  { dir: "e", pos: { right: 0, top: EDGE_INSET, bottom: EDGE_INSET, width: EDGE },   cursor: "var(--cur-ew-resize, ew-resize)" },
  { dir: "w", pos: { left: 0, top: EDGE_INSET, bottom: EDGE_INSET, width: EDGE },    cursor: "var(--cur-ew-resize, ew-resize)" },
  { dir: "nw", pos: { top: 0, left: 0, width: CORNER, height: CORNER },     cursor: "var(--cur-nwse-resize, nwse-resize)" },
  { dir: "ne", pos: { top: 0, right: 0, width: CORNER, height: CORNER },    cursor: "var(--cur-nesw-resize, nesw-resize)" },
  { dir: "sw", pos: { bottom: 0, left: 0, width: CORNER, height: CORNER },  cursor: "var(--cur-nesw-resize, nesw-resize)" },
  { dir: "se", pos: { bottom: 0, right: 0, width: CORNER, height: CORNER }, cursor: "var(--cur-nwse-resize, nwse-resize)" },
];

type Box = { left: number; top: number; width: number; height: number; z: number };

/**
 * Invisible drag targets around the floating window's edges and corners. Because the handles live in a
 * body portal that overhangs the window, an UNFOCUSED window's handles would otherwise sit above (and
 * steal the resize of) a window stacked in front of it — so pass `active={false}` on any window that
 * isn't the focused/topmost one and its handles won't render at all. Defaults to active.
 */
export function ResizeHandles({ onStart, active = true }: { onStart: (dir: ResizeDir) => (e: ReactPointerEvent) => void; active?: boolean }) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [box, setBox] = useState<Box | null>(null);

  // Measure the parent frame and mirror its screen rect into the portal overlay. Track every way the
  // frame can move or resize: ResizeObserver (live resize), MutationObserver on style/class (drag +
  // maximize toggle), window resize/scroll, and the open/close animation settling.
  useLayoutEffect(() => {
    const frame = anchorRef.current?.parentElement;
    if (!frame) return;
    const measure = () => {
      const r = frame.getBoundingClientRect();
      const zRaw = getComputedStyle(frame).zIndex;
      const z = zRaw === "auto" || zRaw === "" ? 50 : Number(zRaw);
      setBox({ left: r.left, top: r.top, width: r.width, height: r.height, z: Number.isNaN(z) ? 50 : z });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(frame);
    const mo = new MutationObserver(measure);
    mo.observe(frame, { attributes: true, attributeFilter: ["style", "class"] });
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    frame.addEventListener("transitionend", measure);
    frame.addEventListener("animationend", measure);
    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      frame.removeEventListener("transitionend", measure);
      frame.removeEventListener("animationend", measure);
    };
  }, []);

  return (
    <>
      {/* Hidden anchor — only used to find the parent frame element to measure. */}
      <span ref={anchorRef} className="hidden" aria-hidden />
      {box && active && createPortal(
        <div className="pointer-events-none fixed"
          style={{ left: box.left - OVERHANG, top: box.top - OVERHANG, width: box.width + OVERHANG * 2, height: box.height + OVERHANG * 2, zIndex: box.z + 1 }}>
          {HANDLES.map(h => (
            <div key={h.dir} onPointerDown={onStart(h.dir)}
              style={{ ...h.pos, cursor: h.cursor }}
              className="pointer-events-auto absolute" />
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
