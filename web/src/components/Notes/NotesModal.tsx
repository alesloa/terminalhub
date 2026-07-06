import { copyText } from "../../lib/clipboard";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState, type CSSProperties, type ReactNode, type TransitionEventHandler } from "react";
import type { Note } from "../../api/types";
import type { WinRect } from "../../store/ui";
import { spacesBarBottom } from "../../store/ui";
import { useDraggableWindow, type WindowHandle } from "../../hooks/useDraggableWindow";
import { ResizeHandles } from "../ResizeHandles";
import { DictationButton } from "../DictationButton";
import { useNotes } from "./useNotes";
import { NoteEditor, noteToMarkdown, type NoteViewMode } from "./NoteEditor";
import { NoteGroupsRail, ALL, UNGROUPED, type NotesFilter } from "./NoteGroupsRail";
import { NoteContextMenu, type NoteMenuState } from "./NoteContextMenu";

const RECT_KEY = "tr.notesRect";   // remembered window geometry (per-browser)
const PREF_KEY = "tr.notesPrefs";  // remembered filter / sort / view
const MIN_W = 720, MIN_H = 380;    // rail (176) + list (256) + a usable editor
const DURATION = 300;              // ms — grow-from-icon / minimize-to-icon animation

type SortMode = "recent" | "title" | "created";

/** Display title for a note: its title, else the first non-empty line, else a placeholder. */
function noteTitle(n: Note): string {
  if (n.title.trim()) return n.title.trim();
  const first = n.content.split("\n").find((l) => l.trim());
  return first?.trim() || "Untitled note";
}

function preview(n: Note): string {
  const body = n.content.replace(/\s+/g, " ").trim();
  return body || "No content";
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

/** Wrap case-insensitive matches of `q` in `text` with a highlight mark (for the search results). */
function Highlight({ text, q }: { text: string; q: string }): ReactNode {
  if (!q) return text;
  const lower = text.toLowerCase(), ql = q.toLowerCase();
  const parts: ReactNode[] = [];
  let i = 0;
  for (;;) {
    const idx = lower.indexOf(ql, i);
    if (idx === -1) { parts.push(text.slice(i)); break; }
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(<mark key={idx} className="bg-accent/30 text-bright rounded-sm">{text.slice(idx, idx + q.length)}</mark>);
    i = idx + q.length;
  }
  return parts;
}

/** A moderate notepad-sized box, centered and clamped below the spaces bar. */
function defaultRect(): WinRect {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(1000, Math.round(vw * 0.74));
  const h = Math.min(640, Math.round(vh * 0.74));
  const top = spacesBarBottom() + 8;
  return { w, h, x: Math.max(8, Math.round((vw - w) / 2)), y: Math.max(top, Math.round((vh - h) / 2)) };
}

/** Restore the saved geometry, clamped back into the current viewport (it may have shrunk). */
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

function loadPrefs(): { filter: NotesFilter; sort: SortMode; view: NoteViewMode } {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}");
    // Migrate the old write/preview names → source/rich; default to the rich formatted editor.
    const view: NoteViewMode = p.view === "source" || p.view === "write" ? "source" : "rich";
    return { filter: p.filter ?? ALL, sort: p.sort ?? "recent", view };
  } catch { return { filter: ALL, sort: "recent", view: "rich" }; }
}

/**
 * The Notes scratchpad: a free-floating, draggable, resizable window (NOT a modal — it never dims the
 * canvas) laid out like macOS Notes — a group rail, a searchable/sortable note list, and the editor.
 * Notes file into groups (drag a row onto a rail group, right-click → Move to, or the editor's Move-to
 * selector). tmux-style durability doesn't apply here; edits autosave over REST. Opening grows the
 * window out of the Notes icon (`origin`); Close minimizes it back into the icon before unmounting.
 */
