import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { DndContext, useDraggable, useDroppable, useSensor, useSensors, MouseSensor, TouchSensor, pointerWithin, type DragEndEvent, type DragMoveEvent, type DragOverEvent, type DragStartEvent, type Modifier } from "@dnd-kit/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Workspace, Space, Folder, CanvasBackground } from "../api/types";
import { WorkspaceCard } from "./WorkspaceCard";
import { FolderTile } from "./Folders/FolderTile";
import { FolderOverlay } from "./Folders/FolderOverlay";
import { useFolders } from "./Folders/useFolders";
import { useAttention } from "../hooks/useAttention";
import { useWorking } from "../hooks/useWorking";
import { useUi, itemKey, CANVAS_ZOOM_MIN, CANVAS_ZOOM_MAX, type RoomOrigin, type WinRect } from "../store/ui";
import { DEFAULT_CAMERA, cameraTransform, screenToWorld, panBy, fitToBounds, zoomAround as camZoomAround } from "../canvas/camera";
import { snapToGrid, gridCells, byCell, nextFreeCell, GAP, MARGIN, CARD_H as GRID_CARD_H } from "../lib/grid";
import { Item, Sep } from "./TerminalContextMenu";
import { SpaceBackgroundWindow } from "./SpaceBackgroundWindow";
import { DEFAULT_CANVAS_BACKGROUND } from "../lib/wallpapers";
import { useStickyNotes } from "./StickyNotes/useStickyNotes";
import { NOTE_W, NOTE_H } from "./StickyNotes/StickyNote";
import { useSpaceWidgets } from "./Widgets/useSpaceWidgets";
import { usePresence } from "../store/presence";
import { CursorLayer } from "./CursorLayer";
import { STATS_BAR_HEIGHT } from "./SystemStatsBar";
import { lockCursor } from "../lib/dragCursor";

// Rough card/folder footprint (px, unscaled world) used only by Fit-to-view to frame the board. The
// real cards are content-height; an over-estimate just adds a little padding to the fit.
const CARD_W = 288;
const CARD_H = 220;

// dnd-kit's stock MouseSensor starts a card drag on ANY button except right-click — so the MIDDLE button
// (the canvas pan) would also pick up a card. Restrict card dragging to the LEFT button so middle-drag is
// free to pan over cards without grabbing them. (Right-click already opens the context menu.)
class LeftMouseSensor extends MouseSensor {
  static activators = [
    {
      eventName: "onMouseDown" as const,
      handler: ({ nativeEvent: event }: ReactMouseEvent) => event.button === 0, // left button only
    },
  ];
}

// Safari/iPad pinch ("gesture") events aren't in the TS DOM lib — minimal shape for the bits we read.
interface GestureLikeEvent extends Event { scale: number; clientX: number; clientY: number; }

function DraggableCard({ ws, snap, zoom, spaces, isDesktop, overActive, onOpen, onDelete, onColor, onMove, onRename, attentionIds, workingIds }: {
  ws: Workspace; snap: boolean; zoom: number; spaces: Space[]; isDesktop: boolean; overActive: boolean;
  onOpen: (origin: RoomOrigin | null) => void; onDelete: () => void;
  onColor: (id: string, color: string | null) => void; onMove: (spaceId: string) => void;
  onRename: (id: string, name: string) => void;
  attentionIds: Set<string>; workingIds: Set<string>;
}) {
  const entry = useUi(s => s.openRooms.find(r => r.workspaceId === ws.id));
  const isOpen = !!entry;
  // While its room is open the card is grayed-out and inert — so it can't be dragged. The Home
  // catch-all never drags either.
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: ws.id, disabled: isOpen });
  // Also a drop target so another card dropped onto it forms a folder. The Desktop catch-all is never
  // a grouping target, and an open card can't be grouped into either. `overActive` (set by the canvas
  // while a card hovers this one) lights it up.
  const { setNodeRef: setDropRef } = useDroppable({ id: ws.id, disabled: isDesktop || isOpen });
  const elRef = useRef<HTMLDivElement | null>(null);
  // Merge dnd-kit's drag + drop refs with our own so we can read the card's viewport rect on Open.
  const setRefs = useCallback((el: HTMLDivElement | null) => { setNodeRef(el); setDropRef(el); elRef.current = el; }, [setNodeRef, setDropRef]);

  // Local render position. Persisted coords (ws.x/y) stay the source of truth, but on drop we fold
  // the final drag delta into `pos` before paint (useLayoutEffect) so the card never flashes back to
  // its pre-drag spot. Adopting ws.x/y in a layout effect keeps refetches in sync. Coords are raw
  // world units now — free placement, no clamp (the camera can pan anything back into view).
  const [pos, setPos] = useState({ x: ws.x, y: ws.y });
  useLayoutEffect(() => { setPos({ x: ws.x, y: ws.y }); }, [ws.x, ws.y]);
  const prevTransform = useRef(transform);
  useLayoutEffect(() => {
    const prev = prevTransform.current;
    if (prev && !transform) setPos((p) => {
      const x = p.x + prev.x, y = p.y + prev.y;
      return snap ? snapToGrid(x, y) : { x, y };
    });
    prevTransform.current = transform;
  }, [transform, snap]);

  const x = pos.x + (transform?.x ?? 0), y = pos.y + (transform?.y ?? 0);
  // Canvas multi-select. The Home catch-all is never selectable (it can't be removed/group-moved).
  // When this card is part of an active group drag, it rides the shared (dx,dy) delta via a CSS
  // transform — its own dnd-kit drag is suppressed for that gesture by CanvasSelection.
  const selectable = !isDesktop;
  const selKey = itemKey("card", ws.id);
  const selected = useUi(s => selectable && s.selection.has(selKey));
  const gd = useUi(s => (selectable && s.groupDrag && s.selection.has(selKey)) ? s.groupDrag : null);
  const open = () => {
    const r = elRef.current?.getBoundingClientRect();
    onOpen(r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null);
  };
  // While its room is open the card STAYS on the canvas but goes grayed-out and inert (a visible
  // "this one's already open" marker) instead of vanishing — pointerEvents:none disables the whole
  // card so it can't be opened, dragged, renamed, recolored, or deleted while the room is live.
  // Closing restores it to full color + interactivity as the room collapses back into it.
  const fade: CSSProperties = isOpen
    ? (entry!.closing
        ? { opacity: 1, filter: "none", transition: "opacity 200ms ease 120ms, filter 200ms ease 120ms" }
        : { opacity: 0.45, filter: "grayscale(0.9)", pointerEvents: "none", transition: "opacity 160ms ease, filter 160ms ease" })
    : { opacity: 1 };
  return (
    <div ref={setRefs} data-ws-card data-canvas-item={selectable ? "" : undefined} data-item-key={selectable ? selKey : undefined}
      className="cursor-move active:cursor-grabbing"
      style={{
        position: "absolute", left: x, top: y,
        // While THIS card is being dragged, lift it above everything (folders paint after cards, so a
        // card dragged onto a folder would otherwise slide UNDER it) — you should see the card riding
        // on top of the group you're dropping it into.
        ...(transform || gd ? { zIndex: 50 } : null),
        // The selection's group-drag delta is SCREEN px; this card lives in the zoom-scaled world, so
        // divide by zoom — it renders back ×zoom to the same on-screen distance the cursor moved.
        ...(gd ? { transform: `translate3d(${gd.dx / zoom}px, ${gd.dy / zoom}px, 0)` } : null),
        ...(selected ? { outline: "2px solid rgb(var(--tr-info) / 0.4)", outlineOffset: "2px", borderRadius: "0.625rem" } : null),
        ...(overActive ? { outline: "2px solid rgb(var(--tr-info))", outlineOffset: "2px", borderRadius: "0.625rem" } : null),
        ...fade,
      }}
      {...attributes} {...listeners}>
      <WorkspaceCard ws={ws} spaces={spaces} isDesktop={isDesktop} onOpen={open} onDelete={onDelete} onColor={onColor} onMove={onMove} onRename={onRename} attentionIds={attentionIds} workingIds={workingIds} />
    </div>
  );
}

