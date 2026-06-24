import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePresence } from "../store/presence";
import { useUi } from "../store/ui";
import { DEFAULT_CAMERA, worldToScreen } from "../canvas/camera";

// Live "phantom" cursors of the other connected people (owner browsers + admitted teammates), drawn over
// the canvas AND over every floating window. Cursor coords arrive in WORLD space — the same frame cards
// live in — so a ghost lands on the same card on every screen regardless of window size or each peer's pan/zoom.
//
// The ghosts live in a body-level portal pinned to the viewport at a z-index ABOVE the floating windows
// and modals (which sit at z-[80]); a canvas-nested overlay would be trapped in the canvas stacking
// context and slip behind those windows. We map world → viewport through THIS browser's camera for the
// space plus the host's viewport offset: viewportX = hostLeft + (worldX*zoom + camX). The host rect is
// re-measured on resize; the camera read re-renders us on every pan/zoom. pointer-events:none so ghosts
// never block clicks/drags. Only cursors on THIS space show; the server never echoes your own.
export function CursorLayer({ spaceId, hostRef }: { spaceId: string; hostRef: { current: HTMLDivElement | null } }) {
  const cursors = usePresence((s) => s.cursors);
  const selfId = usePresence((s) => s.selfId);
  // This browser's camera for the space being viewed — maps a peer's world cursor onto our screen.
  const cam = useUi((s) => s.cameraBySpace[spaceId]) ?? DEFAULT_CAMERA;
  // The host viewport's top-left offset. Re-measured on resize (the camera handles all pan/zoom motion).
  const [m, setM] = useState({ left: 0, top: 0 });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      const r = host.getBoundingClientRect();
      setM({ left: r.left, top: r.top });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [hostRef]);

  const here = Object.entries(cursors).filter(([id, c]) => id !== selfId && c.space === spaceId);

  // z-[150]: above floating windows/modals (z-[80]) and the stats bar (z-[100]), below the full-screen
  // veils that intentionally cover everything (break/admission at z-[200]).
  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[150] overflow-hidden">
      {here.map(([id, c]) => {
        const p = worldToScreen(c.x, c.y, cam);
        return (
        <div
          key={id}
          className="absolute select-none"
          style={{ left: m.left + p.x, top: m.top + p.y, transition: "left 90ms linear, top 90ms linear" }}
        >
          {/* Cursor arrow, tinted to the peer's colour. */}
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,.4))" }}>
            <path d="M2 2 L2 14 L5.5 10.5 L8 16 L10.5 15 L8 9.5 L13 9.5 Z" fill={c.color} stroke="white" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          {/* Name tag. */}
          <span
            className="absolute left-3.5 top-3.5 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium text-white shadow"
            style={{ backgroundColor: c.color }}
          >
            {c.name}
          </span>
        </div>
        );
      })}
    </div>,
    document.body,
  );
}
