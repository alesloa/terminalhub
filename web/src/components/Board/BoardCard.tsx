import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { BoardCard as Card, BoardColumn as Col } from "../../api/types";
import { ColorPicker, WS_L_MIN } from "../TerminalContextMenu";
import { BoardCardMenu } from "./BoardCardMenu";

// The card body is clamped to 3 lines on the face; hovering pops a styled tooltip (title + full
// note). Past this many characters the tooltip's note is cut off — a nudge to drop a wall of text
// into a file rather than the card.
const TOOLTIP_MAX = 1000;
const TIP_W = 340;

function tipNote(body: string): string {
  const note = body.trim();
  return note.length > TOOLTIP_MAX
    ? note.slice(0, TOOLTIP_MAX) + "…\n\n(truncated — open it in a text file to read the rest)"
    : note;
}

/** The visual face of a card — shared by the live card and the drag overlay so the whole card
 *  follows the cursor. `color` paints a left accent stripe; the body preview is clamped to 3 lines
 *  (the full note shows in the hover tooltip). */
export function CardFace({ card, dragging }: { card: Card; dragging?: boolean }) {
  const note = card.body.trim();
  return (
    <div
      style={card.color ? { borderLeftColor: card.color, borderLeftWidth: 3 } : undefined}
      className={`rounded-md border border-edge ${card.color ? "" : "border-l-[3px] border-l-transparent"} bg-elevated px-2.5 py-2 text-sm shadow-sm ${dragging ? "ring-1 ring-edge-strong rotate-1" : ""}`}>
      <div className={`truncate ${card.title.trim() ? "text-fg" : "text-dim italic"}`}>
        {card.title.trim() || "Untitled"}
      </div>
      {note && (
        <div className="mt-1 text-xs text-dim whitespace-pre-wrap line-clamp-3">{card.body}</div>
      )}
    </div>
  );
}

/** Hover tooltip: the card's title on top, the full note below, sized for comfortable reading.
 *  Portal'd to <body> (fixed, pointer-events-none) so the column's scroll and the window's overflow
 *  can't clip it; opens beside the card on whichever side has room, clamped into the viewport. */
function CardTooltip({ anchor, title, note }: {
  anchor: { x: number; y: number; w: number; h: number }; title: string; note: string;
}) {
  const openLeft = anchor.x + anchor.w + 8 + TIP_W > window.innerWidth;
  const left = openLeft ? Math.max(8, anchor.x - TIP_W - 8) : anchor.x + anchor.w + 8;
  const top = Math.max(8, Math.min(anchor.y, window.innerHeight - 120));
  const maxHeight = window.innerHeight - top - 8;
  return createPortal(
    <div style={{ position: "fixed", left, top, width: TIP_W, maxHeight, zIndex: 80 }}
      className="pointer-events-none overflow-hidden rounded-lg border border-edge-strong bg-panel shadow-2xl">
      <div className="px-3 py-2 border-b border-edge text-[15px] font-semibold text-bright whitespace-pre-wrap break-words">
        {title}
      </div>
      {note && (
        <div className="px-3 py-2 text-sm leading-relaxed text-fg whitespace-pre-wrap break-words">{note}</div>
      )}
    </div>,
    document.body,
  );
}

/**
 * A board card. The whole card is the drag handle (the MouseSensor's 8px activation distance lets
 * stationary gestures through; touch uses press-and-hold). Single click selects it (ring; press
 * Delete/Backspace to remove),
 * double click opens inline edit, right click opens the context menu (edit / color / move / delete).
 * It is also a drop target so a card dragged over it knows the insert index.
 */
