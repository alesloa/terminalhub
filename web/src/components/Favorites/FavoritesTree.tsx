import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, pointerWithin, useDraggable, useDroppable,
  useSensor, useSensors, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import type { Favorite, FavoriteGroup } from "../../api/types";
import { basename } from "../../lib/paths";
import type { FavoritesApi } from "./useFavorites";
import { FavoriteContextMenu, type FavMenuTarget } from "./FavoriteContextMenu";

const INDENT = 12;

/** In-progress inline edit (replaces browser prompt() — name entry happens in the tree itself). */
export type FavEditing =
  | { kind: "new-group"; parentId: string | null }
  | { kind: "rename-group"; id: string }
  | { kind: "rename-favorite"; id: string };

/**
 * The saved-favorites tree. Groups (folder icon) nest arbitrarily and hold favorites (drop
 * icon). Drag a row onto a group to reparent into it, onto a between-row slot to reorder / move
 * to root. Clicking a favorite drops its workspace card on the canvas (it does NOT open a room).
 * Naming (new group/subgroup, rename) is done inline via `editing`, never a browser dialog.
 */
export function FavoritesTree({ fav, editing, setEditing }: {
  fav: FavoritesApi; editing: FavEditing | null; setEditing: (e: FavEditing | null) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; target: FavMenuTarget } | null>(null);
  // Mouse: 8px drag to start (taps/clicks still pass through). Touch: press-and-hold (~0.2s) to start a
  // drag so a quick finger swipe scrolls the tree natively instead of grabbing a favorite. Mirrors the
  // canvas sensors (SpaceCanvas); `tolerance` cancels the pending hold if the finger travels first.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );
  // True from drag-start until just after drag-end, so the synthetic click a drag emits on
  // pointer-up doesn't also "activate" the favorite (which would spawn a card on a mere reorder).
  const dragHappened = useRef(false);

  const isExpanded = (id: string) => !collapsed.has(id);
  const toggle = (id: string) =>
    setCollapsed(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const expand = (id: string) =>
    setCollapsed(prev => { if (!prev.has(id)) return prev; const n = new Set(prev); n.delete(id); return n; });

  const finishDrag = () => { setDragId(null); setTimeout(() => { dragHappened.current = false; }, 0); };

  const onDragEnd = (e: DragEndEvent) => {
    finishDrag();
    const over = e.over; if (!over) return;
    const activeId = String(e.active.id);
    const kind: "favorite" | "group" = activeId.startsWith("fg_") ? "group" : "favorite";
    const node = kind === "group"
      ? fav.groups.find(g => g.id === activeId)
      : fav.favorites.find(f => f.id === activeId);
    if (!node) return;
    const curBucket = kind === "group" ? (node as FavoriteGroup).parentId : (node as Favorite).groupId;
    const overId = String(over.id);
    if (overId.startsWith("into:")) {
      const g = overId.slice(5);
      const target = g === "root" ? null : g;
      if (kind === "group" && target === activeId) return;     // dropping a group on itself
      fav.move(kind, activeId, target, Number.MAX_SAFE_INTEGER);
    } else if (overId.startsWith("slot:")) {
      const [, slotKind, bucket, idxStr] = overId.split(":");
      const target = bucket === "root" ? null : bucket;
      const sameKind = (slotKind === "g" && kind === "group") || (slotKind === "f" && kind === "favorite");
      if (!sameKind) { fav.move(kind, activeId, target, Number.MAX_SAFE_INTEGER); return; }
      // Slot index counts the dragged row in the rendered order; once it's pulled out of the same
      // bucket, every slot below its old spot shifts up by one.
      let idx = Number(idxStr);
      if (curBucket === target && node.position < idx) idx -= 1;
      fav.move(kind, activeId, target, idx);
    }
  };

  const dragLabel = useMemo(() => {
    if (!dragId) return "";
    if (dragId.startsWith("fg_")) return fav.groups.find(g => g.id === dragId)?.name ?? "";
    const f = fav.favorites.find(x => x.id === dragId);
    return f ? (f.label ?? basename(f.folder)) : "";
  }, [dragId, fav.groups, fav.favorites]);

  const commitNewGroup = (parentId: string | null, name: string) => {
    const n = name.trim();
    if (n) fav.createGroup(n, parentId);
    setEditing(null);
  };

  const renderBucket = (parentGroupId: string | null, depth: number): ReactNode => {
    const gs = fav.childGroups(parentGroupId);
    const fs = fav.bucketFavorites(parentGroupId);
    const bk = parentGroupId ?? "root";
    const newGroupHere = editing?.kind === "new-group" && editing.parentId === parentGroupId;
    return (
      <>
        {newGroupHere && (
          <FavEditRow paddingLeft={4 + depth * INDENT} initial="" icon={<><span className="w-3" /><FolderLibraryIcon /></>}
            onCommit={(v) => commitNewGroup(parentGroupId, v)} onCancel={() => setEditing(null)} />
        )}
        {gs.map((g, i) => (
          <Fragment key={g.id}>
            {dragId && <Slot kind="g" bucket={bk} index={i} />}
            {editing?.kind === "rename-group" && editing.id === g.id ? (
              <FavEditRow paddingLeft={4 + depth * INDENT} initial={g.name} icon={<><span className="w-3" /><FolderLibraryIcon /></>}
                onCommit={(v) => { const n = v.trim(); if (n) fav.renameGroup(g.id, n); setEditing(null); }}
                onCancel={() => setEditing(null)} />
            ) : (
              <GroupRow g={g} depth={depth} expanded={isExpanded(g.id)} onToggle={() => toggle(g.id)}
                onMenu={(x, y) => setMenu({ x, y, target: { kind: "group", id: g.id, name: g.name } })} />
            )}
            {isExpanded(g.id) && renderBucket(g.id, depth + 1)}
          </Fragment>
        ))}
        {dragId && <Slot kind="g" bucket={bk} index={gs.length} />}
        {fs.map((f, i) => (
          <Fragment key={f.id}>
            {dragId && <Slot kind="f" bucket={bk} index={i} />}
            {editing?.kind === "rename-favorite" && editing.id === f.id ? (
              <FavEditRow paddingLeft={4 + depth * INDENT + 14} initial={f.label ?? basename(f.folder)} icon={<FolderIcon />}
                onCommit={(v) => { fav.renameFavorite(f.id, v.trim() || null); setEditing(null); }}
                onCancel={() => setEditing(null)} />
            ) : (
              <FavoriteRow f={f} depth={depth} onActivate={() => { if (!dragHappened.current) fav.activate(f); }}
                onMenu={(x, y) => setMenu({ x, y, target: { kind: "favorite", id: f.id, label: f.label ?? basename(f.folder) } })} />
            )}
          </Fragment>
        ))}
        {dragId && <Slot kind="f" bucket={bk} index={fs.length} />}
      </>
    );
  };

  const empty = fav.groups.length === 0 && fav.favorites.length === 0;

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin}
      onDragStart={(e: DragStartEvent) => { dragHappened.current = true; setDragId(String(e.active.id)); }}
      onDragEnd={onDragEnd} onDragCancel={finishDrag}>
      <div className="px-1 py-1">
        {empty && !editing
          ? <div className="px-2 py-6 text-center text-xs text-dim">No favorites yet. Browse below and add folders.</div>
          : renderBucket(null, 0)}
      </div>
      <DragOverlay>
        {dragId ? <div className="px-2 py-1 rounded bg-elevated text-sm text-fg shadow-lg">{dragLabel}</div> : null}
      </DragOverlay>
      {menu && (
        <FavoriteContextMenu x={menu.x} y={menu.y} target={menu.target} dismiss={() => setMenu(null)}
          onOpen={() => {
            if (menu.target.kind === "favorite") {
              const f = fav.favorites.find(x => x.id === menu.target.id);
              if (f) fav.activate(f);
            }
          }}
          onRename={() => setEditing(menu.target.kind === "favorite"
            ? { kind: "rename-favorite", id: menu.target.id }
            : { kind: "rename-group", id: menu.target.id })}
          onRemove={() => {
            if (menu.target.kind === "favorite") fav.removeFavorite(menu.target.id);
            else fav.deleteGroup(menu.target.id);   // confirm step lives in the menu, no browser dialog
          }}
          onNewSubgroup={() => {
            if (menu.target.kind !== "group") return;
            expand(menu.target.id);
            setEditing({ kind: "new-group", parentId: menu.target.id });
          }} />
      )}
    </DndContext>
  );
}

