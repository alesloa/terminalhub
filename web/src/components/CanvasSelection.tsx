import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Workspace } from "../api/types";
import { useUi } from "../store/ui";
import { DEFAULT_CAMERA } from "../canvas/camera";
import { snapToGrid } from "../lib/grid";
import { useStickyNotes } from "./StickyNotes/useStickyNotes";
import { useSpaceWidgets } from "./Widgets/useSpaceWidgets";
import { useFolders } from "./Folders/useFolders";
import { Item, Sep } from "./TerminalContextMenu";

/**
 * Desktop-style multi-select for the canvas. Mounted once. It owns three document-level gestures via
 * capture-phase listeners so it can act BEFORE (and, when needed, instead of) each item's own dnd-kit
 * / pointer handlers:
 *
 *  - Marquee: drag on the empty canvas to rubber-band a box; every item whose viewport rect it
 *    touches gets selected (live). Shift/⌘ adds to the current selection; a bare click clears it.
 *  - Group drag: grab an already-selected item in a multi-selection and the whole selection moves by
 *    one shared delta (we stopPropagation so neither dnd-kit nor the notes/widgets pointer handlers
 *    start). Grab an unselected item, or a selection of one, and it falls straight through to the
 *    item's normal single-drag, untouched.
 *  - Bulk remove: right-click any selected item (when >1 are selected) for "Remove selected", or
 *    press Delete/Backspace. Guarded so it never fires while typing in a note/field/terminal.
 *
 * Items are matched by the `data-canvas-item` + `data-item-key="${kind}:${id}"` attrs the cards,
 * notes, and widgets render. Selection is keyed uniformly so all three are dragged/removed together.
 * Coords: cards, notes, and widgets all store world x/y (board citizens). A group drag's delta is in
 * screen px; every type divides it by the canvas zoom to map back into the scaled world (no clamp).
 * Marquee selection compares on-screen rects to the on-screen box, so it's zoom/pan-agnostic.
 * Touch falls through to native pan + the TouchSensor (see the early return in onPointerDown).
 */