// A folder on the canvas: positioned + draggable like a card, and a drop target (a card dropped onto
// it joins). A stationary click (no drag) opens it — handing up the tile's viewport rect so the
// overlay can grow out of the folder. Mirrors DraggableCard's local-pos / fold-on-drop dance so it
// never flashes back to its pre-drag spot.
function DraggableFolder({ folder, members, snap, overActive, onOpen, onContextMenu }: {
  folder: Folder; members: Workspace[]; snap: boolean; overActive: boolean;
  onOpen: (origin: RoomOrigin) => void;
  onContextMenu: (clientX: number, clientY: number, origin: RoomOrigin) => void;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: folder.id });
  const { setNodeRef: setDropRef } = useDroppable({ id: folder.id });
  const setRefs = useCallback((el: HTMLDivElement | null) => { setNodeRef(el); setDropRef(el); }, [setNodeRef, setDropRef]);
  const [pos, setPos] = useState({ x: folder.x, y: folder.y });
  useLayoutEffect(() => { setPos({ x: folder.x, y: folder.y }); }, [folder.x, folder.y]);
  // Tracks whether this gesture was a real drag (vs a click) so the click only opens when stationary.
  const dragged = useRef(false);
  const prevTransform = useRef(transform);
  useLayoutEffect(() => {
    if (transform) dragged.current = true;
    const prev = prevTransform.current;
    if (prev && !transform) setPos((p) => {
      const x = p.x + prev.x, y = p.y + prev.y;
      return snap ? snapToGrid(x, y) : { x, y };
    });
    prevTransform.current = transform;
  }, [transform, snap]);
  const x = pos.x + (transform?.x ?? 0), y = pos.y + (transform?.y ?? 0);
  return (
    // `data-no-marquee` is load-bearing: CanvasSelection's capture-phase document pointerdown starts a
    // marquee on any press that isn't a `data-canvas-item` (which folders aren't), which would eat the
    // folder's drag (you'd draw a selection box instead of moving it). The opt-out makes that handler
    // bail so dnd-kit gets the press. Reset the click-vs-drag flag in the CAPTURE phase so it runs
    // before — and without shadowing — dnd-kit's own onPointerDown (spread via {...listeners}, which
    // arms the drag sensor). A stationary click opens the folder; a drag past dnd's 8px threshold moves it.
    <div ref={setRefs} data-no-marquee className="cursor-move active:cursor-grabbing"
      style={{ position: "absolute", left: x, top: y, ...(transform ? { zIndex: 50 } : null) }}
      onPointerDownCapture={() => { dragged.current = false; }}
      {...attributes} {...listeners}
      onClick={(e) => {
        if (dragged.current) return;
        const r = e.currentTarget.getBoundingClientRect();
        onOpen({ x: r.left, y: r.top, w: r.width, h: r.height });
      }}
      // Right-click → the group menu. stopPropagation keeps the canvas's own context menu from also
      // firing (it bubbles to the viewport's onContextMenu otherwise). Pass the tile rect so Open/Rename
      // can grow the overlay out of it.
      onContextMenu={(e) => {
        e.preventDefault(); e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        onContextMenu(e.clientX, e.clientY, { x: r.left, y: r.top, w: r.width, h: r.height });
      }}>
      <FolderTile folder={folder} members={members} overActive={overActive} />
    </div>
  );
}

