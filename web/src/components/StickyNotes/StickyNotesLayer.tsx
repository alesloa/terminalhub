import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { StickyNote as StickyNoteRow } from "../../api/types";
import { useUi } from "../../store/ui";
import { cameraTransform, DEFAULT_CAMERA } from "../../canvas/camera";
import { useStickyNotes } from "./useStickyNotes";
import { StickyNote } from "./StickyNote";

/** Renders sticky notes across all spaces plus the "new note" button at the canvas's top-right.
 *  Notes live in two viewport-fixed, overflow-clipped stages — unpinned (z-30, below the rooms
 *  stage) and pinned (z-45, above it) — and each note is wrapped in a slider that pans horizontally
 *  in lockstep with the card filmstrip / rooms stage when you switch spaces (translateX = (note's
 *  space index − active index) × 100vw), instead of just popping in and out. Mounted once inside the
 *  canvas container. */
export function StickyNotesLayer() {
  const activeSpaceId = useUi((s) => s.activeSpaceId);
  const { notes, save, remove } = useStickyNotes();
  // Every space's camera — reading the whole map re-renders this layer on any pan/zoom so the world-layer
  // transform below stays in lockstep with the card board frame-for-frame (a note is a board citizen now).
  const cameras = useUi((s) => s.cameraBySpace);
  // Shares SpacePager's cached ["spaces"] poll (react-query dedups) for ordering + the move menu.
  const { data: spacesData } = useQuery({ queryKey: ["spaces"], queryFn: api.listSpaces });
  const spaces = spacesData?.spaces ?? [];

  // Order spaces → index so a note can slide to its space's column, matching SpacePager's filmstrip
  // and the rooms stage in App.tsx. Unknown/unset spaces fall back to the active column (offset 0).
  const spaceIndex = useMemo(() => {
    const m = new Map<string, number>();
    spaces.forEach((s, i) => m.set(s.id, i));
    return m;
  }, [spaces]);
  const activeIndex = spaceIndex.get(activeSpaceId ?? "") ?? 0;

  // Don't slide on first load (same reasoning as SpacePager): hold the transition off until one rAF
  // after spaces arrive, so the remembered space's notes simply *are there* on refresh instead of
  // panning in from Home. Later user-driven space switches still glide.
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    if (animate || !spaces.length) return;
    const id = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(id);
  }, [animate, spaces.length]);

  // One note in its sliding wrapper. The wrapper's transform makes it the (transformed) containing
  // block for the absolutely-positioned note, so at offset 0 the note's left/top map 1:1 to the
  // viewport; sliding the wrapper pans the note. A wrapper for an OFF-SCREEN (non-active) space also
  // clips its own column (overflow-hidden) — load-bearing: the slide is 100vw but x is absolute px, so
  // a neighbour space's note placed past a later-shrunk viewport would otherwise bleed into the active
  // one. The active column is left UNCLIPPED on purpose (the outer stage already clips it to the
  // viewport, and clipping the dragged column flashes a card on a group-drag drop). pointer-events-none
  // lets clicks fall through the full-viewport stages; StickyNote itself re-enables them.
  const slider = (note: StickyNoteRow) => {
    const idx = spaceIndex.get(note.spaceId ?? "") ?? activeIndex;
    const cam = cameras[note.spaceId ?? ""] ?? DEFAULT_CAMERA;
    return (
      <div key={note.id} className={`absolute inset-0 pointer-events-none ${idx === activeIndex ? "" : "overflow-hidden"}`}
        style={{ transform: `translateX(${(idx - activeIndex) * 100}%)`, transition: animate ? "transform 300ms ease" : "none" }}>
        {/* World layer: the per-space camera pans + zooms the note exactly like the card board
            (transformOrigin 0 0 is required for the camera math, canvas/camera.ts, to hold). */}
        <div style={{ position: "absolute", top: 0, left: 0, transformOrigin: "0 0", willChange: "transform",
                      transform: cameraTransform(cam) }}>
          <StickyNote note={note} spaces={spaces} save={save} remove={remove} zoom={cam.zoom} />
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Creating a sticky note now lives in the Widgets gallery (TopBar → Widgets → "Sticky Note"),
          so there's no standalone canvas button — this layer only renders the notes themselves. */}
      {spaces.length > 0 && (
        <>
          {/* Unpinned notes: below the rooms stage (z-40). */}
          <div className="fixed inset-0 z-30 overflow-hidden pointer-events-none">
            {notes.filter((n) => !n.pinned).map(slider)}
          </div>
          {/* Pinned notes: above the rooms stage so they keep floating over an open room. */}
          <div className="fixed inset-0 z-[45] overflow-hidden pointer-events-none">
            {notes.filter((n) => n.pinned).map(slider)}
          </div>
        </>
      )}
    </>
  );
}
