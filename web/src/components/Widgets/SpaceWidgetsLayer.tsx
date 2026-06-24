import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useUi } from "../../store/ui";
import { cameraTransform, DEFAULT_CAMERA } from "../../canvas/camera";
import { useSpaceWidgets } from "./useSpaceWidgets";
import { SpaceWidgetCard } from "./SpaceWidgetCard";

// Renders the widgets dropped onto the canvas. Mirrors StickyNotesLayer: a viewport-fixed, pointer-
// transparent stage below the rooms (z-30); each widget rides a per-space "slider" that pans
// horizontally with the spaces filmstrip so it stays on its own space's desktop. Inside that slider a
// world layer carries the space's canvas camera (cameraTransform) so widgets are full BOARD CITIZENS —
// they pan AND zoom in lockstep with the workspace cards, instead of floating in fixed viewport space.
// A slider for an OFF-SCREEN (non-active) space clips its own column (overflow-hidden) — load-bearing:
// the slide is 100vw but x is absolute px, so a neighbour space's widget placed past a later-shrunk
// viewport would otherwise bleed into the active one. The active column is left UNCLIPPED on purpose:
// the outer stage already clips it to the viewport, and clipping the column a card is dragged in churns
// the card's transform layer on a group-drag drop, flashing it at its pre-drop spot (heavy widgets only).
export function SpaceWidgetsLayer() {
  const { widgets, save, remove } = useSpaceWidgets();
  const spaces = useQuery({ queryKey: ["spaces"], queryFn: api.listSpaces }).data?.spaces ?? [];
  const activeSpaceId = useUi((s) => s.activeSpaceId);
  // Every space's camera. Reading the whole map re-renders this layer on any pan/zoom (same as the card
  // canvas), so the world-layer transform below stays in lockstep with the cards frame-for-frame.
  const cameras = useUi((s) => s.cameraBySpace);

  const spaceIndex = useMemo(() => {
    const m = new Map<string, number>();
    spaces.forEach((s, i) => m.set(s.id, i));
    return m;
  }, [spaces]);
  const activeIndex = spaceIndex.get(activeSpaceId ?? "") ?? 0;

  if (widgets.length === 0) return null;

  return (
    <div className="fixed inset-0 z-30 overflow-hidden pointer-events-none">
      {widgets.map((w) => {
        const idx = spaceIndex.get(w.spaceId ?? "") ?? activeIndex;
        const cam = cameras[w.spaceId ?? ""] ?? DEFAULT_CAMERA;
        return (
          <div key={w.id} className={`absolute inset-0 pointer-events-none ${idx === activeIndex ? "" : "overflow-hidden"}`}
            style={{ transform: `translateX(${(idx - activeIndex) * 100}%)`, transition: "transform 300ms ease" }}>
            {/* World layer: the per-space camera pans + zooms the widget exactly like the card board
                (transformOrigin 0 0 is required for the camera math, canvas/camera.ts, to hold). */}
            <div style={{ position: "absolute", top: 0, left: 0, transformOrigin: "0 0", willChange: "transform",
                          transform: cameraTransform(cam) }}>
              <SpaceWidgetCard widget={w} save={save} remove={remove} zoom={cam.zoom} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
