import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Note, NoteGroup } from "../../api/types";

export type NoteMenuState = { note: Note; x: number; y: number };

/**
 * Right-click menu for a note row (Mac-Notes style): copy as Markdown, duplicate, move into any
 * group (or Ungrouped), and delete. Opens at the cursor, clamps into the viewport, and dismisses on
 * outside-click / Escape / scroll. Pure presentation — the parent owns the data mutations.
 */
export function NoteContextMenu({ state, groups, onMove, onCopy, onDuplicate, onDelete, onClose }: {
  state: NoteMenuState;
  groups: NoteGroup[];
  onMove: (note: Note, groupId: string | null) => void;
  onCopy: (note: Note) => void;
  onDuplicate: (note: Note) => void;
  onDelete: (note: Note) => void;
  onClose: () => void;
}) {
  const { note } = state;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: state.x, y: state.y });

  // Clamp the menu inside the viewport once it has measured itself.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: Math.min(state.x, window.innerWidth - width - 8),
      y: Math.min(state.y, window.innerHeight - height - 8),
    });
  }, [state.x, state.y]);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    // Defer the outside-click listener a tick so the opening right-click doesn't immediately close it.
    const id = window.setTimeout(() => window.addEventListener("pointerdown", close), 0);
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", close, { passive: true });
    return () => { window.clearTimeout(id); window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", onKey); window.removeEventListener("wheel", close); };
  }, [onClose]);

  const item = "w-full flex items-center gap-2 px-3 h-7 text-left text-sm text-fg hover:bg-surface rounded";

  return (
    <div ref={ref} onPointerDown={(e) => e.stopPropagation()} style={{ left: pos.x, top: pos.y }}
      className="fixed z-[60] w-52 py-1 rounded-lg border border-edge-strong bg-canvas shadow-2xl">
      <button className={item} onClick={() => { onCopy(note); onClose(); }}>Copy as Markdown</button>
      <button className={item} onClick={() => { onDuplicate(note); onClose(); }}>Duplicate</button>

      <div className="my-1 border-t border-edge" />
      <div className="px-3 py-0.5 text-[10px] font-semibold tracking-wider text-dim uppercase">Move to</div>
      <div className="max-h-52 overflow-auto">
        <MoveItem label="Ungrouped" dot={null} active={!note.groupId} onClick={() => { onMove(note, null); onClose(); }} />
        {groups.map((g) => (
          <MoveItem key={g.id} label={g.name || "Untitled group"} dot={g.color} active={note.groupId === g.id}
            onClick={() => { onMove(note, g.id); onClose(); }} />
        ))}
      </div>

      <div className="my-1 border-t border-edge" />
      <button className="w-full flex items-center gap-2 px-3 h-7 text-left text-sm text-error hover:bg-error/10 rounded"
        onClick={() => { onDelete(note); onClose(); }}>Delete</button>
    </div>
  );
}

function MoveItem({ label, dot, active, onClick }: { label: string; dot: string | null; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-2 px-3 h-7 text-left text-sm text-fg hover:bg-surface rounded">
      <span className="shrink-0 w-2.5 h-2.5 rounded-full border border-edge-strong" style={{ background: dot ?? "transparent" }} />
      <span className="flex-1 min-w-0 truncate">{label}</span>
      {active && <span className="shrink-0 text-accent">✓</span>}
    </button>
  );
}
