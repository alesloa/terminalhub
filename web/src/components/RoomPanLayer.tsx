import { useEffect, useRef, type ReactNode } from "react";
import { useUi } from "../store/ui";
import { DEFAULT_CAMERA } from "../canvas/camera";

/**
 * Pans a floating room with its space's canvas camera so an open IDE window stays glued to its spot on
 * the board as you drag the canvas. A windowed room is a screen-space overlay, so we translate it by the
 * camera's PAN delta since the room opened — the baseline is captured at mount, so the room first paints
 * exactly where its card is, then follows. A MAXIMIZED room is fullscreen and is never panned.
 *
 * The translate is written imperatively from a store subscription (not React state), so the heavy Room
 * subtree (Monaco, terminals) never re-renders while you pan — only this wrapper's transform changes.
 * Zoom is deliberately NOT applied: the IDE keeps its readable fixed pixel size instead of scaling with
 * the board (a CSS-scaled terminal/editor would blur and mis-measure its grid).
 */
export function RoomPanLayer({ spaceId, workspaceId, children }: { spaceId: string; workspaceId: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const cam0 = useUi.getState().cameraBySpace[spaceId] ?? DEFAULT_CAMERA;
    const baseX = cam0.x, baseY = cam0.y; // pan at open — the follow is the delta from here
    let last = "";
    const apply = () => {
      const st = useUi.getState();
      const maximized = !!st.roomMaximized[workspaceId];
      const cam = st.cameraBySpace[spaceId] ?? DEFAULT_CAMERA;
      const dx = cam.x - baseX, dy = cam.y - baseY;
      const key = maximized ? "max" : `${dx},${dy}`;
      if (key === last) return; // cheap guard: the store subscription fires on EVERY state change
      last = key;
      const el = ref.current;
      if (el) el.style.transform = maximized ? "" : `translate(${dx}px, ${dy}px)`;
    };
    apply();
    return useUi.subscribe(apply);
  }, [spaceId, workspaceId]);
  return (
    <div ref={ref} className="absolute inset-0 pointer-events-none" style={{ willChange: "transform" }}>
      {children}
    </div>
  );
}