export const NotesModal = forwardRef<WindowHandle, { origin?: WinRect | null; onClose: () => void }>(function NotesModal({ origin, onClose }, ref) {
  const { notes, groups, isLoading, create, save, move, remove, createGroup, renameGroup, recolorGroup, removeGroup } = useNotes();
  const prefs0 = useMemo(loadPrefs, []);
  const [filter, setFilter] = useState<NotesFilter>(prefs0.filter);
  const [sort, setSort] = useState<SortMode>(prefs0.sort);
  const [view, setView] = useState<NoteViewMode>(prefs0.view);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);
  const [menu, setMenu] = useState<NoteMenuState | null>(null);
  const [flash, setFlash] = useState("");

  const [seed] = useState(loadRect);
  const { rect, beginDrag, beginResize } = useDraggableWindow(seed, MIN_W, MIN_H, undefined, undefined, "notes");

  // Grow-from-icon on open, minimize-to-icon on close — same trick as the room↔card animation.
  const reduce = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [expanded, setExpanded] = useState(reduce);
  useEffect(() => {
    if (reduce) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setExpanded(true)));
    return () => cancelAnimationFrame(id);
  }, [reduce]);
  const handleClose = () => { if (reduce) { onClose(); return; } setExpanded(false); };
  useImperativeHandle(ref, () => ({ close: handleClose }));
  const onTransitionEnd: TransitionEventHandler = (e) => {
    if (e.target === e.currentTarget && e.propertyName === "transform" && !expanded) onClose();
  };

  // Persist geometry + prefs, debounced so a drag/resize doesn't hammer localStorage every frame.
  useEffect(() => {
    const t = window.setTimeout(() => { try { localStorage.setItem(RECT_KEY, JSON.stringify(rect)); } catch { /* blocked */ } }, 300);
    return () => window.clearTimeout(t);
  }, [rect]);
  useEffect(() => { try { localStorage.setItem(PREF_KEY, JSON.stringify({ filter, sort, view })); } catch { /* blocked */ } }, [filter, sort, view]);

  // The active note's textarea inserter, registered by the mounted NoteEditor — the title-bar mic
  // drops transcribed speech here. Stored via the updater form so a function isn't treated as one.
  const [insert, setInsert] = useState<((text: string) => void) | null>(null);
  const registerInsert = useCallback((fn: ((text: string) => void) | null) => setInsert(() => fn), []);

  const flashMsg = (m: string) => { setFlash(m); window.setTimeout(() => setFlash(""), 1400); };

  // The list the middle pane shows. A search spans EVERY note (any group) so you can find anything;
  // with no query it's just the selected collection. Either way, in the chosen sort order.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = notes;
    if (q) {
      list = list.filter((n) => noteTitle(n).toLowerCase().includes(q) || n.content.toLowerCase().includes(q));
    } else if (filter === UNGROUPED) {
      list = list.filter((n) => !n.groupId);
    } else if (filter !== ALL) {
      list = list.filter((n) => n.groupId === filter);
    }
    const out = [...list];
    if (sort === "title") out.sort((a, b) => noteTitle(a).localeCompare(noteTitle(b)));
    else if (sort === "created") out.sort((a, b) => b.createdAt - a.createdAt);
    else out.sort((a, b) => b.updatedAt - a.updatedAt);
    return out;
  }, [notes, filter, query, sort]);

  // Keep a valid selection within the visible list as the filter/search changes.
  useEffect(() => {
    if (selectedId && visible.some((n) => n.id === selectedId)) return;
    setSelectedId(visible[0]?.id ?? null);
  }, [visible, selectedId]);

  const selected = notes.find((n) => n.id === selectedId) ?? null;
  const groupName = (id: string | null) => (id ? groups.find((g) => g.id === id)?.name || "Untitled group" : null);
  const groupColor = (id: string | null) => (id ? groups.find((g) => g.id === id)?.color ?? null : null);

  const newNote = async () => {
    const groupId = filter !== ALL && filter !== UNGROUPED ? filter : null;
    const n = await create({ groupId });
    setSelectedId(n.id);
  };
  const del = async (n: Note) => {
    if (!confirm(`Delete "${noteTitle(n)}"?`)) return;
    await remove(n.id);
    if (selectedId === n.id) setSelectedId(null);
  };
  const copyNote = async (n: Note) => {
    try { await copyText(noteToMarkdown(n)); flashMsg("Copied as Markdown"); }
    catch { flashMsg("Couldn't copy"); }
  };
  const duplicate = async (n: Note) => {
    const dup = await create({ title: n.title ? `${n.title} copy` : "", content: n.content, groupId: n.groupId });
    setSelectedId(dup.id);
  };

  const collapsed = origin
    ? `translate(${origin.x - rect.x}px, ${origin.y - rect.y}px) scale(${origin.w / rect.w}, ${origin.h / rect.h})`
    : "scale(0.94)";
  const style: CSSProperties = {
    left: rect.x, top: rect.y, width: rect.w, height: rect.h,
    ...(reduce ? {} : {
      transformOrigin: origin ? "0 0" : "50% 50%",
      transform: expanded ? "translate(0px, 0px) scale(1, 1)" : collapsed,
      opacity: expanded ? 1 : 0,
      transition: `transform ${DURATION}ms cubic-bezier(.22,.61,.36,1), opacity ${DURATION}ms ease`,
      willChange: "transform, opacity",
    }),
  };

  const headTitle = filter === ALL ? "All Notes" : filter === UNGROUPED ? "Ungrouped" : groupName(filter) ?? "Notes";

  return (
    <div onTransitionEnd={onTransitionEnd} style={style}
      className="fixed z-50 flex flex-col rounded-lg overflow-hidden border border-edge-strong bg-canvas shadow-2xl">
      {/* Title bar = drag handle. The control cluster swallows pointer-down so clicking it never drags. */}
      <div onPointerDown={beginDrag}
        className="h-8 shrink-0 flex items-center justify-between px-4 border-b border-edge cursor-move select-none">
        <div className="font-semibold">Notes</div>
        <div className="flex items-center gap-2" onPointerDown={(e) => e.stopPropagation()}>
          <DictationButton onText={(t) => insert?.(t)} enabled={!!insert} disabledTitle="Select a note to dictate into" />
          <button onClick={handleClose} title="Close" className="px-3 h-6 inline-flex items-center bg-elevated rounded text-sm">Close</button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        <NoteGroupsRail
          groups={groups} notes={notes} filter={filter} onFilter={setFilter} draggingNoteId={draggingNoteId}
          onCreateGroup={createGroup} onRenameGroup={renameGroup} onRecolorGroup={recolorGroup} onRemoveGroup={removeGroup}
          onDropNote={(groupId, noteId) => { move(noteId, groupId); flashMsg(groupId ? `Moved to ${groupName(groupId)}` : "Moved to Ungrouped"); }} />

        {/* Middle: list header (compose + count + collapsible search + sort) then the rows. */}
        <div className="w-64 shrink-0 border-r border-edge flex flex-col">
          <div className="h-9 shrink-0 flex items-center gap-1.5 px-2 border-b border-edge">
            {searchOpen ? (
              <>
                <SearchIcon />
                <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape") { setQuery(""); setSearchOpen(false); } }}
                  placeholder="Search all notes…" className="flex-1 min-w-0 bg-transparent outline-none text-sm placeholder:text-dim" />
                <button onClick={() => { setQuery(""); setSearchOpen(false); }} title="Close search"
                  className="shrink-0 w-6 h-6 inline-flex items-center justify-center rounded text-dim hover:bg-surface hover:text-fg">✕</button>
              </>
            ) : (
              <>
                <button onClick={newNote} title="New note"
                  className="shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded bg-accent text-accent-fg text-xs font-medium hover:bg-accent-hover">
                  <span className="text-sm leading-none">＋</span> New
                </button>
                <span className="flex-1 min-w-0 truncate text-xs text-dim px-1">{visible.length} {visible.length === 1 ? "note" : "notes"}</span>
                <button onClick={() => setSearchOpen(true)} title="Search notes"
                  className="shrink-0 w-6 h-6 inline-flex items-center justify-center rounded text-muted hover:bg-surface hover:text-bright"><SearchIcon /></button>
                <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)} title="Sort notes"
                  className="shrink-0 bg-transparent text-xs text-muted outline-none cursor-pointer hover:text-fg">
                  <option value="recent">Recent</option>
                  <option value="title">Title A–Z</option>
                  <option value="created">Created</option>
                </select>
              </>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-auto">
            {isLoading && <div className="p-4 text-dim text-sm">loading…</div>}
            {!isLoading && visible.length === 0 && (
              <div className="p-4 text-dim text-sm">
                {query ? "No notes match your search." : <>No notes here. Hit <button onClick={newNote} className="text-fg underline">New</button>.</>}
              </div>
            )}
            {visible.map((n) => {
              // Show which group a row belongs to whenever the list spans groups (All view or a search).
              const showGroup = filter === ALL || !!query.trim();
              const dotColor = showGroup ? groupColor(n.groupId) : null;
              const gName = showGroup ? groupName(n.groupId) : null;
              return (
                <button key={n.id} draggable
                  onDragStart={(e) => { e.dataTransfer.setData("text/note-id", n.id); e.dataTransfer.effectAllowed = "move"; setDraggingNoteId(n.id); }}
                  onDragEnd={() => setDraggingNoteId(null)}
                  onClick={() => setSelectedId(n.id)}
                  onContextMenu={(e) => { e.preventDefault(); setSelectedId(n.id); setMenu({ note: n, x: e.clientX, y: e.clientY }); }}
                  className={`group w-full text-left px-3 py-2 border-b border-surface ${n.id === selectedId ? "bg-elevated" : "hover:bg-panel"}`}>
                  <div className="flex items-center gap-2">
                    <span className="flex-1 min-w-0 truncate text-sm"><Highlight text={noteTitle(n)} q={query} /></span>
                    <span role="button" tabIndex={0} title="Delete note"
                      onClick={(e) => { e.stopPropagation(); del(n); }}
                      className="shrink-0 opacity-0 group-hover:opacity-100 text-dim hover:text-error leading-none px-1">✕</span>
                  </div>
                  <div className="truncate text-xs text-dim"><Highlight text={preview(n)} q={query} /></div>
                  <div className="flex items-center gap-1.5 text-[10px] text-dim">
                    <span>{timeAgo(n.updatedAt)}</span>
                    {gName && (
                      <span className="inline-flex items-center gap-1 truncate">
                        <span>·</span>
                        <span className="w-1.5 h-1.5 rounded-full border border-edge-strong" style={{ background: dotColor ?? "transparent" }} />
                        <span className="truncate">{gName}</span>
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {selected
          ? <NoteEditor key={selected.id} note={selected} groups={groups} mode={view} onMode={setView}
              onSave={save} onMove={(id, g) => { move(id, g); }} onCopy={copyNote} onRegisterInsert={registerInsert} />
          : (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-dim text-sm">
              <div>{notes.length ? `Select a note in ${headTitle}.` : "No notes yet."}</div>
              <button onClick={newNote} className="px-3 h-7 inline-flex items-center rounded bg-accent text-accent-fg text-xs font-medium hover:bg-accent-hover">＋ New note</button>
            </div>
          )}
      </div>

      {menu && (
        <NoteContextMenu state={menu} groups={groups}
          onMove={(n, g) => move(n.id, g)} onCopy={copyNote} onDuplicate={duplicate} onDelete={del} onClose={() => setMenu(null)} />
      )}

      {flash && (
        <div className="absolute left-1/2 bottom-4 -translate-x-1/2 px-3 py-1.5 rounded-md bg-elevated border border-edge-strong text-xs text-bright shadow-lg pointer-events-none">{flash}</div>
      )}

      <ResizeHandles onStart={beginResize} />
    </div>
  );
});

function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" className="shrink-0 w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="7" cy="7" r="4.2" /><path d="M10.2 10.2 13.5 13.5" strokeLinecap="round" />
    </svg>
  );
}
