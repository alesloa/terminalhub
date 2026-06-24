import { useEffect, useRef } from "react";
import { spacesBarBottom } from "../store/ui";

type Box = { id: string; x: number; y: number; w: number; h: number };

// Debounce before persisting, matching the canvas-background persist debounce (SettingsModal.tsx).
const SETTLE_MS = 250;

/**
 * macOS-style "rescue windows off a removed display": after the browser settles at a new (usually
 * smaller) size, pull every canvas item whose box now falls (partly) outside the viewport fully back
 * into view and persist the corrected spot — the "move in & stay" behaviour. An item is placed flush
 * inside the viewport when it fits, or pinned to the top-left (just below the spaces bar) when it's
 * larger than the viewport. We reposition only, never resize the item.
 *
 * Debounced so a drag-resize of the window writes once on settle, not on every resize frame. `save`
 * round-trips through the item's own hook (optimistic cache patch → the card re-syncs its box and
 * slides into view), so this serves widgets and sticky notes alike.
 *
 * Resize-only on purpose (no rescue on mount): positions are shared through the server, so rescuing
 * on load would let merely opening the app in a small window clobber a layout authored on a big one.
 */
export function useRescueOnResize(
  items: Box[],
  save: (id: string, patch: { x: number; y: number }) => void,
) {
  // Read the live items/save at fire time (the listener is registered once) so a debounced rescue
  // always acts on the current rows, not a stale closure from mount.
  const latest = useRef({ items, save });
  latest.current = { items, save };

  useEffect(() => {
    let timer: number | undefined;
    const rescue = () => {
      const vw = window.innerWidth, vh = window.innerHeight, top = spacesBarBottom();
      for (const b of latest.current.items) {
        // Fully visible when it fits; pinned to the top-left corner when larger than the viewport.
        const x = Math.min(Math.max(0, b.x), Math.max(0, vw - b.w));
        const y = Math.min(Math.max(top, b.y), Math.max(top, vh - b.h));
        if (x !== b.x || y !== b.y) latest.current.save(b.id, { x, y });
      }
    };
    const onResize = () => { window.clearTimeout(timer); timer = window.setTimeout(rescue, SETTLE_MS); };
    window.addEventListener("resize", onResize);
    return () => { window.clearTimeout(timer); window.removeEventListener("resize", onResize); };
  }, []);
}
