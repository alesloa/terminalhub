import { useEffect, useMemo, useRef, useState } from "react";
import type { Note, NoteGroup } from "../../api/types";

// Reserved filter sentinels; any other value is a NoteGroup id. Kept here so the rail and the modal
// agree on what "which collection is showing" means.
export const ALL = "all";
export const UNGROUPED = "ungrouped";
export type NotesFilter = typeof ALL | typeof UNGROUPED | (string & {});

// Group dot palette — click a group's dot to cycle through these (null = no color). Same six hues the
// Markdown editor offers, so the app feels of a piece.
const DOTS: (string | null)[] = [null, "#60a5fa", "#86efac", "#fbbf24", "#fda4af", "#c4b5fd", "#94a3b8"];
function nextDot(cur: string | null): string | null {
  const i = DOTS.findIndex((d) => d === cur);
  return DOTS[(i + 1) % DOTS.length];
}

/**
 * The Notes panel's left rail: a Mac-Notes-style list of group collections. "All Notes" + each group
 * + "Ungrouped", every row showing a live count and acting as a drop target — drag a note row here to
 * file it. Double-click a group to rename it; click its dot to recolor; hover for delete. New groups
 * are created via the footer button and drop straight into rename mode.
 */
export function NoteGroupsRail({
  groups, notes, filter, onFilter, draggingNoteId,
  onCreateGroup, onRenameGroup, onRecolorGroup, onRemoveGroup, onDropNote,
}: {
  groups: NoteGroup[];
  notes: Note[];
  filter: NotesFilter;
  onFilter: (f: NotesFilter) => void;
  draggingNoteId: string | null;
  onCreateGroup: () => Promise<NoteGroup>;
  onRenameGroup: (id: string, name: string) => void;
  onRecolorGroup: (id: string, color: string | null) => void;
  onRemoveGroup: (id: string) => void;
  onDropNote: (groupId: string | null, noteId: string) => void;
}) {
  const counts = useMemo(() => {
    const byGroup = new Map<string, number>();
    let ungrouped = 0;
    for (const n of notes) {
      if (n.groupId) byGroup.set(n.groupId, (byGroup.get(n.groupId) ?? 0) + 1);
      else ungrouped++;
    }
    return { byGroup, ungrouped, all: notes.length };
  }, [notes]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [dropTarget, setDropTarget] = useState<NotesFilter | null>(null);
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editingId) requestAnimationFrame(() => editRef.current?.select()); }, [editingId]);

  const startEdit = (g: NoteGroup) => { setEditingId(g.id); setDraft(g.name); };
  const commitEdit = () => {
    if (editingId) { const name = draft.trim() || "Untitled group"; onRenameGroup(editingId, name); }
    setEditingId(null);
  };
  const newGroup = async () => { const g = await onCreateGroup(); onFilter(g.id); startEdit(g); };

  // Drop wiring shared by every droppable row. "All Notes" is not a real bucket, so it never accepts.
  const dropProps = (target: NotesFilter, groupId: string | null) =>
    draggingNoteId && target !== ALL
      ? {
          onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDropTarget(target); },
          onDragLeave: () => setDropTarget((t) => (t === target ? null : t)),
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            const id = e.dataTransfer.getData("text/note-id");
            if (id) onDropNote(groupId, id);
            setDropTarget(null);
          },
        }
      : {};

  const rowCls = (active: boolean, isDrop: boolean) =>
    `group/row w-full flex items-center gap-2 px-2 h-7 rounded-md text-sm cursor-pointer select-none ${
      active ? "bg-elevated text-bright" : "text-fg hover:bg-surface"
    } ${isDrop ? "ring-1 ring-inset ring-accent bg-accent/10" : ""}`;

  return (
    <div className="w-44 shrink-0 border-r border-edge flex flex-col bg-panel/40">
      <div className="px-3 pt-3 pb-1 text-[10px] font-semibold tracking-wider text-dim uppercase">Groups</div>

      <div className="flex-1 min-h-0 overflow-auto px-2 pb-2 space-y-0.5">
        {/* All Notes */}
        <div className={rowCls(filter === ALL, false)} onClick={() => onFilter(ALL)}>
          <Glyph kind="all" />
          <span className="flex-1 min-w-0 truncate">All Notes</span>
          <Count n={counts.all} active={filter === ALL} />
        </div>

        {/* Groups */}
        {groups.map((g) => {
          const active = filter === g.id;
          const editing = editingId === g.id;
          return (
            <div key={g.id} className={rowCls(active, dropTarget === g.id)} onClick={() => !editing && onFilter(g.id)}
              {...dropProps(g.id, g.id)}>
              <button title="Change color"
                onClick={(e) => { e.stopPropagation(); onRecolorGroup(g.id, nextDot(g.color)); }}
                className="shrink-0 w-3 h-3 rounded-full border border-edge-strong"
                style={{ background: g.color ?? "transparent" }} />
              {editing ? (
                <input ref={editRef} value={draft} onChange={(e) => setDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()} onBlur={commitEdit}
                  onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditingId(null); }}
                  className="flex-1 min-w-0 bg-canvas border border-accent rounded px-1 outline-none text-sm" />
              ) : (
                <span className="flex-1 min-w-0 truncate" onDoubleClick={(e) => { e.stopPropagation(); startEdit(g); }}>{g.name || "Untitled group"}</span>
              )}
              {!editing && (
                <span role="button" tabIndex={0} title="Delete group (notes move to Ungrouped)"
                  onClick={(e) => { e.stopPropagation(); if (confirm(`Delete group "${g.name || "Untitled group"}"? Its notes move to Ungrouped.`)) onRemoveGroup(g.id); }}
                  className="shrink-0 opacity-0 group-hover/row:opacity-100 text-dim hover:text-error leading-none px-0.5">✕</span>
              )}
              {!editing && <Count n={counts.byGroup.get(g.id) ?? 0} active={active} hideOnHover />}
            </div>
          );
        })}

        {/* Ungrouped */}
        <div className={rowCls(filter === UNGROUPED, dropTarget === UNGROUPED)} onClick={() => onFilter(UNGROUPED)}
          {...dropProps(UNGROUPED, null)}>
          <Glyph kind="ungrouped" />
          <span className="flex-1 min-w-0 truncate text-muted">Ungrouped</span>
          <Count n={counts.ungrouped} active={filter === UNGROUPED} />
        </div>
      </div>

      <button onClick={newGroup} title="New group"
        className="m-2 mt-0 flex items-center gap-1.5 px-2 h-7 rounded-md text-sm text-muted hover:bg-surface hover:text-fg">
        <span className="text-base leading-none">＋</span> New group
      </button>
    </div>
  );
}

function Count({ n, active, hideOnHover }: { n: number; active?: boolean; hideOnHover?: boolean }) {
  return (
    <span className={`shrink-0 min-w-4 text-center text-[11px] tabular-nums ${active ? "text-bright" : "text-dim"} ${hideOnHover ? "group-hover/row:hidden" : ""}`}>
      {n || ""}
    </span>
  );
}

// Small monochrome glyphs for the non-group rows, in the current text color.
function Glyph({ kind }: { kind: "all" | "ungrouped" }) {
  return (
    <svg viewBox="0 0 16 16" className="shrink-0 w-3.5 h-3.5 text-dim" fill="none" stroke="currentColor" strokeWidth="1.4">
      {kind === "all"
        ? <><path d="M2.5 4h11M2.5 8h11M2.5 12h7" strokeLinecap="round" /></>
        : <><path d="M3 5.5A1.5 1.5 0 0 1 4.5 4h2l1.2 1.4h5.3" strokeLinejoin="round" /><rect x="2.6" y="5.4" width="10.8" height="6.6" rx="1.3" /></>}
    </svg>
  );
}
