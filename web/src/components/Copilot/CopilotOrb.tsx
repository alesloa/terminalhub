import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useUi, rectOf, orbToAbsolute, orbAnchor, ORB_SIZE, ORB_MARGIN } from "../../store/ui";
import { useCopilotSettings } from "../../hooks/useCopilot";
import type { CopilotOrbPosition } from "../../api/types";

// The always-on Copilot affordance floating on the canvas. Tap it to open the window (growing out of
// the orb) or, when already open, to run the window's minimize-back-into-the-orb close — same two-press
// behavior as the TopBar tile. DRAG it to reposition: the position is stored as a gap from its nearest
// edges (`copilotOrbPos`, per-browser) and overrides the settings corner preset. Because it's edge-
// anchored, it TRACKS window resizes — an orb on the right side keeps its distance from the right edge
// (follows it as you resize), while one on the left/middle stays put. It also clamps into view, so a
// shrink never strands it off-screen.
const POS: Record<CopilotOrbPosition, string> = {
  "bottom-right": "bottom-16 right-6",
  "bottom-left": "bottom-16 left-6",
  "top-right": "top-20 right-6",
  "top-left": "top-20 left-6",
};

const DRAG_THRESHOLD = 5; // px moved before a press counts as a drag (below this it's a tap → open)

function clampToViewport(p: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.min(Math.max(p.x, ORB_MARGIN), window.innerWidth - ORB_SIZE - ORB_MARGIN),
    y: Math.min(Math.max(p.y, ORB_MARGIN), window.innerHeight - ORB_SIZE - ORB_MARGIN),
  };
}

export function CopilotOrb() {
  const settings = useCopilotSettings();
  const open = useUi((s) => s.copilotOpen);
  const setOpen = useUi((s) => s.setCopilotOpen);
  const orbPos = useUi((s) => s.copilotOrbPos);
  const setOrbPos = useUi((s) => s.setCopilotOrbPos);
  const ref = useRef<HTMLButtonElement>(null);
  // Live absolute position while dragging (committed to the store as an anchored gap on release).
  const [live, setLive] = useState<{ x: number; y: number } | null>(null);
  const [, bumpResize] = useState(0); // force a re-render on resize so the anchored gap re-resolves
  const drag = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);

  // Re-resolve the anchored position against the live viewport on every resize (no persistence needed —
  // the stored gap is resolution-independent, so it follows the edge it's anchored to and un-clamps when
  // the window grows back). Only matters once the orb has a free position.
  useEffect(() => {
    if (!orbPos) return;
    const onResize = () => bumpResize((n) => n + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [orbPos]);

  // Hidden while the window is open — it grew out of the orb, so the orb shouldn't sit under/over the
  // panel. The window owns its own close (✕); the orb reappears once the panel is gone.
  if (!settings.data?.enabled || !settings.data.orbEnabled || open) return null;

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || !ref.current) return;
    const r = ref.current.getBoundingClientRect(); // works whether anchored by preset class or free style
    drag.current = { startX: e.clientX, startY: e.clientY, origX: r.left, origY: r.top, moved: false };
    ref.current.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return; // still a tap, not a drag
    d.moved = true;
    setLive(clampToViewport({ x: d.origX + dx, y: d.origY + dy }));
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    drag.current = null;
    ref.current?.releasePointerCapture?.(e.pointerId);
    if (!d) return;
    if (d.moved) {
      if (live) setOrbPos(orbAnchor(live.x, live.y, window.innerWidth, window.innerHeight)); // anchor to nearest edges + persist
      setLive(null);
    } else if (ref.current) {
      setOpen(true, rectOf(ref.current)); // a clean tap → open the window from the orb
    }
  };

  const abs = live ?? (orbPos ? orbToAbsolute(orbPos, window.innerWidth, window.innerHeight) : null);
  const placed = abs ? clampToViewport(abs) : null;

  return (
    <button ref={ref} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      title="Assistant — drag to move" aria-label="Open Assistant"
      // zIndex at the 32-bit max so the orb is the ONE thing that sits above everything — including the
      // zoom control (…646) and the scroll bars (…645), which are otherwise uncoverable.
      style={{ zIndex: 2147483647, ...(placed ? { left: placed.x, top: placed.y } : {}) }}
      className={`fixed ${placed ? "" : POS[settings.data.orbPosition]} w-12 h-12 rounded-full bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 flex items-center justify-center select-none touch-none cursor-grab active:cursor-grabbing transition-transform hover:scale-105`}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3z" /></svg>
    </button>
  );
}