export function SpaceCanvas({ spaceId, workspaces, spaces, desktopWorkspaceId, globalBg }: {
  spaceId: string; workspaces: Workspace[]; spaces: Space[]; desktopWorkspaceId: string | null; globalBg: CanvasBackground;
}) {
  const qc = useQueryClient();
  const move = useMutation({
    mutationFn: ({ id, x, y }: { id: string; x: number; y: number }) => api.updateWorkspace(id, { x, y }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
  // Folder drag → persist position the SAME non-optimistic way a card move does (no synchronous cache
  // patch, invalidate on success). Using the optimistic saveFolder here double-applied the drag delta:
  // the cache patch fired DraggableFolder's "reset pos from folder.x/y" effect in the same frame as its
  // "fold the drag offset into pos" effect, so the folder landed at start + 2×delta. This mirrors `move`.
  const moveFolder = useMutation({
    mutationFn: ({ id, x, y }: { id: string; x: number; y: number }) => api.folders.update(id, { x, y }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["folders"] }),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.deleteWorkspace(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
  const cardColor = useMutation({
    mutationFn: ({ id, color }: { id: string; color: string | null }) => api.updateWorkspace(id, { cardColor: color }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
  const moveSpace = useMutation({
    mutationFn: ({ id, toSpaceId }: { id: string; toSpaceId: string }) => api.updateWorkspace(id, { spaceId: toSpaceId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.updateWorkspace(id, { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
  const openRoom = useUi(s => s.openRoom);
  const setCameraForSpace = useUi(s => s.setCameraForSpace);
  // The single per-space view transform. Cards + floating rooms all render through this one camera, so
  // there is nothing to keep in sync (the old scroll + cardPan + roomPan trio is gone).
  const cam = useUi(s => s.cameraBySpace[spaceId]) ?? DEFAULT_CAMERA;
  const zoom = cam.zoom;
  const clearPreviewColor = useUi(s => s.clearPreviewColor);
  // Commit a picked card color: optimistically patch the cache so the card + its room hold the new
  // color with no flicker, drop the ephemeral preview, then persist. The mutation's invalidate
  // refetch reconciles afterward.
  const commitCardColor = (id: string, color: string | null) => {
    qc.setQueryData<{ workspaces: Workspace[] }>(["workspaces"], (old) =>
      old ? { ...old, workspaces: old.workspaces.map(w => w.id === id ? { ...w, cardColor: color } : w) } : old);
    clearPreviewColor(id);
    cardColor.mutate({ id, color });
  };
  // Commit an inline card rename: optimistically patch the cache so the title swaps with no flicker,
  // then persist. Empty/whitespace-only names are ignored (the old name stays).
  const commitRename = (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    qc.setQueryData<{ workspaces: Workspace[] }>(["workspaces"], (old) =>
      old ? { ...old, workspaces: old.workspaces.map(w => w.id === id ? { ...w, name: trimmed } : w) } : old);
    rename.mutate({ id, name: trimmed });
  };
  const attentionIds = new Set(useAttention().map(a => a.terminalId));
  const workingIds = new Set(useWorking().map(w => w.terminalId));
  const snap = useUi(s => s.snapToGrid);
  const arrangeSeq = useUi(s => s.arrangeSeq);
  // SpacePager mounts every space's canvas at once; only the visible one owns the global pan/zoom
  // listeners + the zoom pill.
  const isActive = useUi(s => s.activeSpaceId === spaceId);
  // The viewport (overflow-hidden — no native scroll, no scrollbar). The camera transform on the world
  // layer below is the only thing that moves the board.
  const hostRef = useRef<HTMLDivElement | null>(null);

  // Canvas folders (iPhone-style card groups) for THIS space + their members. A folder owns a name +
  // canvas position; its member cards carry folderId and render INSIDE the folder, not on the canvas.
  const { folders, create: createFolder, save: saveFolder, addMember, removeMember, remove: removeFolder } = useFolders();
  const spaceFolders = folders.filter(f => f.spaceId === spaceId);
  const membersOf = (folderId: string) => workspaces.filter(w => w.folderId === folderId);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  // The folder tile's viewport rect at open time — the overlay grows out of it (top-right pinned).
  const [openOrigin, setOpenOrigin] = useState<RoomOrigin | null>(null);
  // True while a card is being dragged onto another card/folder — that target lights up to say "drop
  // here to group". `ws_`-prefixed actives only (dragging a folder just moves it, never groups).
  const grouping = activeId !== null && activeId.startsWith("ws_") && overId !== null && overId !== activeId;
  const openFolder = spaceFolders.find(f => f.id === openFolderId);

  // Pop a card out of a folder. Dropping below two members dissolves the folder (a one-card folder is
  // pointless), so its remaining cards return to the canvas; otherwise just this card leaves, landing
  // a touch off the folder so it's not hidden under it.
  const popOut = (folder: Folder, wsId: string) => {
    if (membersOf(folder.id).length <= 2) { removeFolder(folder.id); setOpenFolderId(null); }
    else removeMember(wsId, folder.x + 16, folder.y + 16);
  };
  // Tidy this space's board once when "Snap to grid" flips on (guard on the false→true edge so
  // refetches don't re-run it).
  const prevSnap = useRef(snap);
  useEffect(() => {
    if (snap && !prevSnap.current) {
      for (const ws of workspaces) {
        const p = snapToGrid(ws.x, ws.y);
        if (p.x !== ws.x || p.y !== ws.y) move.mutate({ id: ws.id, x: p.x, y: p.y });
      }
    }
    prevSnap.current = snap;
  }, [snap, workspaces]); // eslint-disable-line react-hooks/exhaustive-deps
  // Mouse: require an 8px drag before a card starts moving, so clicks on the card's buttons aren't
  // swallowed (load-bearing — see CLAUDE.md). Touch: a separate sensor with a press-and-hold delay so a
  // quick one-finger swipe scrolls/pans the canvas natively while a hold (220ms, <8px wander) picks the
  // card up. Without the split, the old single PointerSensor let mobile Safari's native scroll win the
  // gesture and cards barely dragged with a finger. `tolerance` cancels the pending hold if the finger
  // travels first (→ it was a pan), so the two never fight.
  const sensors = useSensors(
    useSensor(LeftMouseSensor as typeof MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  // Zoom makes dnd-kit's pointer-derived translate (screen px) overshoot: the dragged card lives inside
  // the scaled world, so it'd move ×zoom too far. Dividing the translate by zoom makes it track the cursor
  // 1:1, and dnd-kit reports the SAME modified value as event.delta (verified in @dnd-kit/core 6.3.1), so
  // the persisted drop position is already in canvas units — no other drag math changes. Identity at zoom 1.
  const zoomModifier = useCallback<Modifier>(
    ({ transform }) => (zoom === 1 ? transform : { ...transform, x: transform.x / zoom, y: transform.y / zoom }),
    [zoom],
  );

  // Broadcast my cursor over the presence socket so others see a live ghost cursor. Bind pointermove on
  // `window` in the CAPTURE phase — NOT bubbling on the canvas element. A workspace card (a dnd-kit
  // draggable) sits over the canvas, and over a card the bubbling pointermove can be swallowed before it
  // reaches the canvas (so the ghost froze the moment the host moved onto a card). A capture-phase window
  // listener fires for EVERY pointer move first, before any element/capture/stopPropagation can eat it —
  // including while a card drag holds pointer capture — so the cursor tracks everywhere on the canvas.
  // We still scope it to the canvas viewport (bounds check below) so moving over the TopBar sends nothing.
  // Coords are WORLD space (screenToWorld through my camera) — the frame cards live in — so each peer maps
  // them onto the same spot through its own camera. Throttled to ~25fps; a no-op until the socket hands us
  // a sender (harmless when nobody else is on).
  const lastCursor = useRef(0);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onMove = (e: PointerEvent) => {
      // SpacePager mounts every space's canvas at once; a window-level listener fires on all of them.
      // Only the visible (active) space broadcasts — so we don't send duplicate frames for off-screen spaces.
      if (useUi.getState().activeSpaceId !== spaceId) return;
      const send = usePresence.getState().sendCursor; // read live so a reconnect's new sender is picked up
      if (!send) return;
      const now = Date.now();
      if (now - lastCursor.current < 40) return; // throttle ALL processing (incl. the layout read) to ~25fps
      lastCursor.current = now;
      const r = host.getBoundingClientRect();
      // Only while the pointer is over the canvas viewport (skip the TopBar / spaces bar / off-window).
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
      const c = useUi.getState().cameraBySpace[spaceId] ?? DEFAULT_CAMERA;
      const w = screenToWorld(e.clientX - r.left, e.clientY - r.top, c);
      send({ space: spaceId, x: w.x, y: w.y });
    };
    window.addEventListener("pointermove", onMove, true);
    return () => window.removeEventListener("pointermove", onMove, true);
  }, [spaceId]);

  // ── Canvas zoom (pinch on iPad, ⌘/Ctrl-wheel on desktop, the zoom pill) ───────────────────────────
  // Camera-based: zoom toward the cursor by recomputing the camera so the world point under the pointer
  // stays pinned to the same screen pixel. No scroll, no post-layout re-aim — one pure transform.
  const zoomAtClient = useCallback((clientX: number, clientY: number, nextZoom: number) => {
    const host = hostRef.current;
    if (!host) return;
    const r = host.getBoundingClientRect();
    const base = useUi.getState().cameraBySpace[spaceId] ?? DEFAULT_CAMERA;
    const next = camZoomAround(base, clientX - r.left, clientY - r.top, nextZoom);
    if (next !== base) useUi.getState().setCameraForSpace(spaceId, next);
  }, [spaceId]);
  // Zoom around the canvas viewport center — for the +/− and reset buttons.
  const zoomCentered = useCallback((nz: number) => {
    const host = hostRef.current;
    if (!host) return;
    const r = host.getBoundingClientRect();
    zoomAtClient(r.left + r.width / 2, r.top + r.height / 2, nz);
  }, [zoomAtClient]);
  useEffect(() => {
    if (!isActive) return;
    const host = hostRef.current;
    if (!host) return;
    // Bound on `window` (CAPTURE), NOT on the canvas host — so ⌘/Ctrl-wheel zoom (and an iPad pinch) reach
    // the camera even when the pointer is over an open IDE room or a floating panel. Those render in layers
    // ABOVE the viewport, so the old host-bound listener never saw a wheel over them (zoom only worked over
    // bare canvas). Mirrors the middle-mouse pan handler below. Non-passive so we can preventDefault.
    const onWheel = (e: WheelEvent) => {
      if (useUi.getState().activeSpaceId !== spaceId) return;
      const base = useUi.getState().cameraBySpace[spaceId] ?? DEFAULT_CAMERA;
      if (e.ctrlKey || e.metaKey) {
        // ⌘/Ctrl-wheel (or a trackpad pinch, which emits a ctrlKey wheel) zooms toward the pointer —
        // works over ANYTHING, an open room included. preventDefault kills the browser's page zoom.
        e.preventDefault();
        zoomAtClient(e.clientX, e.clientY, base.zoom * Math.exp(-e.deltaY * 0.0018));
      } else if (host.contains(e.target as Node)) {
        // Plain wheel / two-finger scroll PANS the camera (Figma-style) — but only when the pointer is over
        // the bare canvas (a card counts). Over a room/panel a plain wheel scrolls THAT content natively
        // (no preventDefault), exactly as before — host.contains() reproduces the old host-bound scope.
        e.preventDefault();
        useUi.getState().setCameraForSpace(spaceId, panBy(base, -e.deltaX, -e.deltaY));
      }
    };
    // Safari/iPad pinch: proprietary gesture events carry a cumulative `scale` since gesturestart plus the
    // pinch midpoint. (Android Chrome doesn't fire these — it falls back to the zoom pill / ⌘-wheel.) Also
    // window-bound so a pinch over an open room still zooms the board.
    let pinchStart = 1;
    const gStart = (e: Event) => { if (useUi.getState().activeSpaceId !== spaceId) return; e.preventDefault(); pinchStart = (useUi.getState().cameraBySpace[spaceId] ?? DEFAULT_CAMERA).zoom; };
    const gChange = (e: Event) => { const g = e as GestureLikeEvent; if (useUi.getState().activeSpaceId !== spaceId) return; e.preventDefault(); zoomAtClient(g.clientX, g.clientY, pinchStart * g.scale); };
    const gEnd = (e: Event) => e.preventDefault();
    window.addEventListener("wheel", onWheel, { passive: false, capture: true });
    window.addEventListener("gesturestart", gStart, true);
    window.addEventListener("gesturechange", gChange, true);
    window.addEventListener("gestureend", gEnd, true);
    return () => {
      window.removeEventListener("wheel", onWheel, true);
      window.removeEventListener("gesturestart", gStart, true);
      window.removeEventListener("gesturechange", gChange, true);
      window.removeEventListener("gestureend", gEnd, true);
    };
  }, [isActive, spaceId, zoomAtClient]);

  // The permanent Desktop catch-all is the rehome target for deleted workspaces, so it can't be
  // removed — but an empty one is just clutter. Hide it on the canvas until it actually holds
  // rehomed terminals; it pops back the moment something lands in it. The safety net is unchanged.
  const cards = workspaces.filter(w => !w.folderId && (w.id !== desktopWorkspaceId || (w.terminals?.length ?? 0) > 0));

  // Reset / Fit-to-view: frame all of this space's cards + folders in the viewport (centered, padded).
  // The replacement for the old "can't lose the board" clamp — pan is unbounded, this is the way back.
  // Empty board → reset to the default camera (origin at the viewport top-left, 100%).
  const fitView = () => {
    const host = hostRef.current;
    if (!host) return;
    const items = [...cards, ...spaceFolders];
    if (items.length === 0) { setCameraForSpace(spaceId, { ...DEFAULT_CAMERA }); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const it of items) {
      if (it.x < minX) minX = it.x;
      if (it.y < minY) minY = it.y;
      if (it.x + CARD_W > maxX) maxX = it.x + CARD_W;
      if (it.y + CARD_H > maxY) maxY = it.y + CARD_H;
    }
    setCameraForSpace(spaceId, fitToBounds({ minX, minY, maxX, maxY }, { w: host.clientWidth, h: host.clientHeight }));
  };

  // Shared canvas: stream the dragged card's live position to the other participants so it moves on
  // their screens too (both ways). Throttled to ~25fps and un-snapped to match what the dragger sees
  // mid-drag; the snapped final lands on drop. A no-op until the presence socket hands us a sender.
  const lastCardBroadcast = useRef(0);
  const onDragMove = (e: DragMoveEvent) => {
    const send = usePresence.getState().sendCards;
    if (!send) return;
    const now = Date.now();
    if (now - lastCardBroadcast.current < 40) return;
    lastCardBroadcast.current = now;
    const ws = workspaces.find(w => w.id === e.active.id);
    if (!ws) return;
    send([{ id: ws.id, x: ws.x + e.delta.x, y: ws.y + e.delta.y }]);
  };

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragOver = (e: DragOverEvent) => setOverId(e.over ? String(e.over.id) : null);

  const onDragEnd = (e: DragEndEvent) => {
    const aId = String(e.active.id);
    const oId = e.over ? String(e.over.id) : null;
    setActiveId(null); setOverId(null);

    // A folder was dragged → persist its new canvas position (it never groups onto anything).
    if (aId.startsWith("fld_")) {
      const f = spaceFolders.find(f => f.id === aId);
      if (!f) return;
      let x = f.x + e.delta.x, y = f.y + e.delta.y;
      if (snap) ({ x, y } = snapToGrid(x, y));
      moveFolder.mutate({ id: f.id, x, y });
      return;
    }

    const ws = workspaces.find(w => w.id === aId);
    if (!ws) return;

    // Dropped onto a different card → make a new folder (at the target's spot) holding both; onto a
    // folder → join it. The Desktop catch-all is never a grouping source or target.
    if (oId && oId !== aId && ws.id !== desktopWorkspaceId) {
      if (oId.startsWith("fld_")) { addMember(ws.id, oId); return; }
      const target = workspaces.find(w => w.id === oId);
      if (target && target.id !== desktopWorkspaceId) {
        createFolder({ spaceId, x: target.x, y: target.y, memberIds: [target.id, ws.id] });
        return;
      }
    }

    // Plain move — raw world coords, no clamp.
    let x = ws.x + e.delta.x, y = ws.y + e.delta.y;
    if (snap) ({ x, y } = snapToGrid(x, y));
    move.mutate({ id: ws.id, x, y });
    usePresence.getState().sendCards?.([{ id: ws.id, x, y }]); // final spot to peers (durability is the mutation's job)
  };

  // Right-click the bare canvas (not a card) → a small menu: drop a new workspace/sticky note right
  // where you clicked, tidy the cards to the grid, or open the per-space backdrop editor (the Mac
  // "change wallpaper" gesture). The background window grows from the click.
  const space = spaces.find(s => s.id === spaceId);
  const requestNewWorkspace = useUi(s => s.requestNewWorkspace);
  const { notes, create: addNote, save: saveNote } = useStickyNotes();
  const { widgets, save: saveWidget } = useSpaceWidgets();
  // This space's sticky notes + widgets (both hooks return every space's rows). Normalize null↦"" so
  // the default space's null-spaceId rows match, mirroring the layers' `spaceId ?? ""` convention.
  const spaceNotes = notes.filter(n => (n.spaceId ?? "") === (spaceId ?? ""));
  const spaceWidgets = widgets.filter(w => (w.spaceId ?? "") === (spaceId ?? ""));
  // `x/y` are viewport coords (menu placement, the bg window + sticky note); `cardX/cardY` are WORLD
  // coords (camera-mapped, grid-snapped when snapping is on) for the new workspace card.
  const [menu, setMenu] = useState<{ x: number; y: number; cardX: number; cardY: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Right-click menu for a folder/group tile (Open / Rename / Dissolve). `origin` is the tile's rect so
  // Open/Rename can grow the overlay out of it. Separate from the canvas `menu` above.
  const [folderMenu, setFolderMenu] = useState<{ id: string; x: number; y: number; origin: RoomOrigin } | null>(null);
  const folderMenuRef = useRef<HTMLDivElement>(null);
  // When true, the folder overlay opens with its name field focused + selected (the menu's "Rename").
  const [renameFolderOnOpen, setRenameFolderOnOpen] = useState(false);
  const [bgWin, setBgWin] = useState<WinRect | null>(null);
  // Dissolve a group from its right-click menu: pop every member back onto the canvas at a free grid
  // cell (so they line up on the grid instead of landing in a pile), then drop the now-empty folder.
  const dissolveGroup = (folder: Folder) => {
    const members = membersOf(folder.id);
    const boardHeight = hostRef.current?.clientHeight ?? window.innerHeight;
    const occupied = [
      ...cards.map((c) => ({ x: c.x, y: c.y })),
      ...spaceFolders.filter((f) => f.id !== folder.id).map((f) => ({ x: f.x, y: f.y })),
    ];
    for (const m of members) {
      const cell = nextFreeCell(occupied, boardHeight);
      removeMember(m.id, cell.x, cell.y); // folderId → null + lands on the grid cell
      occupied.push(cell);                // reserve it so the next member picks a different cell
    }
    removeFolder(folder.id);
  };
  // Delete a group AND every workspace inside it — folder and cards are gone for good, nothing returns
  // to the canvas (unlike Dissolve). Deleting a card reassigns any running terminals to the Home desktop
  // first (so agents aren't killed); a card with no terminals just vanishes. Destructive → confirm.
  const deleteGroup = (folder: Folder) => {
    const members = membersOf(folder.id);
    const n = members.length;
    if (!confirm(`Delete the “${folder.name || "Untitled"}” group and its ${n} workspace${n === 1 ? "" : "s"}? The cards are removed for good; any running terminals keep running on your Home desktop.`)) return;
    members.forEach((m) => del.mutate(m.id));
    removeFolder(folder.id);
  };
  const onContextMenu = (e: ReactMouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-ws-card]")) return; // cards keep the native menu
    e.preventDefault();
    const host = e.currentTarget as HTMLDivElement; // the viewport (data-space div)
    const r = host.getBoundingClientRect();
    const c = useUi.getState().cameraBySpace[spaceId] ?? DEFAULT_CAMERA;
    let { x: cardX, y: cardY } = screenToWorld(e.clientX - r.left, e.clientY - r.top, c);
    if (snap) ({ x: cardX, y: cardY } = snapToGrid(cardX, cardY));
    setMenu({ x: e.clientX, y: e.clientY, cardX, cardY });
  };

  // Middle-mouse grab-pan — the Figma/Miro hand tool, available ANYWHERE on screen and at ANY zoom. Bound
  // on `window` in the CAPTURE phase (only for the active space) so it fires no matter what's under the
  // cursor — a card, an open IDE room (terminal grid included), a panel, the empty canvas — because
  // rooms/panels render in layers ABOVE the viewport and would never reach a handler bound on it.
  // preventDefault kills the browser's native middle-click autoscroll. Panning just moves the camera by the
  // pointer delta (unbounded — same at every zoom). A stationary middle-click never pans (3px threshold). A
  // press that starts in a text field is left to its native middle-click paste; the terminal grid is NOT
  // excluded — xterm has no middle-click action here (it pastes via ⌘V / the `paste` event), so middle-drag
  // pans over the terminal too (and the grab cursor now shows there).
  useEffect(() => {
    if (!isActive) return;
    const onDown = (e: MouseEvent) => {
      if (e.button !== 1) return; // middle button only
      if ((e.target as HTMLElement).closest('input, textarea, [contenteditable=""], [contenteditable="true"]')) return;
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY;
      const base = useUi.getState().cameraBySpace[spaceId] ?? DEFAULT_CAMERA;
      let engaged = false;
      let release: (() => void) | null = null;
      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!engaged) {
          if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return; // below threshold = a click, not a pan
          engaged = true;
          // Global !important grab cursor so the hand shows over EVERYTHING mid-pan — an open IDE
          // window, a card, a panel — not only the bare canvas (element cursors would otherwise win).
          release = lockCursor("grabbing");
        }
        ev.preventDefault();
        useUi.getState().setCameraForSpace(spaceId, panBy(base, dx, dy));
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove, true);
        window.removeEventListener("mouseup", onUp, true);
        release?.();
      };
      window.addEventListener("mousemove", onMove, true);
      window.addEventListener("mouseup", onUp, true);
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [isActive, spaceId]);

  // Drop a sticky note at the WORLD point under the cursor — notes are board citizens now (they pan/zoom
  // with the board), so map the viewport click through this space's camera. No clamp (free placement).
  const addNoteHere = (m: { x: number; y: number }) => {
    const cam = useUi.getState().cameraBySpace[spaceId] ?? DEFAULT_CAMERA;
    const { x, y } = screenToWorld(m.x, m.y, cam);
    addNote({ spaceId: spaceId || undefined, color: null, x, y, w: NOTE_W, h: NOTE_H });
  };
  // One-shot "Tidy up": split the board into two sides that both stay inside the visible view. Folder
  // tiles + workspace cards pack on the LEFT (columns grow rightward from the left margin); widgets +
  // sticky notes pack on the RIGHT (columns grow leftward from the right edge, each item right-aligned),
  // so the accessories sit opposite the cards. Both use a column-major shelf pack: fill a column
  // top→bottom until the next item would fall past the viewport bottom, then start a fresh column. Each
  // item keeps its real footprint (cards/folders CARD_W×GRID_CARD_H — the tight "Arrange" spacing;
  // widgets/notes their own w/h) so nothing overlaps and nothing runs off the bottom edge.
  const tidy = () => {
    const host = hostRef.current;
    const viewH = host?.clientHeight ?? window.innerHeight;
    const viewW = host?.clientWidth ?? window.innerWidth;
    const cardUpdates: { id: string; x: number; y: number }[] = [];
    type Packable = { x: number; y: number; w: number; h: number; place: (x: number, y: number) => void };
    const cardsAndFolders: Packable[] = [
      ...byCell(spaceFolders).map((f) => ({ x: f.x, y: f.y, w: CARD_W, h: GRID_CARD_H, place: (x: number, y: number) => moveFolder.mutate({ id: f.id, x, y }) })),
      ...byCell(cards).map((c) => ({ x: c.x, y: c.y, w: CARD_W, h: GRID_CARD_H, place: (x: number, y: number) => { move.mutate({ id: c.id, x, y }); cardUpdates.push({ id: c.id, x, y }); } })),
    ];
    const accessories: Packable[] = [
      ...byCell(spaceWidgets).map((wg) => ({ x: wg.x, y: wg.y, w: wg.w, h: wg.h, place: (x: number, y: number) => { void saveWidget(wg.id, { x, y }); } })),
      ...byCell(spaceNotes).map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h, place: (x: number, y: number) => { void saveNote(n.id, { x, y }); } })),
    ];
    // LEFT side: columns grow rightward from the left margin.
    let lx = MARGIN, ly = MARGIN, lColW = 0;
    for (const it of cardsAndFolders) {
      if (ly > MARGIN && ly + it.h > viewH - MARGIN) { lx += lColW + GAP; ly = MARGIN; lColW = 0; }
      if (it.x !== lx || it.y !== ly) it.place(lx, ly);
      ly += it.h + GAP;
      lColW = Math.max(lColW, it.w);
    }
    // RIGHT side: columns grow leftward from the right edge; each item's right edge pins to the column.
    let rRight = viewW - MARGIN, ry = MARGIN, rColW = 0;
    for (const it of accessories) {
      if (ry > MARGIN && ry + it.h > viewH - MARGIN) { rRight -= rColW + GAP; ry = MARGIN; rColW = 0; }
      const rx = Math.max(MARGIN, rRight - it.w);
      if (it.x !== rx || it.y !== ry) it.place(rx, ry);
      ry += it.h + GAP;
      rColW = Math.max(rColW, it.w);
    }
    if (cardUpdates.length) usePresence.getState().sendCards?.(cardUpdates); // live-update shared-canvas peers
  };
  // Re-flow this space into a compact, desktop-style grid — filling top→bottom then across, with as
  // many rows as fit the VISIBLE canvas height. Folder tiles (groups) always lead in the top-left,
  // then the loose cards, each in its current visual order. Closes gaps AND drags anything parked off
  // the right/bottom edge back into view. Unlike `tidy` (snap each card where it sits), this repacks
  // from the origin. Fired by the TopBar "Arrange" button via the store signal below.
  const arrange = () => {
    const height = hostRef.current?.clientHeight ?? window.innerHeight;
    const orderedFolders = byCell(spaceFolders), orderedCards = byCell(cards);
    const cells = gridCells(orderedFolders.length + orderedCards.length, height);
    orderedFolders.forEach((f, i) => {
      const { x, y } = cells[i];
      if (x !== f.x || y !== f.y) moveFolder.mutate({ id: f.id, x, y });
    });
    const updates: { id: string; x: number; y: number }[] = [];
    orderedCards.forEach((c, i) => {
      const { x, y } = cells[orderedFolders.length + i];
      if (x !== c.x || y !== c.y) { move.mutate({ id: c.id, x, y }); updates.push({ id: c.id, x, y }); }
    });
    if (updates.length) usePresence.getState().sendCards?.(updates); // live-update any shared-canvas peers
  };
  // Store-signalled arrange: the TopBar button bumps `arrangeSeq`. SpacePager mounts EVERY space's
  // canvas at once, so guard to the active space (only the board you're looking at re-flows). Skip the
  // mount run (seq unchanged) so merely opening the app never repositions anything.
  const prevArrange = useRef(arrangeSeq);
  useEffect(() => {
    if (arrangeSeq === prevArrange.current) return;
    prevArrange.current = arrangeSeq;
    if (useUi.getState().activeSpaceId === spaceId) arrange();
  }, [arrangeSeq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!menu) return;
    // pointerdown (capture, on window), NOT mousedown — CanvasSelection's capture-phase pointerdown
    // calls preventDefault() to start a marquee on blank canvas, which suppresses the compatibility
    // mousedown, so a mousedown dismiss never fired and this menu lingered. Containment check (vs
    // stopPropagation) so a click inside the menu doesn't self-close. Mirrors WorkspaceContextMenu.
    const onDown = (e: PointerEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    const raf = requestAnimationFrame(() => window.addEventListener("pointerdown", onDown, true));
    window.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("pointerdown", onDown, true); window.removeEventListener("keydown", onKey); };
  }, [menu]);
  // Same outside-click / Escape dismissal for the folder/group menu.
  useEffect(() => {
    if (!folderMenu) return;
    const onDown = (e: PointerEvent) => { if (folderMenuRef.current && !folderMenuRef.current.contains(e.target as Node)) setFolderMenu(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFolderMenu(null); };
    const raf = requestAnimationFrame(() => window.addEventListener("pointerdown", onDown, true));
    window.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("pointerdown", onDown, true); window.removeEventListener("keydown", onKey); };
  }, [folderMenu]);

  return (
    // autoScroll off: there is no scroll container any more (the viewport is overflow-hidden), so dnd-kit's
    // edge auto-scroll has nothing to drive — panning is manual (middle-drag / trackpad / wheel).
    <DndContext sensors={sensors} modifiers={[zoomModifier]} autoScroll={false} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragMove={onDragMove} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => { setActiveId(null); setOverId(null); }}>
      {/* Positioning wrapper: the viewport clips to the canvas area; the CursorLayer is a sibling overlay
          pinned to it (so off-screen ghosts clip instead of growing the canvas). */}
      <div className="relative w-full h-full">
        <div ref={hostRef} data-space={spaceId} onContextMenu={onContextMenu} className="relative w-full h-full overflow-hidden bg-transparent tr-canvas-scroll">
          {/* The one world layer. Every card/folder renders at its raw world coords; this single transform
              (translate + scale, origin top-left) pans and zooms them all as one. transformOrigin "0 0" is
              required for the camera math (canvas/camera.ts) to hold. */}
          <div style={{ position: "absolute", top: 0, left: 0, transformOrigin: "0 0", transform: cameraTransform(cam), willChange: "transform" }}>
          {cards.map(ws => (
            <DraggableCard key={ws.id} ws={ws} snap={snap} zoom={zoom} spaces={spaces} isDesktop={ws.id === desktopWorkspaceId}
              overActive={grouping && overId === ws.id}
              attentionIds={attentionIds} workingIds={workingIds} onColor={commitCardColor} onRename={commitRename}
              onOpen={(origin) => openRoom(ws.id, origin)}
              onMove={(toSpaceId) => moveSpace.mutate({ id: ws.id, toSpaceId })}
              onDelete={() => confirm(`Remove ${ws.name}? Its terminals keep running and move to your Home desktop.`) && del.mutate(ws.id)} />
          ))}
          {spaceFolders.map(f => (
            <DraggableFolder key={f.id} folder={f} members={membersOf(f.id)} snap={snap}
              overActive={grouping && overId === f.id}
              onOpen={(origin) => { setOpenFolderId(f.id); setOpenOrigin(origin); }}
              onContextMenu={(x, y, origin) => { setMenu(null); setFolderMenu({ id: f.id, x, y, origin }); }} />
          ))}
          </div>
          {cards.length === 0 && spaceFolders.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-dim">
              No workspaces in this space yet — click “+ New workspace”.
            </div>
          )}
        </div>
        <CursorLayer spaceId={spaceId} hostRef={hostRef} />
        {isActive && <ZoomControl zoom={zoom} onZoom={zoomCentered} onFit={fitView} />}
      </div>

      {menu && createPortal(
        <div ref={menuRef} style={{ position: "fixed", left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 160), zIndex: 70 }}
          onPointerDown={(e) => e.stopPropagation()}
          className="w-52 rounded-lg border border-edge bg-panel py-1 text-sm text-fg shadow-2xl select-none">
          <Item label="New workspace" onClick={() => { requestNewWorkspace({ spaceId, x: menu.cardX, y: menu.cardY }); setMenu(null); }} />
          <Item label="New sticky note" onClick={() => { addNoteHere(menu); setMenu(null); }} />
          <Item label="Tidy up" hint="fit in view" disabled={cards.length === 0 && spaceFolders.length === 0 && spaceWidgets.length === 0 && spaceNotes.length === 0} onClick={() => { tidy(); setMenu(null); }} />
          <Sep />
          <Item label="Change Background…" onClick={() => { setBgWin({ x: menu.x - 12, y: menu.y - 12, w: 24, h: 24 }); setMenu(null); }} />
        </div>,
        document.body,
      )}

      {folderMenu && createPortal(
        <div ref={folderMenuRef} style={{ position: "fixed", left: Math.min(folderMenu.x, window.innerWidth - 272), top: Math.min(folderMenu.y, window.innerHeight - 200), zIndex: 70 }}
          onPointerDown={(e) => e.stopPropagation()}
          className="w-64 rounded-lg border border-edge bg-panel py-1 text-sm text-fg shadow-2xl select-none">
          <Item label="Open group" onClick={() => { setRenameFolderOnOpen(false); setOpenFolderId(folderMenu.id); setOpenOrigin(folderMenu.origin); setFolderMenu(null); }} />
          <Item label="Rename group…" onClick={() => { setRenameFolderOnOpen(true); setOpenFolderId(folderMenu.id); setOpenOrigin(folderMenu.origin); setFolderMenu(null); }} />
          <Sep />
          <Item label="Dissolve group" hint="cards → grid" onClick={() => { const f = spaceFolders.find((f) => f.id === folderMenu.id); if (f) dissolveGroup(f); setFolderMenu(null); }} />
          <Item label="Delete group & workspaces" danger onClick={() => { const f = spaceFolders.find((f) => f.id === folderMenu.id); setFolderMenu(null); if (f) deleteGroup(f); }} />
        </div>,
        document.body,
      )}

      {bgWin && space && createPortal(
        <SpaceBackgroundWindow
          spaceId={spaceId} spaceName={space.name}
          initial={space.background ?? globalBg ?? DEFAULT_CANVAS_BACKGROUND}
          hasOverride={!!space.background} origin={bgWin} onClose={() => setBgWin(null)} />,
        document.body,
      )}

      {openFolder && (
        <FolderOverlay
          folder={openFolder} members={membersOf(openFolder.id)} origin={openOrigin} spaces={spaces}
          attentionIds={attentionIds} workingIds={workingIds} focusName={renameFolderOnOpen}
          onClose={() => { setOpenFolderId(null); setRenameFolderOnOpen(false); }}
          onOpenRoom={(wsId, origin) => openRoom(wsId, origin)}
          onRename={(name) => saveFolder(openFolder.id, { name })}
          onPopOut={(wsId) => popOut(openFolder, wsId)}
          onDissolve={() => removeFolder(openFolder.id)}
          onColorWorkspace={commitCardColor}
          onMoveWorkspace={(wsId, toSpaceId) => moveSpace.mutate({ id: wsId, toSpaceId })}
          onRenameWorkspace={commitRename}
          onDeleteWorkspace={(ws) => confirm(`Remove ${ws.name}? Its terminals keep running and move to your Home desktop.`) && del.mutate(ws.id)} />
      )}
    </DndContext>
  );
}

/** Floating zoom pill (bottom-right of the canvas): Fit-to-view, −, the current %, +. Clicking the %
 *  resets zoom to 100%; the frame button recenters/fits the whole board. Pinch (iPad) and ⌘/Ctrl-wheel
 *  drive the same zoom — this is the discoverable + desktop control. */
function ZoomControl({ zoom, onZoom, onFit }: { zoom: number; onZoom: (z: number) => void; onFit: () => void }) {
  const pct = Math.round(zoom * 100);
  // While the field is focused we hold the raw typed digits; null = not editing, so it mirrors `pct`.
  const [editing, setEditing] = useState<string | null>(null);
  const commit = (raw: string) => {
    const n = parseInt(raw, 10);
    if (!Number.isNaN(n)) onZoom(n / 100); // onZoom → zoomCentered → camera clamps to the valid range
    setEditing(null);
  };
  // +/- snap onto the 5% grid: the next/previous multiple of 5 from the current percent.
  const stepIn = () => onZoom(((Math.floor(pct / 5) + 1) * 5) / 100);
  const stepOut = () => onZoom(((Math.ceil(pct / 5) - 1) * 5) / 100);
  // Portaled to <body> and `fixed` to the viewport's bottom-right so it can NEVER be covered (an open room
  // is z-40; the canvas it used to live in rode the space-slide transform). zIndex one below the Copilot
  // orb (2147483647) — the orb is the only thing allowed to sit on top of it — and above everything else.
  return createPortal(
    <div className="fixed right-4 flex items-center gap-0.5 rounded-lg border border-edge bg-panel/90 p-1 text-fg shadow-lg backdrop-blur select-none"
      // Sit just above the bottom stats bar (STATS_BAR_HEIGHT) so it clears that bar instead of
      // overlapping it down in the corner.
      style={{ zIndex: 2147483646, bottom: STATS_BAR_HEIGHT + 12 }}>
      <button onClick={onFit} title="Fit board to view" aria-label="Fit board to view"
        className="grid h-7 w-7 place-items-center rounded-md text-dim hover:bg-surface hover:text-fg cursor-pointer">
        <FitIcon />
      </button>
      <span className="mx-0.5 h-4 w-px bg-edge" aria-hidden />
      <button onClick={stepOut} disabled={zoom <= CANVAS_ZOOM_MIN} title="Zoom out 5%" aria-label="Zoom out"
        className="grid h-7 w-7 place-items-center rounded-md text-dim hover:bg-surface hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed">
        <ZoomOutIcon />
      </button>
      <div className="flex min-w-[3.25rem] items-center justify-center rounded-md px-1 py-1 text-xs tabular-nums text-muted hover:bg-surface focus-within:bg-surface focus-within:text-fg">
        <input
          value={editing ?? String(pct)}
          onChange={(e) => setEditing(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
          onFocus={(e) => { setEditing(String(pct)); e.currentTarget.select(); }}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            else if (e.key === "Escape") { setEditing(null); e.currentTarget.blur(); }
          }}
          inputMode="numeric"
          title="Type a zoom % and press Enter (100 = reset)"
          aria-label="Zoom level, percent"
          className="w-7 bg-transparent text-right tabular-nums outline-none"
        />
        <span className="pointer-events-none pl-0.5">%</span>
      </div>
      <button onClick={stepIn} disabled={zoom >= CANVAS_ZOOM_MAX} title="Zoom in 5%" aria-label="Zoom in"
        className="grid h-7 w-7 place-items-center rounded-md text-dim hover:bg-surface hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed">
        <ZoomInIcon />
      </button>
    </div>,
    document.body,
  );
}

const zsv = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
function ZoomInIcon() {
  return <svg width="15" height="15" {...zsv}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-3.5-3.5M11 8.5v5M8.5 11h5" /></svg>;
}
function ZoomOutIcon() {
  return <svg width="15" height="15" {...zsv}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-3.5-3.5M8.5 11h5" /></svg>;
}
// A "frame / fit to view" glyph — corner brackets around the board.
function FitIcon() {
  return <svg width="15" height="15" {...zsv}><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" /></svg>;
}
