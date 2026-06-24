import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  DndContext, MouseSensor, TouchSensor, closestCorners, useDroppable, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { Link, LinkFolder } from "../../api/types";
import { useLinks, normalizeUrl, hostOf } from "../../hooks/useLinks";
import { ColorPicker } from "../TerminalContextMenu";
import { LinkForm, type LinkDraft } from "./LinkForm";
import { LinkRow } from "./LinkRow";
import {
  ArrowDown, ArrowUp, Chevron, FolderIcon, FolderPlusIcon, GlobeIcon, IconBtn, OpenAllIcon,
  PencilIcon, PlusIcon, SearchIcon, TrashIcon, XIcon,
} from "./icons";

const COLLAPSE_KEY = "tr.linksCollapsed"; // remembered expanded/collapsed folders (per-browser, like bookmark managers)

const openLink = (url: string) => { const u = normalizeUrl(url); if (u) window.open(u, "_blank", "noopener,noreferrer"); };
const sortLinks = (a: Link, b: Link) => a.sort - b.sort || a.createdAt - b.createdAt;

/** Folders the user has collapsed, restored from localStorage. A folder NOT in the set is expanded,
 *  so newly created folders appear open by default (standard for tree/bookmark UIs). */
function loadCollapsed(): Set<string> {
  try { const raw = localStorage.getItem(COLLAPSE_KEY); if (raw) return new Set(JSON.parse(raw) as string[]); } catch { /* ignore corrupt/blocked storage */ }
  return new Set();
}

type FormState = { link?: Link; defaultFolderId?: string | null } | null;

/**
 * The top-bar "Links" dropdown: the user's important websites, grouped into folders, searchable, and
 * opened in a new browser tab on click. Self-contained (own open state + click-away, like the
 * notification bell). Persisted server-side via useLinks, so the list survives restarts and follows
 * the user across browsers / over the tunnel. Links drag to reorder and drop into folders (dnd-kit,
 * mirroring the Board); a folder's expanded/collapsed state is remembered per-browser.
 */
