import { useEffect } from "react";
import { createPortal } from "react-dom";
import { usePresence } from "../store/presence";

// The client half of a locked share link: a passive spectator. The terminal's typing/resize is already
// dropped on the SERVER (the hard boundary), so this overlay just neutralizes the rest of the UI — a
// full-viewport, transparent capture layer that eats every pointer/wheel event so nothing underneath can
// be clicked, dragged, or scrolled, plus a capture-phase key swallow so app shortcuts don't fire. Only a
// locked "key" viewer ever renders it; the owner is never locked.
export function ViewerLock(): JSX.Element | null {
  const locked = usePresence((s) => s.locked);

  useEffect(() => {
    if (!locked) return;
    // Swallow keys before any app-level window/document handler sees them (don't preventDefault, so the
    // browser's own shortcuts still work — we only block in-app hotkeys).
    const swallow = (e: KeyboardEvent) => e.stopPropagation();
    window.addEventListener("keydown", swallow, true);
    window.addEventListener("keyup", swallow, true);
    window.addEventListener("keypress", swallow, true);
    return () => {
      window.removeEventListener("keydown", swallow, true);
      window.removeEventListener("keyup", swallow, true);
      window.removeEventListener("keypress", swallow, true);
    };
  }, [locked]);

  if (!locked) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] cursor-default"
      style={{ pointerEvents: "auto" }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDownCapture={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onMouseDownCapture={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onClickCapture={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onWheelCapture={(e) => e.stopPropagation()}
    >
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs text-white shadow select-none">
        View-only — the host is presenting
      </div>
    </div>,
    document.body,
  );
}
