import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { FsEntry } from "../../api/types";
import { getFolderIconUrl } from "../../lib/materialIcons";
import { dirname } from "../../lib/paths";
import { Item } from "../TerminalContextMenu";
import { FolderLibraryIcon } from "./FavoritesTree";
import { flattenGroups, type FavoritesApi, type GroupOption } from "./useFavorites";

type Menu = { x: number; y: number; path: string };

/**
 * Filesystem browser for adding favorites — a real folder tree (expand inline, same Material
 * folder icons as the room Explorer). Right-click a folder to add it to favorites; new favorites
 * land at the root of the tree above, drag them into groups from there. The header buttons reroot
 * the tree (up a level / home / jump to a path).
 */
export function BrowseSection({ fav, rootPath, open, onToggle }: {
  fav: FavoritesApi; rootPath: string; open: boolean; onToggle: () => void;
}) {
  const [root, setRoot] = useState(rootPath);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [editingPath, setEditingPath] = useState(false);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-0.5 px-2 h-7 text-[11px] uppercase tracking-wide text-dim shrink-0">
        <button onClick={onToggle} title={open ? "Hide file browser" : "Show file browser"}
          className="flex items-center gap-1 flex-1 min-w-0 hover:text-fg">
          <span className="text-dim">{open ? "▾" : "▸"}</span>
          <span>Browse</span>
        </button>
        {open && (
          <>
            <button title="Up a level" disabled={root === "/"} onClick={() => setRoot(dirname(root))}
              className="w-5 h-5 flex items-center justify-center rounded disabled:opacity-30 hover:bg-elevated hover:text-fg">↑</button>
            <button title="Home" onClick={() => setRoot(rootPath)}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-elevated hover:text-fg">⌂</button>
            <button title="Go to path…" onClick={() => setEditingPath(true)}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-elevated hover:text-fg">⋯</button>
          </>
        )}
      </div>
      {open && (
        <>
          {editingPath ? (
            <PathInput initial={root} onCommit={(p) => { if (p.trim()) setRoot(p.trim()); setEditingPath(false); }}
              onCancel={() => setEditingPath(false)} />
          ) : (
            <div onClick={() => setEditingPath(true)} title={root}
              className="px-2 pb-1 text-[11px] text-dim truncate shrink-0 cursor-text hover:text-muted">{root}</div>
          )}
          <div className="flex-1 min-h-0 overflow-auto pb-1 text-sm select-none">
            <DirChildren path={root} depth={0}
              onMenu={(x, y, path) => setMenu({ x, y, path })}
              onAdd={(path) => fav.addFavorite(path, null, null)} />
          </div>
          {menu && (
            <BrowseMenu x={menu.x} y={menu.y} groups={flattenGroups(fav)} dismiss={() => setMenu(null)}
              onAdd={(groupId) => fav.addFavorite(menu.path, groupId, null)} />
          )}
        </>
      )}
    </div>
  );
}

/** Inline path entry for rerooting the tree — replaces the browser prompt(). */
function PathInput({ initial, onCommit, onCancel }: { initial: string; onCommit: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const finish = (commit: boolean) => { if (done.current) return; done.current = true; commit ? onCommit(v) : onCancel(); };
  return (
    <div className="px-2 pb-1 shrink-0">
      <input ref={ref} value={v} spellCheck={false} placeholder="/path/to/folder"
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") finish(true); else if (e.key === "Escape") finish(false); e.stopPropagation(); }}
        onBlur={() => finish(false)}
        className="w-full bg-panel border border-blue-500 rounded px-1.5 py-0.5 text-[11px] text-bright outline-none" />
    </div>
  );
}

type RowProps = { onMenu: (x: number, y: number, path: string) => void; onAdd: (path: string) => void };

function DirChildren({ path, depth, onMenu, onAdd }: { path: string; depth: number } & RowProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["fs", path],
    queryFn: () => api.fsList(path, true),
    staleTime: 10_000,
  });
  const indent = { paddingLeft: 8 + depth * 12 };

  if (isLoading) return <div style={indent} className="px-2 py-0.5 text-dim">…</div>;
  if (error) return <div style={indent} className="px-2 py-0.5 text-red-400/80">can’t read</div>;

  const dirs = data!.entries.filter(e => e.type === "dir");
  if (dirs.length === 0) return <div style={indent} className="px-2 py-1 text-xs text-dim">No subfolders.</div>;

  return <>{dirs.map(d => <DirNode key={d.path} entry={d} depth={depth} onMenu={onMenu} onAdd={onAdd} />)}</>;
}