export function CanvasSelection() {
  const activeSpaceId = useUi(s => s.activeSpaceId);
  const snap = useUi(s => s.snapToGrid);
  const clearSelection = useUi(s => s.clearSelection);

  const qc = useQueryClient();
  const workspaces = useQuery({ queryKey: ["workspaces"], queryFn: api.listWorkspaces }).data?.workspaces ?? [];
  const desktopWorkspaceId = useQuery({ queryKey: ["spaces"], queryFn: api.listSpaces }).data?.desktopWorkspaceId ?? null;
  const moveWs = useMutation({
    mutationFn: ({ id, x, y }: { id: string; x: number; y: number }) => api.updateWorkspace(id, { x, y }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
  const delWs = useMutation({
    mutationFn: (id: string) => api.deleteWorkspace(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
  const { notes, save: saveNote, remove: removeNote } = useStickyNotes();
  const { widgets, save: saveWidget, remove: removeWidget } = useSpaceWidgets();
  const { create: createFolder } = useFolders();

  // Bound-once listeners read live data + commit fns through refs so they never go stale.
  const data = useRef({ workspaces, notes, widgets, snap, desktopWorkspaceId });
  data.current = { workspaces, notes, widgets, snap, desktopWorkspaceId };

  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  // Commit a group move: every selected item's base position + the screen delta, snapped the same way
  // its own single-drag would, persisted through the item type's existing mutation.
  const commitGroupMove = (dx: number, dy: number) => {
    if (dx === 0 && dy === 0) return;
    const { workspaces, notes, widgets, snap } = data.current;
    // Cards, notes, and widgets all live in the active space's zoom-scaled world now (board citizens),
    // so divide the screen delta by that space's camera zoom for every type — no viewport clamp.
    const zoom = (useUi.getState().cameraBySpace[useUi.getState().activeSpaceId] ?? DEFAULT_CAMERA).zoom;
    for (const key of useUi.getState().selection) {
      const i = key.indexOf(":");
      const kind = key.slice(0, i), id = key.slice(i + 1);
      if (kind === "card") {
        const ws = workspaces.find(w => w.id === id);
        if (!ws) continue;
        let x = ws.x + dx / zoom, y = ws.y + dy / zoom; // raw world coords, no clamp
        if (snap) ({ x, y } = snapToGrid(x, y));
        // Optimistically patch the cache so the card holds its new spot the instant you drop (its
        // useLayoutEffect resyncs pos pre-paint) — no flash back to the old position before the server
        // round-trip. Mirrors how the notes/widgets save() patches optimistically.
        qc.setQueryData<{ workspaces: Workspace[] }>(["workspaces"], (old) =>
          old ? { ...old, workspaces: old.workspaces.map(w => w.id === id ? { ...w, x, y } : w) } : old);
        moveWs.mutate({ id, x, y });
      } else if (kind === "note") {
        const n = notes.find(n => n.id === id);
        if (!n) continue;
        saveNote(id, { x: n.x + dx / zoom, y: n.y + dy / zoom });
      } else if (kind === "widget") {
        const w = widgets.find(w => w.id === id);
        if (!w) continue;
        saveWidget(id, { x: w.x + dx / zoom, y: w.y + dy / zoom });
      }
    }
  };

  // Remove every selected item. Cards rehome their terminals to the hidden Home desktop (the server
  // delete is non-destructive); notes + widgets are gone. The Home catch-all is never selectable, so
  // it can't land here — but skip it defensively too. One confirm summarizes the blast radius.
  const deleteSelected = () => {
    const sel = [...useUi.getState().selection];
    if (!sel.length) return;
    const { desktopWorkspaceId } = data.current;
    const cardIds = sel.filter(k => k.startsWith("card:")).map(k => k.slice(5)).filter(id => id !== desktopWorkspaceId);
    const noteIds = sel.filter(k => k.startsWith("note:")).map(k => k.slice(5));
    const widgetIds = sel.filter(k => k.startsWith("widget:")).map(k => k.slice(7));
    if (!cardIds.length && !noteIds.length && !widgetIds.length) return;
    const parts: string[] = [];
    const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? "s" : ""}`;
    if (cardIds.length) parts.push(plural(cardIds.length, "workspace"));
    if (noteIds.length) parts.push(plural(noteIds.length, "note"));
    if (widgetIds.length) parts.push(plural(widgetIds.length, "widget"));
    let msg = `Remove ${parts.join(", ")}?`;
    if (cardIds.length) msg += " Workspace terminals keep running and move to your Home desktop.";
    if (noteIds.length || widgetIds.length) msg += " Notes and widgets are deleted.";
    if (!confirm(msg)) return;
    for (const id of cardIds) delWs.mutate(id);
    for (const id of noteIds) removeNote(id);
    for (const id of widgetIds) removeWidget(id);
    clearSelection();
  };

  // Group the selected workspace cards into one new folder (the multi-select half of the iPhone-folder
  // gesture; the other half is dropping one card onto another in SpaceCanvas). Notes/widgets in the
  // selection are ignored — only cards fold. The folder lands at the top-left-most card's spot.
  const groupSelected = () => {
    const { workspaces } = data.current;
    const ids = [...useUi.getState().selection].filter(k => k.startsWith("card:")).map(k => k.slice(5));
    const cards = ids.map(id => workspaces.find(w => w.id === id)).filter((w): w is Workspace => !!w);
    if (cards.length < 2) return;
    const x = Math.min(...cards.map(c => c.x)), y = Math.min(...cards.map(c => c.y));
    createFolder({ spaceId: activeSpaceId, x, y, memberIds: cards.map(c => c.id) });
    clearSelection();
  };

  // Keep the latest commit fns reachable from the bound-once listeners.
  const fns = useRef({ commitGroupMove, deleteSelected });
  fns.current = { commitGroupMove, deleteSelected };

  // Switching spaces hides the current items — drop the (now off-screen) selection so a later
  // delete/drag can't reach across to it.
  useEffect(() => { clearSelection(); }, [activeSpaceId, clearSelection]);

  useEffect(() => {
    const ui = useUi.getState; // fresh state on every call

    const startGroupDrag = (sx: number, sy: number) => {
      const onMove = (ev: PointerEvent) => ui().setGroupDrag({ dx: ev.clientX - sx, dy: ev.clientY - sy });
      const onUp = (ev: PointerEvent) => {
        document.removeEventListener("pointermove", onMove, true);
        document.removeEventListener("pointerup", onUp, true);
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        ui().setGroupDrag(null);
        fns.current.commitGroupMove(dx, dy);
      };
      document.addEventListener("pointermove", onMove, true);
      document.addEventListener("pointerup", onUp, true);
    };

    const startMarquee = (sx: number, sy: number, additive: boolean) => {
      const base = additive ? [...ui().selection] : [];
      let moved = false;
      const onMove = (ev: PointerEvent) => {
        const x = Math.min(sx, ev.clientX), y = Math.min(sy, ev.clientY);
        const w = Math.abs(ev.clientX - sx), h = Math.abs(ev.clientY - sy);
        if (w > 3 || h > 3) moved = true;
        setMarquee({ x, y, w, h });
        const hit = new Set(base);
        document.querySelectorAll<HTMLElement>("[data-canvas-item]").forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.right >= x && r.left <= x + w && r.bottom >= y && r.top <= y + h && el.dataset.itemKey) hit.add(el.dataset.itemKey);
        });
        ui().setSelection([...hit]);
      };
      const onUp = () => {
        document.removeEventListener("pointermove", onMove, true);
        document.removeEventListener("pointerup", onUp, true);
        setMarquee(null);
        if (!moved && !additive) ui().clearSelection();
      };
      document.addEventListener("pointermove", onMove, true);
      document.addEventListener("pointerup", onUp, true);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return; // left button only
      // Touch: let the canvas pan natively and let dnd-kit's TouchSensor own card drags. Marquee,
      // group-drag, and ⌘/shift multi-select are mouse-pointer gestures — starting one here calls
      // preventDefault() and would kill one-finger pan. (Desktop trackpad/mouse still gets all of them.)
      if (e.pointerType === "touch") return;
      const t = e.target as HTMLElement | null;
      if (!t) return;
      // Never interfere with controls, editors, portaled menus, or anything opting out of drag.
      if (t.closest("button, input, textarea, select, a, [data-no-drag], [data-no-marquee]")) return;
      const mod = e.shiftKey || e.metaKey || e.ctrlKey;
      const itemEl = t.closest<HTMLElement>("[data-canvas-item]");
      if (itemEl?.dataset.itemKey) {
        const key = itemEl.dataset.itemKey;
        const sel = ui().selection;
        if (mod) { e.preventDefault(); e.stopPropagation(); ui().toggleSelected(key); return; }
        if (sel.has(key) && sel.size > 1) { e.preventDefault(); e.stopPropagation(); startGroupDrag(e.clientX, e.clientY); return; }
        ui().setSelection([key]); // single select — let the item's own single-drag proceed (no stop)
        return;
      }
      if (t.closest("[data-space]")) { e.preventDefault(); startMarquee(e.clientX, e.clientY, mod); } // bare canvas → marquee
    };

    const onContextMenu = (e: MouseEvent) => {
      const sel = ui().selection;
      if (sel.size <= 1) return; // single/none → let the item's own right-click menu show
      const itemEl = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-canvas-item]");
      if (!itemEl?.dataset.itemKey || !sel.has(itemEl.dataset.itemKey)) return;
      e.preventDefault(); e.stopPropagation();
      setMenu({ x: e.clientX, y: e.clientY });
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { if (ui().selection.size) ui().clearSelection(); return; }
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (!ui().selection.size) return;
      const ae = document.activeElement as HTMLElement | null;
      // Don't hijack a real keystroke: bail if typing in a field/note or focused inside a terminal.
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable || ae.closest(".xterm"))) return;
      // Only act when the canvas (not a room/window) holds focus.
      if (ae && ae !== document.body && !ae.closest("[data-space]")) return;
      e.preventDefault();
      fns.current.deleteSelected();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <>
      {marquee && createPortal(
        <div style={{
          position: "fixed", left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h,
          zIndex: 46, borderRadius: 4, pointerEvents: "none",
          border: "1px solid rgb(var(--tr-info))", background: "rgb(var(--tr-info) / 0.12)",
        }} />,
        document.body,
      )}
      {menu && <MultiMenu anchor={menu} onRemove={() => { fns.current.deleteSelected(); setMenu(null); }}
        onGroup={() => { groupSelected(); setMenu(null); }}
        onClear={() => { clearSelection(); setMenu(null); }} dismiss={() => setMenu(null)} />}
    </>
  );
}

/** Right-click menu for a multi-selection: remove everything selected, or just clear the selection.
 *  Portals to <body>, fixed-positioned, closes on outside click + Escape — the canvas menu pattern. */
function MultiMenu({ anchor, onRemove, onGroup, onClear, dismiss }: {
  anchor: { x: number; y: number }; onRemove: () => void; onGroup: () => void; onClear: () => void; dismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const count = useUi(s => s.selection.size);
  // How many of the selected items are workspace cards — grouping needs at least two.
  const cardCount = useUi(s => [...s.selection].filter(k => k.startsWith("card:")).length);
  useEffect(() => {
    // Dismiss on any outside press. Must be `pointerdown` (capture, on window so it lands BEFORE the
    // canvas's own handler) — NOT `mousedown`: CanvasSelection's capture-phase pointerdown calls
    // preventDefault() to start a marquee, which suppresses the compatibility mousedown event. A
    // mousedown listener therefore never fires for blank-canvas clicks and the menu would linger.
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) dismiss(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    const raf = requestAnimationFrame(() => window.addEventListener("pointerdown", onDown, true));
    window.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("pointerdown", onDown, true); window.removeEventListener("keydown", onKey); };
  }, [dismiss]);
  return createPortal(
    <div ref={ref} onPointerDown={(e) => e.stopPropagation()}
      style={{ position: "fixed", left: Math.min(anchor.x, window.innerWidth - 220), top: Math.min(anchor.y, window.innerHeight - 120), zIndex: 70 }}
      className="w-52 rounded-lg border border-edge bg-panel py-1 text-sm text-fg shadow-2xl select-none">
      {cardCount >= 2 && <Item label={`Group into folder (${cardCount})`} onClick={onGroup} />}
      {cardCount >= 2 && <Sep />}
      <Item label={`Remove selected (${count})`} onClick={onRemove} />
      <Sep />
      <Item label="Clear selection" onClick={onClear} />
    </div>,
    document.body,
  );
}
