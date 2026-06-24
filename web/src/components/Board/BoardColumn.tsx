import { useState, type KeyboardEvent } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { BoardCard as Card, BoardColumn as Col } from "../../api/types";
import { BoardCard } from "./BoardCard";

/** One kanban lane: a header with a live count, a scrollable, droppable list of its cards, and an
 *  inline composer at the bottom. The whole list (incl. empty space below the cards) is the drop
 *  zone, so a card released below the last card appends to this column. */
export function BoardColumn({ column, label, cards, addable, selectedId, onSelect, onCreate, onUpdate, onMove, onRemove }: {
  column: Col;
  label: string;
  cards: Card[];
  addable: boolean; // only the backlog lane (To Do) offers a composer; other lanes are drag-only
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: (column: Col, title: string) => void;
  onUpdate: (id: string, patch: { title?: string; body?: string; color?: string | null }) => void;
  onMove: (id: string, column: Col) => void;
  onRemove: (id: string) => void;
}) {
  const drop = useDroppable({ id: `col:${column}`, data: { type: "column", column } });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");

  const add = () => { const t = title.trim(); if (t) onCreate(column, t); setTitle(""); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); add(); }
    if (e.key === "Escape") { e.preventDefault(); setAdding(false); setTitle(""); }
  };

  return (
    <div className="flex-1 min-w-0 flex flex-col rounded-lg bg-canvas">
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-edge">
        <span className="text-xs font-semibold uppercase tracking-wide text-dim">{label}</span>
        <span className="text-xs text-muted">{cards.length}</span>
      </div>

      <div ref={drop.setNodeRef}
        className={`flex-1 min-h-0 overflow-auto p-2 space-y-2 ${drop.isOver ? "bg-panel/60" : ""}`}>
        {cards.map((c) => (
          <BoardCard key={c.id} card={c} selected={c.id === selectedId} onSelect={onSelect}
            onUpdate={onUpdate} onMove={onMove} onRemove={onRemove} />
        ))}

        {addable && adding && (
          <div className="rounded-md border border-edge-strong bg-elevated p-2">
            <textarea autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={onKey}
              placeholder="Card title… (Enter to add)" rows={2}
              className="w-full resize-none bg-canvas rounded px-2 py-1 text-sm text-fg outline-none" />
            <div className="mt-1.5 flex items-center gap-2">
              <button onClick={add} className="px-2.5 h-6 rounded bg-blue-600 hover:bg-blue-500 text-xs">Add</button>
              <button onClick={() => { setAdding(false); setTitle(""); }} className="px-2 h-6 rounded text-xs text-dim hover:bg-edge">Cancel</button>
            </div>
          </div>
        )}
        {cards.length === 0 && !(addable && adding) && <div className="px-1 py-3 text-xs text-muted">No cards.</div>}
      </div>

      {addable && (
        <button onClick={() => setAdding(true)}
          className="shrink-0 m-2 py-1.5 rounded text-xs text-dim hover:text-fg hover:bg-elevated border border-dashed border-edge">
          + Add a card
        </button>
      )}
    </div>
  );
}