function DirNode({ entry, depth, onMenu, onAdd }: { entry: FsEntry; depth: number } & RowProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <div
        onClick={() => entry.readable && setExpanded(e => !e)}
        onContextMenu={(e: ReactMouseEvent) => { e.preventDefault(); onMenu(e.clientX, e.clientY, entry.path); }}
        title={entry.path}
        style={{ paddingLeft: 8 + depth * 12 }}
        className={`group flex items-center gap-1 px-2 py-0.5 rounded cursor-pointer hover:bg-surface text-fg
          ${entry.readable ? "" : "opacity-40 cursor-not-allowed"}`}>
        <span className="text-dim w-3 inline-block shrink-0">{expanded ? "▾" : "▸"}</span>
        <img src={getFolderIconUrl(entry.name, expanded)} alt="" aria-hidden draggable={false} className="w-4 h-4 shrink-0" />
        <span className="truncate flex-1 min-w-0">{entry.name}</span>
        <button title="Add to Favorites"
          onClick={(e) => { e.stopPropagation(); onAdd(entry.path); }}
          className="opacity-0 group-hover:opacity-100 shrink-0 text-dim hover:text-amber-300 px-1">＋</button>
      </div>
      {expanded && entry.readable && <DirChildren path={entry.path} depth={depth + 1} onMenu={onMenu} onAdd={onAdd} />}
    </>
  );
}

/**
 * Right-click menu for a browsed folder: pick which favorites group to add it into (or top level),
 * so you don't have to add-then-drag. Lists every group flattened with indentation. Portals to
 * <body>. With no groups yet it collapses to a single "Add to Favorites" (→ top level).
 */
function BrowseMenu({ x, y, groups, onAdd, dismiss }: {
  x: number; y: number; groups: GroupOption[]; onAdd: (groupId: string | null) => void; dismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) dismiss(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    const raf = requestAnimationFrame(() => window.addEventListener("mousedown", onDown));
    window.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [dismiss]);
  const add = (groupId: string | null) => { onAdd(groupId); dismiss(); };

  const left = Math.min(x, window.innerWidth - 232);
  const top = Math.min(y, window.innerHeight - 80);
  return createPortal(
    <div ref={ref} style={{ position: "fixed", left, top, zIndex: 80 }}
      className="w-56 py-1 rounded-lg border border-edge bg-panel shadow-2xl text-sm text-fg select-none">
      {groups.length === 0 ? (
        <Item label="Add to Favorites" onClick={() => add(null)} />
      ) : (
        <>
          <div className="px-3 pt-0.5 pb-1 text-[10px] uppercase tracking-wide text-dim">Add to favorites</div>
          <button onClick={() => add(null)}
            className="w-full flex items-center gap-2 px-3 py-1 text-left hover:bg-elevated">
            <FolderLibraryIcon /><span>Top level</span>
          </button>
          <div className="max-h-64 overflow-auto mt-1 pt-1 border-t border-edge">
            {groups.map((g) => (
              <button key={g.id} onClick={() => add(g.id)} style={{ paddingLeft: 12 + g.depth * 12 }}
                className="w-full flex items-center gap-2 pr-3 py-1 text-left hover:bg-elevated">
                <FolderLibraryIcon /><span className="truncate">{g.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}