export function BoardCard({ card, selected, onSelect, onUpdate, onMove, onRemove }: {
  card: Card;
  selected: boolean;
  onSelect: (id: string) => void;
  onUpdate: (id: string, patch: { title?: string; body?: string; color?: string | null }) => void;
  onMove: (id: string, column: Col) => void;
  onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: card.title, body: card.body });
  const [colorOpen, setColorOpen] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const localRef = useRef<HTMLDivElement | null>(null);
  const tipTimer = useRef<number | null>(null);

  const drag = useDraggable({ id: card.id, data: { type: "card", column: card.column }, disabled: editing });
  const drop = useDroppable({ id: card.id, data: { type: "card", column: card.column } });
  const setRef = useCallback((el: HTMLDivElement | null) => {
    drag.setNodeRef(el); drop.setNodeRef(el); localRef.current = el;
  }, [drag, drop]);

  // Hover tooltip: arm a short delay on enter (so it doesn't flash while skimming), cancel on leave.
  const clearTip = useCallback(() => {
    if (tipTimer.current) { window.clearTimeout(tipTimer.current); tipTimer.current = null; }
    setTip(null);
  }, []);
  const enterTip = (el: HTMLElement) => {
    if (!card.body.trim()) return;
    const r = el.getBoundingClientRect();
    tipTimer.current = window.setTimeout(() => setTip({ x: r.left, y: r.top, w: r.width, h: r.height }), 350);
  };

  const openEdit = () => { clearTip(); setDraft({ title: card.title, body: card.body }); setEditing(true); };
  const commit = useCallback(() => {
    setEditing(false); setColorOpen(false);
    if (draft.title !== card.title || draft.body !== card.body) onUpdate(card.id, { title: draft.title, body: draft.body });
  }, [draft, card, onUpdate]);

  // While editing, an outside pointer-down commits and closes.
  useEffect(() => {
    if (!editing) return;
    const onDown = (e: PointerEvent) => { if (!localRef.current?.contains(e.target as Node)) commit(); };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [editing, commit]);

  // Drop a pending/visible tooltip the moment a drag begins, and clean up the timer on unmount.
  useEffect(() => { if (drag.isDragging) clearTip(); }, [drag.isDragging, clearTip]);
  useEffect(() => () => { if (tipTimer.current) window.clearTimeout(tipTimer.current); }, []);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); commit(); }
    if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") { e.preventDefault(); commit(); }
  };

  if (editing) {
    return (
      <div ref={setRef} data-card onKeyDown={onKey}
        className="rounded-md border border-edge-strong bg-elevated p-2 shadow-md">
        <input autoFocus value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          placeholder="Title" className="w-full bg-canvas rounded px-2 py-1 text-sm text-fg outline-none" />
        <textarea value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
          placeholder="Notes…" rows={4}
          className="mt-1.5 w-full resize-y min-h-[4rem] max-h-[60vh] bg-canvas rounded px-2 py-1 text-xs text-fg outline-none" />
        <div className="mt-1.5 flex items-center gap-2">
          <button onClick={() => setColorOpen((o) => !o)} title="Card color"
            style={card.color ? { background: card.color } : undefined}
            className={`w-5 h-5 rounded border border-edge-strong ${card.color ? "" : "bg-panel"}`} />
          <div className="flex-1" />
          <button onClick={() => onRemove(card.id)} className="px-2 h-6 rounded text-xs text-red-300 hover:bg-[#3a1d2a]">Delete</button>
          <button onClick={commit} className="px-2.5 h-6 rounded bg-blue-600 hover:bg-blue-500 text-xs">Done</button>
        </div>
        {colorOpen && (
          <div className="mt-1.5">
            <ColorPicker current={card.color} minLight={WS_L_MIN}
              onPick={(c) => { onUpdate(card.id, { color: c }); setColorOpen(false); }} />
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div ref={setRef} data-card {...drag.listeners} {...drag.attributes}
        onMouseEnter={(e) => enterTip(e.currentTarget)}
        onMouseLeave={clearTip}
        onClick={() => onSelect(card.id)}
        onDoubleClick={openEdit}
        onContextMenu={(e) => { e.preventDefault(); clearTip(); onSelect(card.id); setMenu({ x: e.clientX, y: e.clientY }); }}
        className={`group relative cursor-grab active:cursor-grabbing rounded-md ${selected ? "ring-2 ring-accent" : ""} ${drag.isDragging ? "opacity-30" : ""}`}>
        <CardFace card={card} />
      </div>
      {tip && !drag.isDragging && (
        <CardTooltip anchor={tip} title={card.title.trim() || "Untitled"} note={tipNote(card.body)} />
      )}
      {menu && (
        <BoardCardMenu anchor={menu} card={card}
          onEdit={openEdit}
          onColor={(c) => onUpdate(card.id, { color: c })}
          onMove={(col) => onMove(card.id, col)}
          onRemove={() => onRemove(card.id)}
          dismiss={() => setMenu(null)} />
      )}
    </>
  );
}