export function LinksMenu() {
  const { links, folders, addLink, saveLink, removeLink, reorderLinks, addFolder, saveFolder, removeFolder, reorderFolders } = useLinks();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<FormState>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [colorPop, setColorPop] = useState<{ kind: "folder" | "link"; id: string; x: number; y: number } | null>(null); // right-click → text color
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Mouse: 8px drag to start (taps/clicks still pass through). Touch: press-and-hold (~0.2s) to start
  // a drag so a quick finger swipe scrolls the menu natively instead of grabbing a link/folder. Mirrors
  // the canvas sensors (SpaceCanvas); `tolerance` cancels the pending hold if the finger travels first.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  // Persist expand/collapse so the tree looks the same next open (and across the tunnel — per browser).
  useEffect(() => { try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed])); } catch { /* blocked */ } }, [collapsed]);
  // Closing the dropdown dismisses any open color picker with it.
  useEffect(() => { if (!open) setColorPop(null); }, [open]);

  // Click-away + Escape dismiss (matches NotificationCenter). The rAF defers wiring the listener so the
  // opening click itself doesn't immediately close the panel.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { if (colorPop) setColorPop(null); else if (form) setForm(null); else setOpen(false); } };
    const raf = requestAnimationFrame(() => window.addEventListener("pointerdown", onDown));
    window.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("pointerdown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open, form, colorPop]);

  const ql = query.trim().toLowerCase();
  const matches = (l: Link) => !ql || l.title.toLowerCase().includes(ql) || l.url.toLowerCase().includes(ql) || l.description.toLowerCase().includes(ql);
  const searchResults = useMemo(() => (ql ? links.filter(matches).sort(sortLinks) : []), [links, ql]);
  const groupOf = (fid: string | null) => links.filter((l) => (l.folderId ?? null) === fid).sort(sortLinks);
  const ungrouped = useMemo(() => groupOf(null), [links]);
  const folderName = (fid: string | null) => folders.find((f) => f.id === fid)?.name || "";

  const submitForm = (draft: LinkDraft) => {
    const title = draft.title || hostOf(draft.url);
    if (form?.link) saveLink(form.link.id, { ...draft, title });
    else addLink({ ...draft, title });
    setForm(null);
  };

  // Reorder a link within its own group by swapping with a neighbor, then renumber the whole group.
  const moveLink = (group: Link[], id: string, dir: -1 | 1) => {
    const arr = [...group];
    const i = arr.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    reorderLinks(arr.map((l, idx) => ({ id: l.id, folderId: l.folderId, sort: idx })));
  };
  const moveFolder = (id: string, dir: -1 | 1) => {
    const arr = [...folders];
    const i = arr.findIndex((f) => f.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    reorderFolders(arr.map((f, idx) => ({ id: f.id, sort: idx })));
  };

  // Drag a link onto a folder (or the "No folder" zone) to re-home it, or onto another link to slot
  // before it. One reorderLinks call writes the target group's new folderId + positions.
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over) return;
    const dragged = links.find((l) => l.id === active.id);
    if (!dragged) return;
    const data = over.data.current as { type?: string; folderId?: string | null; linkId?: string } | undefined;
    if (!data) return;
    const targetFolderId = data.folderId ?? null;
    const beforeId = data.type === "link" ? data.linkId ?? null : null;
    if (beforeId === dragged.id) return; // dropped on itself
    const others = groupOf(targetFolderId).filter((l) => l.id !== dragged.id);
    let index = others.length;
    if (beforeId) { const i = others.findIndex((l) => l.id === beforeId); if (i >= 0) index = i; }
    const curIndex = groupOf(dragged.folderId ?? null).findIndex((l) => l.id === dragged.id);
    if (targetFolderId === (dragged.folderId ?? null) && index === curIndex) return; // no-op
    const next = [...others];
    next.splice(index, 0, dragged);
    reorderLinks(next.map((l, idx) => ({ id: l.id, folderId: targetFolderId, sort: idx })));
  };

  const toggleCollapse = (id: string) => setCollapsed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const startRename = (f: LinkFolder) => { setRenamingId(f.id); setRenameValue(f.name); };
  const commitRename = () => { if (renamingId) saveFolder(renamingId, { name: renameValue.trim() }); setRenamingId(null); };
  const commitNewFolder = () => {
    const name = newFolderName.trim();
    if (name) addFolder(name);
    setNewFolderName(""); setAddingFolder(false);
  };
  const openAndClose = (url: string) => { openLink(url); setOpen(false); };
  const openAll = (items: Link[]) => { items.forEach((l) => openLink(l.url)); setOpen(false); };

  const empty = links.length === 0 && folders.length === 0;

  // Build a draggable link row wired to all the parent handlers (used in both folders + ungrouped).
  const renderLink = (l: Link, i: number, arr: Link[], indent?: boolean) => (
    <LinkRow key={l.id} link={l} indent={indent}
      onOpen={() => openAndClose(l.url)}
      onEdit={() => setForm({ link: l })} onDelete={() => removeLink(l.id)}
      onColorMenu={(x, y) => setColorPop({ kind: "link", id: l.id, x, y })}
      onUp={i > 0 ? () => moveLink(arr, l.id, -1) : undefined}
      onDown={i < arr.length - 1 ? () => moveLink(arr, l.id, 1) : undefined} />
  );

  return (
    <div className="relative">
      <button ref={btnRef} onClick={() => setOpen((o) => !o)} title="Links — your important websites"
        className={`relative flex h-8 w-8 items-center justify-center rounded ${open ? "bg-edge text-bright" : "bg-elevated hover:bg-edge text-fg hover:text-bright"}`}>
        <GlobeIcon />
      </button>

      {open && (
        <div ref={panelRef}
          className="absolute right-0 top-full z-50 mt-2 flex max-h-[78vh] w-[400px] max-w-[calc(100vw-1rem)] flex-col rounded-xl border border-edge bg-panel/95 shadow-2xl backdrop-blur">
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge px-3 py-2">
            <div className="text-sm font-semibold text-bright">{form ? (form.link ? "Edit link" : "Add link") : "Links"}</div>
            {!form && (
              <div className="flex items-center gap-1">
                <button onClick={() => { setAddingFolder(true); setNewFolderName(""); }} title="New folder"
                  className="grid h-7 w-7 place-items-center rounded text-dim hover:bg-elevated hover:text-fg"><FolderPlusIcon /></button>
                <button onClick={() => setForm({ defaultFolderId: null })}
                  className="flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-blue-500">
                  <PlusIcon /> Add
                </button>
              </div>
            )}
          </div>

          {form ? (
            <LinkForm initial={form.link} folders={folders} defaultFolderId={form.defaultFolderId}
              onSave={submitForm} onCancel={() => setForm(null)} />
          ) : (
            <>
              {/* Search */}
              <div className="shrink-0 border-b border-edge px-3 py-2">
                <div className="flex items-center gap-2 rounded-md border border-edge bg-canvas px-2 py-1.5">
                  <SearchIcon />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search links…"
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-dim" />
                  {query && <button onClick={() => setQuery("")} className="text-dim hover:text-fg" title="Clear"><XIcon /></button>}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto py-1">
                {/* Inline new-folder input */}
                {addingFolder && (
                  <div className="px-3 py-1.5">
                    <input autoFocus value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") commitNewFolder(); if (e.key === "Escape") { setAddingFolder(false); setNewFolderName(""); } }}
                      onBlur={commitNewFolder} placeholder="Folder name"
                      className="w-full rounded-md border border-edge-strong bg-canvas px-2 py-1.5 text-[13px] text-fg outline-none placeholder:text-dim" />
                  </div>
                )}

                {empty && !addingFolder && (
                  <div className="px-4 py-10 text-center text-xs text-dim">No links yet. Click <span className="text-fg">Add</span> to save an important website.</div>
                )}

                {/* One DndContext for the whole list. No DragOverlay — the dragged row transforms in
                    place (a fixed overlay would be offset by the panel's backdrop-blur containing block),
                    mirroring TerminalList. Search rows are dragDisabled (cross-folder order is meaningless). */}
                <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
                  {ql ? (
                    searchResults.length === 0
                      ? <div className="px-4 py-10 text-center text-xs text-dim">No links match “{query}”.</div>
                      : searchResults.map((l) => (
                          <LinkRow key={l.id} link={l} tag={folderName(l.folderId)} dragDisabled
                            onOpen={() => openAndClose(l.url)}
                            onEdit={() => setForm({ link: l })} onDelete={() => removeLink(l.id)}
                            onColorMenu={(x, y) => setColorPop({ kind: "link", id: l.id, x, y })} />
                        ))
                  ) : (
                    <>
                      {/* Folders */}
                      {folders.map((f, fi) => {
                        const items = groupOf(f.id);
                        return (
                          <FolderSection key={f.id} folder={f} items={items}
                            isCollapsed={collapsed.has(f.id)} isFirst={fi === 0} isLast={fi === folders.length - 1}
                            renaming={renamingId === f.id} renameValue={renameValue}
                            onToggle={() => toggleCollapse(f.id)} onStartRename={() => startRename(f)}
                            onRenameChange={setRenameValue} onCommitRename={commitRename} onCancelRename={() => setRenamingId(null)}
                            onMoveUp={() => moveFolder(f.id, -1)} onMoveDown={() => moveFolder(f.id, 1)}
                            onDelete={() => removeFolder(f.id)} onOpenAll={() => openAll(items)}
                            onColorMenu={(x, y) => setColorPop({ kind: "folder", id: f.id, x, y })}
                            renderLink={(l, i, arr) => renderLink(l, i, arr, true)} />
                        );
                      })}

                      {/* Ungrouped — always a drop target when folders exist, so a link can be dragged out. */}
                      {(ungrouped.length > 0 || folders.length > 0) && (
                        <UngroupedZone>
                          {folders.length > 0 && <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-dim">No folder</div>}
                          {ungrouped.length > 0
                            ? ungrouped.map((l, i) => renderLink(l, i, ungrouped))
                            : folders.length > 0 && <div className="px-3 py-1 text-[11px] text-dim">Drag a link here to remove it from its folder.</div>}
                        </UngroupedZone>
                      )}
                    </>
                  )}
                </DndContext>
              </div>
            </>
          )}
        </div>
      )}

      {/* Text-color picker (right-click a folder name or a link). Portaled + reusing the terminal
          ColorPicker so it floats above the panel's backdrop-blur instead of being clipped by it. */}
      {colorPop && (
        <ColorPopover x={colorPop.x} y={colorPop.y} onClose={() => setColorPop(null)}
          current={colorPop.kind === "folder"
            ? folders.find((f) => f.id === colorPop.id)?.color ?? null
            : links.find((l) => l.id === colorPop.id)?.color ?? null}
          onPick={(c) => { if (colorPop.kind === "folder") saveFolder(colorPop.id, { color: c }); else saveLink(colorPop.id, { color: c }); }} />
      )}
    </div>
  );
}

