import { useEffect, useState } from "react";

/** How close to the very top of the viewport the pointer must come to pull the hidden bar back down.
 *  Small on purpose: a maximized room's own title bar starts at y 0, so a fat reveal strip would make
 *  the bar flash every time you reach for the room's Close button. */
const REVEAL_ZONE = 4; // px
/** Once revealed the bar stays down until the pointer leaves it, plus a little slack so a jittery
 *  mouse right on the seam doesn't strobe the bar. Matches the bar's own `h-14` (56px). */
const BAR_HEIGHT = 56; // px
const HIDE_BELOW = BAR_HEIGHT + 8; // px

/**
 * Auto-hide behaviour for the Terminal Hub top bar.
 *
 * A maximized room is true fullscreen — it fills from y 0, so the z-[110] top bar paints straight
 * over the room's own title bar and swallows its minimize/close buttons. While `enabled` (a
 * fullscreen room is on the active space) the bar slides up out of the way, and comes back when the
 * pointer touches the top edge of the screen.
 *
 * Pointer position (not `pointerenter` on the bar) drives this: while the bar is hidden it sits
 * off-screen and can never receive an enter event, and a real hover strip laid over the top edge
 * would eat clicks meant for the room underneath.
 *
 * `pinned` holds the bar down regardless — TopBar passes its open anchored popovers, which portal to
 * `document.body` below the bar and would otherwise look detached the moment the pointer moves off it.
 */
export function useAutoHideTopBar(enabled: boolean, pinned = false): boolean {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!enabled) { setRevealed(false); return; }
    const onMove = (e: PointerEvent) => {
      setRevealed(prev => (prev ? e.clientY <= HIDE_BELOW : e.clientY <= REVEAL_ZONE));
    };
    // Keyboard-only users (and anyone tabbing into the bar) still need it: reveal whenever focus
    // lands inside the bar.
    const onFocus = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("[data-spaces-strip]")) setRevealed(true);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("focusin", onFocus);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("focusin", onFocus);
    };
  }, [enabled]);

  return enabled && !revealed && !pinned;
}