/** Inline name input — Enter/blur commits, Esc cancels. Replaces every browser prompt() here. */
function FavEditRow({ paddingLeft, initial, icon, onCommit, onCancel }: {
  paddingLeft: number; initial: string; icon: ReactNode; onCommit: (v: string) => void; onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const finish = (commit: boolean) => { if (done.current) return; done.current = true; commit ? onCommit(v) : onCancel(); };
  return (
    <div style={{ paddingLeft }} className="flex items-center gap-1 h-6 pr-2">
      {icon}
      <input ref={ref} value={v} spellCheck={false}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") finish(true); else if (e.key === "Escape") finish(false); e.stopPropagation(); }}
        onBlur={() => finish(true)}
        className="flex-1 min-w-0 bg-panel border border-blue-500 rounded px-1 py-0 text-sm text-bright outline-none" />
    </div>
  );
}

/** A thin between-row drop target. Rendered only while dragging; highlights when hovered. */
function Slot({ kind, bucket, index }: { kind: "g" | "f"; bucket: string; index: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot:${kind}:${bucket}:${index}` });
  return <div ref={setNodeRef} className={`h-1.5 mx-1 rounded ${isOver ? "bg-blue-500" : "bg-transparent"}`} />;
}

function GroupRow({ g, depth, expanded, onToggle, onMenu }: {
  g: FavoriteGroup; depth: number; expanded: boolean; onToggle: () => void; onMenu: (x: number, y: number) => void;
}) {
  const drag = useDraggable({ id: g.id });
  const drop = useDroppable({ id: `into:${g.id}` });
  const setRef = (el: HTMLDivElement | null) => { drag.setNodeRef(el); drop.setNodeRef(el); };
  return (
    <div ref={setRef} {...drag.attributes} {...drag.listeners}
      onClick={onToggle}
      onContextMenu={(e) => { e.preventDefault(); onMenu(e.clientX, e.clientY); }}
      style={{ paddingLeft: 4 + depth * INDENT, opacity: drag.isDragging ? 0.4 : 1 }}
      className={`flex items-center gap-1 h-6 pr-2 rounded cursor-pointer text-sm text-fg
        ${drop.isOver ? "bg-blue-600/30 ring-1 ring-blue-500/60" : "hover:bg-elevated"}`}>
      <Chevron open={expanded} />
      <FolderLibraryIcon />
      <span className="truncate">{g.name}</span>
    </div>
  );
}

function FavoriteRow({ f, depth, onActivate, onMenu }: {
  f: Favorite; depth: number; onActivate: () => void; onMenu: (x: number, y: number) => void;
}) {
  const drag = useDraggable({ id: f.id });
  return (
    <div ref={drag.setNodeRef} {...drag.attributes} {...drag.listeners}
      onClick={onActivate}
      onContextMenu={(e) => { e.preventDefault(); onMenu(e.clientX, e.clientY); }}
      title={`${f.label ?? basename(f.folder)}\n${f.folder}`}
      style={{ paddingLeft: 4 + depth * INDENT + 14, opacity: drag.isDragging ? 0.4 : 1 }}
      className="flex items-center gap-1.5 h-6 pr-2 rounded cursor-pointer hover:bg-elevated text-sm">
      <FolderIcon />
      <span className="truncate text-fg">{f.label ?? basename(f.folder)}</span>
      <span className="truncate text-[11px] text-dim ml-1">{f.folder}</span>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"
      className={`text-dim transition-transform ${open ? "rotate-90" : ""}`}>
      <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
export function FolderLibraryIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" className="text-amber-300/80">
      <path d="M2 5.2a1 1 0 0 1 1-1h2.2l1 1.2H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" strokeLinejoin="round" />
      <path d="M4 4.2V3.4a1 1 0 0 1 1-1h2l1 1.2h3" strokeLinejoin="round" />
    </svg>
  );
}
function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" className="text-muted">
      <path d="M2 4.5a1 1 0 0 1 1-1h2.5l1 1.2H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" strokeLinejoin="round" />
    </svg>
  );
}
