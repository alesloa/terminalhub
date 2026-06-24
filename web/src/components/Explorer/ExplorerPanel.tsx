import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { LeftTab } from "../../store/ui";
import { useRoom, type ExplorerTarget } from "../../store/room";
import { useClipboard } from "../../store/clipboard";
import { useToasts } from "../../store/toasts";
import { isLocalHost } from "../../lib/host";
import { MOVE_TYPE, draggedPaths, parseMovePaths } from "../../lib/dragImage";
import { basename, relativeTo } from "../../lib/paths";
import { fuzzyScore } from "../../lib/fuzzy";
import { useExplorerMenu } from "../../hooks/useExplorerMenu";
import { useTreeDnd } from "../../hooks/useTreeDnd";
import { FileContextMenu } from "../Scm/FileContextMenu";
import { ConfirmDialog } from "../ConfirmDialog";
import { FileTree } from "./FileTree";
import { FilterResults, buildFilterTree } from "./FilterResults";
import { SearchPanel } from "./SearchPanel";

// Cap the filtered result-tree so a loose query (e.g. one letter) can't render thousands of rows.
const MAX_FILTER_RESULTS = 200;

const TABS: { id: LeftTab; label: string }[] = [
  { id: "explorer", label: "Explorer" },
  { id: "filter", label: "Filter Files" },
  { id: "search", label: "Search" },
];

