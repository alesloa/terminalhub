import {
  forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState,
  type CSSProperties, type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent, type TransitionEventHandler,
} from "react";
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, closestCorners, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import type { BoardCard as Card, BoardColumn as Col } from "../../api/types";
import type { WinRect } from "../../store/ui";
import { spacesBarBottom } from "../../store/ui";
import { useDraggableWindow, type WindowHandle } from "../../hooks/useDraggableWindow";
import { ResizeHandles } from "../ResizeHandles";
import { useBoard } from "./useBoard";
import { BoardColumn } from "./BoardColumn";
import { CardFace } from "./BoardCard";

const RECT_KEY = "tr.boardRect"; // remembered window geometry (per-browser)
const MIN_W = 560, MIN_H = 320;  // three readable lanes side by side
const DURATION = 300;            // ms — grow-from-icon / minimize-to-icon animation

const COLUMNS: { column: Col; label: string }[] = [
  { column: "todo", label: "To Do" },
  { column: "doing", label: "In Progress" },
  { column: "done", label: "Done" },
];

/** A wide, centered board, clamped below the spaces bar. */
function defaultRect(): WinRect {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(980, Math.round(vw * 0.82));
  const h = Math.min(640, Math.round(vh * 0.7));
  const top = spacesBarBottom() + 8;
  return { w, h, x: Math.max(8, Math.round((vw - w) / 2)), y: Math.max(top, Math.round((vh - h) / 2)) };
}

/** Restore saved geometry, clamped back into the current viewport. */
function loadRect(): WinRect {
  try {
    const raw = localStorage.getItem(RECT_KEY);
    if (raw) {
      const r = JSON.parse(raw) as Partial<WinRect>;
      if (typeof r.x === "number" && typeof r.y === "number" && typeof r.w === "number" && typeof r.h === "number") {
        const vw = window.innerWidth, vh = window.innerHeight;
        const w = Math.max(MIN_W, Math.min(r.w, vw - 16));
        const h = Math.max(MIN_H, Math.min(r.h, vh - 16));
        return { w, h, x: Math.max(8, Math.min(vw - 80, r.x)), y: Math.max(8, Math.min(vh - 60, r.y)) };
      }
    }
  } catch { /* ignore corrupt/blocked storage */ }
  return defaultRect();
}

/**
 * The task board: a free-floating, draggable, resizable kanban window (NOT a modal — never dims the
 * canvas). Three lanes (To Do / In Progress / Done); drag cards between or within lanes. The board
 * is server-backed, so terminal agents can move cards too (the list polls and reflects their edits).
 * Drag the title bar to move, grab the edges to resize; geometry is remembered per-browser. Opening
 * grows the window out of the toolbar icon (`origin`); Close minimizes it back before unmounting.
 */