/** Portaled, cursor-anchored color popover wrapping the shared ColorPicker. Stops its own pointerdown
 *  so the Links panel's click-away leaves the panel open while you pick; closes on outside click. */
function ColorPopover({ x, y, current, onPick, onClose }: {
  x: number; y: number; current: string | null; onPick: (c: string | null) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const raf = requestAnimationFrame(() => window.addEventListener("pointerdown", onDown));
    return () => { cancelAnimationFrame(raf); window.removeEventListener("pointerdown", onDown); };
  }, [onClose]);
  const left = Math.max(8, Math.min(x, window.innerWidth - 192));
  const top = Math.max(8, Math.min(y, window.innerHeight - 176));
  return createPortal(
    <div ref={ref} onPointerDown={(e) => e.stopPropagation()} style={{ position: "fixed", left, top, zIndex: 80 }}>
      <ColorPicker current={current} onPick={onPick} />
    </div>,
    document.body,
  );
}

/** A folder: a droppable group (drop a link to re-home it) with a collapsible body. The header has a
 *  chevron, inline rename, a link count, and hover actions (open-all / move / rename / delete). The
 *  folder name takes a custom color and opens the color picker on right-click. */
function FolderSection({
  folder, items, isCollapsed, isFirst, isLast, renaming, renameValue,
  onToggle, onStartRename, onRenameChange, onCommitRename, onCancelRename,
  onMoveUp, onMoveDown, onDelete, onOpenAll, onColorMenu, renderLink,
}: {
  folder: LinkFolder; items: Link[];
  isCollapsed: boolean; isFirst: boolean; isLast: boolean; renaming: boolean; renameValue: string;
  onToggle: () => void; onStartRename: () => void; onRenameChange: (v: string) => void;
  onCommitRename: () => void; onCancelRename: () => void;
  onMoveUp: () => void; onMoveDown: () => void; onDelete: () => void; onOpenAll: () => void;
  onColorMenu: (x: number, y: number) => void;
  renderLink: (l: Link, i: number, arr: Link[]) => ReactNode;
}) {
  const drop = useDroppable({ id: `folder:${folder.id}`, data: { type: "folder", folderId: folder.id } });
  return (
    <div ref={drop.setNodeRef} className={`group/folder rounded ${drop.isOver ? "bg-blue-500/10 ring-1 ring-inset ring-blue-500/40" : ""}`}>
      <div className="flex items-center gap-1 px-2 py-1.5 text-dim">
        <button onClick={onToggle} className="grid h-5 w-5 shrink-0 place-items-center hover:text-fg" title={isCollapsed ? "Expand" : "Collapse"}>
          <Chevron open={!isCollapsed} />
        </button>
        {/* The folder glyph tracks the folder's custom text color too (falls back to the row's text-dim). */}
        <span className="shrink-0" style={folder.color ? { color: folder.color } : undefined}><FolderIcon /></span>
        {renaming ? (
          <input autoFocus value={renameValue} onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onCommitRename(); if (e.key === "Escape") onCancelRename(); }}
            onBlur={onCommitRename}
            className="min-w-0 flex-1 rounded border border-edge-strong bg-canvas px-1.5 py-0.5 text-[13px] text-fg outline-none" />
        ) : (
          <button onDoubleClick={onStartRename} onClick={onToggle}
            onContextMenu={(e) => { e.preventDefault(); onColorMenu(e.clientX, e.clientY); }}
            style={folder.color ? { color: folder.color } : undefined}
            className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-fg hover:text-bright" title="Double-click to rename · right-click to recolor">
            {folder.name || "Untitled folder"}
          </button>
        )}
        <span className="shrink-0 text-[11px] tabular-nums text-dim">{items.length}</span>
        <span className="flex shrink-0 items-center opacity-0 transition group-hover/folder:opacity-100">
          <IconBtn title="Open all in new tabs" disabled={items.length === 0} onClick={onOpenAll}><OpenAllIcon /></IconBtn>
          <IconBtn title="Move up" disabled={isFirst} onClick={onMoveUp}><ArrowUp /></IconBtn>
          <IconBtn title="Move down" disabled={isLast} onClick={onMoveDown}><ArrowDown /></IconBtn>
          <IconBtn title="Rename" onClick={onStartRename}><PencilIcon /></IconBtn>
          <IconBtn title="Delete folder (keeps its links)" danger onClick={onDelete}><TrashIcon /></IconBtn>
        </span>
      </div>
      {!isCollapsed && (
        <div className="pb-1">
          {items.length === 0
            ? <div className="px-9 py-1 text-[11px] text-dim">Empty — drag a link here.</div>
            : items.map((l, i) => renderLink(l, i, items))}
        </div>
      )}
    </div>
  );
}

/** The "No folder" group — a droppable zone so a link can be dragged out of every folder. */
function UngroupedZone({ children }: { children: ReactNode }) {
  const drop = useDroppable({ id: "ungrouped", data: { type: "folder", folderId: null } });
  return <div ref={drop.setNodeRef} className={`rounded ${drop.isOver ? "bg-blue-500/10 ring-1 ring-inset ring-blue-500/40" : ""}`}>{children}</div>;
}