/** Explorer view body (file tree + filter/search sub-tabs). Frame is owned by Sidebar. */
export function ExplorerPanel({ rootPath }: { rootPath: string }) {
  const leftTab = useRoom(s => s.leftTab);
  const setLeftTab = useRoom(s => s.setLeftTab);
  const menu = useRoom(s => s.explorerMenu);
  const closeMenu = useRoom(s => s.closeExplorerMenu);
  const select = useRoom(s => s.selectExplorer);
  const selectedPath = useRoom(s => s.selectedPath);
  const clipboard = useClipboard(s => s.clipboard);
  const startEdit = useRoom(s => s.startExplorerEdit);
  const openFiles = useRoom(s => s.openFiles);
  const closeMany = useRoom(s => s.closeMany);
  const [filter, setFilter] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [filterCollapsed, setFilterCollapsed] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<ExplorerTarget[] | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const qc = useQueryClient();
  const push = useToasts(s => s.push);

  // Flat filename index for the Filter Files tab — fetched once per root (only while that tab is open),
  // then fuzzy-filtered in memory so every keystroke narrows instantly without a server round-trip.
  const fileIndex = useQuery({
    queryKey: ["fs", "files", rootPath],
    queryFn: () => api.fsFiles(rootPath),
    enabled: leftTab === "filter",
    staleTime: 5_000,
  }).data;

  const filterQuery = filter.trim();
  // Score every indexed path against the query, keep the subsequence matches, best-first, capped.
  const ranked = useMemo(() => {
    if (!filterQuery || !fileIndex?.files) return null;
    // Match the BASENAME by default (this tab filters "by filename"). Matching the whole relative
    // path let the query's letters get scavenged one-per-folder, so a deeply-nested file falsely
    // matched almost anything ("canvas.png" → docs/assets/…/ns_vial_sq.png). Typing a "/" (or "\")
    // opts into full-path matching for when you actually want to filter by folder.
    const byPath = filterQuery.includes("/") || filterQuery.includes("\\");
    const scored: { path: string; score: number }[] = [];
    for (const p of fileIndex.files) {
      const s = fuzzyScore(filterQuery, byPath ? relativeTo(p, rootPath) : basename(p), caseSensitive);
      if (s !== null) scored.push({ path: p, score: s });
    }
    scored.sort((a, b) => b.score - a.score);
    return { total: scored.length, paths: scored.slice(0, MAX_FILTER_RESULTS).map(x => x.path) };
  }, [filterQuery, fileIndex, rootPath, caseSensitive]);
  const filterTree = useMemo(() => ranked ? buildFilterTree(rootPath, ranked.paths) : null, [ranked, rootPath]);

  const toggleFilterDir = (path: string) =>
    setFilterCollapsed(prev => { const n = new Set(prev); n.has(path) ? n.delete(path) : n.add(path); return n; });

  // Cmd/Ctrl + ←/→ collapse / expand the whole result tree (matches the Explorer tree's shortcut).
  // Handled at the panel level so it fires even while the filter input is focused.
  const onFilterKeyDown = (e: ReactKeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); setFilterCollapsed(new Set(filterTree?.folders ?? [])); }
    else if (e.key === "ArrowRight") { e.preventDefault(); setFilterCollapsed(new Set()); }
  };

  // git info gates "Add to .gitignore" and gives the repo root for anchoring the entry.
  const gitInfo = useQuery({
    queryKey: ["git", "info", rootPath],
    queryFn: () => api.git.info(rootPath),
    staleTime: 30_000,
  }).data;

  const { buildItems, collapseAll, expandAll, clip, upload } = useExplorerMenu(rootPath, gitInfo, setPendingDelete);
  const dnd = useTreeDnd();

  const confirmDelete = async () => {
    const targets = pendingDelete;
    if (!targets?.length) return;
    setPendingDelete(null);
    // Delete the whole selection in parallel (one slow remote round-trip per file otherwise).
    const results = await Promise.allSettled(targets.map(t => api.fsDelete(t.path)));
    const failed = results.flatMap((r, i) => r.status === "rejected" ? [`${targets[i].name}: ${(r.reason as Error).message}`] : []);
    // Close any open tabs whose file lived under any deleted path.
    const orphaned = openFiles.filter(f => targets.some(t => f.path === t.path || f.path.startsWith(t.path + "/"))).map(f => f.path);
    if (orphaned.length) closeMany(orphaned);
    qc.invalidateQueries({ queryKey: ["fs"] });
    qc.invalidateQueries({ queryKey: ["git"] });
    if (failed.length) push(`Delete failed: ${failed.join("; ")}`);
  };

  // File-tree keyboard, scoped to the focused panel (the scroll container is focusable) so it
  // doesn't fight the editor/terminal shortcuts. F2 renames the selected row (no modifier).
  // Cmd/Ctrl + C/X/V copy/cut/paste the selection (Copy+Paste in place duplicates), and ←/→
  // collapse / expand the whole tree — matching VS Code's Explorer.
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return; // typing in rename/filter input
    if (e.key === "F2" && selectedPath) { e.preventDefault(); startEdit({ mode: "rename", target: selectedPath }); return; }
    if (!(e.metaKey || e.ctrlKey)) return;
    const k = e.key.toLowerCase();
    if (e.key === "ArrowLeft") { e.preventDefault(); collapseAll(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); expandAll(); }
    else if (k === "c" && selectedPath) { e.preventDefault(); clip.copy(selectedPath); }
    else if (k === "x" && selectedPath) { e.preventDefault(); clip.cut(selectedPath); }
    else if (k === "v" && clipboard) { e.preventDefault(); clip.paste(selectedPath); }
  };

  const hasFiles = (dt: DataTransfer | null) => !!dt && Array.from(dt.types).includes("Files");
  const isMove = (dt: DataTransfer | null) => !!dt && Array.from(dt.types).includes(MOVE_TYPE);

  // Cmd/Ctrl+V pasting from the desktop. An internal tree cut/copy takes precedence and is handled
  // by onKeyDown above (it carries no files). Otherwise, on a local host the server copies whatever
  // files/folders are on the OS clipboard (multi-select + whole folders); the browser-surfaced files
  // are passed as the fallback for when the host clipboard has none (e.g. a copied screenshot).
  const onPaste = (e: ReactClipboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return; // let rename/filter inputs paste text
    if (clipboard) return; // internal cut/copy → onKeyDown handles the paste
    const files = Array.from(e.clipboardData?.files ?? []);
    // Local: the server pastes the host clipboard (files OR folders). Remote: only the files the
    // browser surfaced — a folder copy carries no readable bytes through the clipboard, so when one
    // is detected (a "Files" type with nothing readable) point the user at drag, which does work.
    if (isLocalHost || files.length) {
      e.preventDefault();
      upload.desktopPaste(selectedPath, files);
    } else if (Array.from(e.clipboardData?.types ?? []).includes("Files")) {
      e.preventDefault();
      push("Folders can’t be pasted over the network — drag the folder in instead.");
    }
  };

  // Drag files/folders in from the OS (upload), or release an internal row-move over empty space to
  // drop it into the root. Folder/file rows stopPropagation on internal moves, so this only sees the
  // move when it's released off-row.
  const onDragOver = (e: ReactDragEvent) => {
    if (hasFiles(e.dataTransfer)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (!dragOver) setDragOver(true);
      return;
    }
    if (isMove(e.dataTransfer) && dnd.canDrop(rootPath, draggedPaths())) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  };
  const onDragLeave = (e: ReactDragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
  };
  const onDrop = (e: ReactDragEvent) => {
    if (hasFiles(e.dataTransfer)) {
      e.preventDefault();
      setDragOver(false);
      upload.drop(e.dataTransfer, selectedPath);
      return;
    }
    if (isMove(e.dataTransfer)) {
      e.preventDefault();
      const got = parseMovePaths(e.dataTransfer.getData(MOVE_TYPE));
      const sources = got.length ? got : draggedPaths();
      if (sources.length) dnd.move(rootPath, sources);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex text-xs overflow-x-auto no-scrollbar">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setLeftTab(t.id)}
            className={`px-2.5 py-2 shrink-0 whitespace-nowrap ${leftTab === t.id ? "text-fg border-b-2 border-blue-500" : "text-dim hover:text-fg"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {leftTab === "search" ? (
        // The Search tab owns its own scroll region (fixed inputs, scrolling results) and isn't a
        // file drop target, so it fills the panel directly instead of riding the tree's drop wrapper.
        <SearchPanel rootPath={rootPath} />
      ) : leftTab === "filter" ? (
        // Filter Files: empty until you type, then an indexed, fuzzy filename search shown as a
        // collapsed-to-the-matches path tree (not a dimmed full tree). Not a drop target.
        <div onKeyDown={onFilterKeyDown} className="flex-1 min-h-0 flex flex-col">
          <div className="relative mx-2 my-2">
            <input autoFocus value={filter} onChange={(e) => setFilter(e.target.value)} spellCheck={false}
              placeholder="filter by filename…"
              className="w-full pl-2 pr-14 py-1 text-sm bg-panel border border-edge rounded outline-none focus:border-blue-500" />
            <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
              <button title="Match case" onClick={() => setCaseSensitive(v => !v)}
                className={`px-1 py-0.5 rounded text-xs font-mono leading-none ${
                  caseSensitive ? "bg-blue-600 text-white" : "text-muted hover:bg-elevated hover:text-fg"
                }`}>Aa</button>
              {filter && (
                <button title="Clear" onClick={() => setFilter("")}
                  className="w-5 h-5 grid place-items-center rounded text-dim hover:bg-elevated hover:text-fg">✕</button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-auto py-1">
            {!filterQuery ? (
              <div className="px-3 py-2 text-xs text-dim">Type to filter files by name.</div>
            ) : !fileIndex ? (
              <div className="px-3 py-2 text-xs text-dim">Indexing files…</div>
            ) : filterTree && filterTree.nodes.length ? (
              <FilterResults nodes={filterTree.nodes} collapsed={filterCollapsed} onToggleDir={toggleFilterDir}
                footer={ranked && ranked.total > ranked.paths.length
                  ? <div className="px-3 py-1 text-xs text-dim">{ranked.total - ranked.paths.length} more — refine your filter.</div>
                  : null} />
            ) : (
              <div className="px-3 py-2 text-xs text-dim">No files match “{filterQuery}”.</div>
            )}
          </div>
        </div>
      ) : (
        // Focusable so clicking the list shows a subtle ring (lighter than the panel edge) and makes
        // it the paste/drop target; drag-over swaps the ring to the accent colour.
        <div tabIndex={0} onKeyDown={onKeyDown} onPaste={onPaste}
          onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
          className={`flex-1 overflow-auto py-1 outline-none ring-inset focus-within:ring-1 focus-within:ring-edge-strong ${dragOver ? "!ring-2 !ring-accent" : ""}`}>
          <FileTree rootPath={rootPath} filter="" />
        </div>
      )}

      {menu && (
        <FileContextMenu x={menu.x} y={menu.y} items={buildItems(menu.target, { results: leftTab !== "explorer" })}
          dismiss={() => { closeMenu(); select(null); }} />
      )}

      {!!pendingDelete?.length && (
        <ConfirmDialog
          title={pendingDelete.length > 1 ? `Delete ${pendingDelete.length} items` : `Delete ${pendingDelete[0].type === "dir" ? "folder" : "file"}`}
          body={pendingDelete.length > 1
            ? `${pendingDelete.length} items will be permanently deleted${pendingDelete.some(t => t.type === "dir") ? " (folders along with their contents)" : ""}. This can't be undone.`
            : `"${pendingDelete[0].name}" will be permanently deleted${pendingDelete[0].type === "dir" ? " along with its contents" : ""}. This can't be undone.`}
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