export const BoardModal = forwardRef<WindowHandle, { origin?: WinRect | null; onClose: () => void }>(function BoardModal({ origin, onClose }, ref) {
  const { cards, isLoading, create, update, move, remove } = useBoard();
  const [seed] = useState(loadRect);
  const { rect, beginDrag, beginResize } = useDraggableWindow(seed, MIN_W, MIN_H, undefined, undefined, "board");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Mouse: 8px drag to start (taps/clicks still pass through). Touch: press-and-hold (~0.2s) to start
  // a card drag so a quick finger swipe scrolls the board/columns natively instead of grabbing a card.
  // Mirrors the canvas sensors (SpaceCanvas); `tolerance` cancels the pending hold if the finger travels.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  const byColumn = useMemo(() => {
    const g: Record<Col, Card[]> = { todo: [], doing: [], done: [] };
    for (const c of cards) g[c.column]?.push(c);
    (Object.keys(g) as Col[]).forEach((k) => g[k].sort((a, b) => a.position - b.position));
    return g;
  }, [cards]);
  const activeCard = activeId ? cards.find((c) => c.id === activeId) ?? null : null;

  // Select a card (focus the window so its key handler catches Delete), move it to a lane's end, or
  // remove it (clearing selection if it was the one removed).
  const select = (id: string) => { setSelectedId(id); rootRef.current?.focus({ preventScroll: true }); };
  const removeCard = (id: string) => { setSelectedId((s) => (s === id ? null : s)); void remove(id); };
  const moveToColumn = (id: string, column: Col) => {
    void move(id, column, byColumn[column].filter((c) => c.id !== id).length);
  };

  // Delete/Backspace removes the selected card (Backspace is the Mac "delete" key); Escape clears the
  // selection. Ignored while typing in a card's title/notes so editing text isn't hijacked.
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") { setSelectedId(null); return; }
    if (e.key !== "Delete" && e.key !== "Backspace" || !selectedId) return;
    const t = e.target as HTMLElement;
    if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
    e.preventDefault();
    removeCard(selectedId);
  };
  // Clicking the window chrome / empty lane space (anything that isn't a card) clears the selection.
  const onRootPointerDown = (e: ReactPointerEvent) => {
    if (!(e.target as HTMLElement).closest("[data-card]")) setSelectedId(null);
  };

  // Grow-from-icon on open, minimize-to-icon on close (same trick as the notepad/room windows).
  // `settled` drops the transform/will-change once the open animation finishes: a transformed (or
  // will-change:transform) ancestor becomes the containing block for position:fixed descendants,
  // which would offset the DragOverlay card from the cursor. No transform while dragging → no offset.
  const reduce = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [expanded, setExpanded] = useState(reduce);
  const [settled, setSettled] = useState(reduce);
  useEffect(() => {
    if (reduce) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setExpanded(true)));
    return () => cancelAnimationFrame(id);
  }, [reduce]);
  const handleClose = () => { if (reduce) { onClose(); return; } setSettled(false); setExpanded(false); };
  // Expose the same minimize-to-icon close to the TopBar Board icon so a second press collapses it.
  useImperativeHandle(ref, () => ({ close: handleClose }));
  const onTransitionEnd: TransitionEventHandler = (e) => {
    if (e.target !== e.currentTarget || e.propertyName !== "transform") return;
    if (expanded) setSettled(true); // open finished → drop the transform so DragOverlay tracks the cursor
    else onClose();                 // close finished → unmount
  };

  // Remember geometry, debounced so drag/resize doesn't hammer localStorage every frame.
  useEffect(() => {
    const t = window.setTimeout(() => { try { localStorage.setItem(RECT_KEY, JSON.stringify(rect)); } catch { /* blocked */ } }, 300);
    return () => window.clearTimeout(t);
  }, [rect]);

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over || over.id === active.id) return; // dropped on its own slot → no move
    const dragged = cards.find((c) => c.id === active.id);
    if (!dragged) return;
    const overId = String(over.id);
    // Dropping on the lane's empty space targets the lane; dropping on a card inserts before it.
    let column: Col;
    let beforeId: string | null = null;
    if (overId.startsWith("col:")) column = overId.slice(4) as Col;
    else { column = (over.data.current?.column as Col) ?? dragged.column; beforeId = overId; }
    const others = byColumn[column].filter((c) => c.id !== active.id);
    let index = others.length;
    if (beforeId) { const i = others.findIndex((c) => c.id === beforeId); if (i >= 0) index = i; }
    if (column === dragged.column && index === byColumn[column].findIndex((c) => c.id === active.id)) return; // no-op
    void move(String(active.id), column, index);
  };

  const collapsed = origin
    ? `translate(${origin.x - rect.x}px, ${origin.y - rect.y}px) scale(${origin.w / rect.w}, ${origin.h / rect.h})`
    : "scale(0.94)";
  const style: CSSProperties = {
    left: rect.x, top: rect.y, width: rect.w, height: rect.h,
    ...(reduce || settled ? {} : {
      transformOrigin: origin ? "0 0" : "50% 50%",
      transform: expanded ? "translate(0px, 0px) scale(1, 1)" : collapsed,
      opacity: expanded ? 1 : 0,
      transition: `transform ${DURATION}ms cubic-bezier(.22,.61,.36,1), opacity ${DURATION}ms ease`,
      willChange: "transform, opacity",
    }),
  };

  return (
    <div ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown} onPointerDown={onRootPointerDown}
      onTransitionEnd={onTransitionEnd} style={style}
      className="fixed z-50 flex flex-col rounded-lg overflow-hidden border border-edge-strong bg-canvas shadow-2xl outline-none">
      <div onPointerDown={beginDrag}
        className="h-8 shrink-0 flex items-center justify-between px-4 border-b border-edge cursor-move select-none">
        <div className="font-semibold">Board</div>
        <div className="flex items-center gap-2" onPointerDown={(e) => e.stopPropagation()}>
          <button onClick={handleClose} title="Close"
            className="px-3 h-6 inline-flex items-center bg-elevated rounded text-sm">Close</button>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="flex-1 min-h-0 flex gap-2 p-2">
          {isLoading && cards.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-dim text-sm">loading…</div>
          ) : (
            COLUMNS.map((c) => (
              <BoardColumn key={c.column} column={c.column} label={c.label} cards={byColumn[c.column]}
                addable={c.column === "todo"} selectedId={selectedId} onSelect={select}
                onCreate={create} onUpdate={update} onMove={moveToColumn} onRemove={removeCard} />
            ))
          )}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeCard && <CardFace card={activeCard} dragging />}
        </DragOverlay>
      </DndContext>

      <ResizeHandles onStart={beginResize} />
    </div>
  );
});
