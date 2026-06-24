import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type HTMLAttributes, type Ref, type MouseEvent as ReactMouseEvent, type DragEvent as ReactDragEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { FsEntry } from "../../api/types";
import { useRoom, type ExplorerEdit, type ExplorerTarget } from "../../store/room";
import { useExplorerEdit } from "../../hooks/useExplorerEdit";
import { useTreeDnd } from "../../hooks/useTreeDnd";
import { useTreeSelection } from "../../hooks/useTreeSelection";
import { getFileIconUrl, getFolderIconUrl } from "../../lib/materialIcons";
import { basename, dirname, splitExt } from "../../lib/paths";
import { MOVE_TYPE, clearDrag, draggedPaths, parseMovePaths } from "../../lib/dragImage";
import { buildDecorations, noDecorations, type Decorations, type Deco } from "../../lib/gitDecorations";

// Git colour/badge lookup for the current tree, shared with every row without prop drilling.
const DecoContext = createContext<Decorations>(noDecorations);
const useDeco = (absPath: string, isDir: boolean): Deco | null => useContext(DecoContext).forPath(absPath, isDir);

// Drag-move plumbing (canMove/canDrop/move), shared with every row the same way.
const DndContext = createContext<ReturnType<typeof useTreeDnd> | null>(null);
const useDnd = () => useContext(DndContext)!;

// Multi-select click/drag plumbing, shared with every row the same way.
const SelContext = createContext<ReturnType<typeof useTreeSelection> | null>(null);
const useSel = () => useContext(SelContext)!;

/**
 * Wire a row as an internal-move drop target. `dir` is where a dropped item lands — a folder's own
 * path, or a file's parent dir. For folders, `spring` auto-expands the folder after a brief hover so
 * you can drop into a subfolder, exactly like a desktop tree. OS file drags (the "Files" type) are
 * ignored here and bubble to the panel's uploader; only internal moves (MOVE_TYPE) are handled.
 */
function useDropTarget(dir: string, spring?: { path: string; expanded: boolean; readable: boolean }) {
  const dnd = useDnd();
  const expandDirs = useRoom(s => s.expandDirs);
  const [dropping, setDropping] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const clearSpring = () => { if (timer.current !== undefined) { clearTimeout(timer.current); timer.current = undefined; } };
  const reset = () => { setDropping(false); clearSpring(); };
  const isMove = (e: ReactDragEvent) => e.dataTransfer.types.includes(MOVE_TYPE);

  const props = {
    onDragOver: (e: ReactDragEvent) => {
      if (!isMove(e)) return;            // OS file drag → let it bubble to the panel uploader
      e.stopPropagation();               // this row owns the internal move; the panel mustn't double-handle
      if (!dnd.canDrop(dir, draggedPaths())) { e.dataTransfer.dropEffect = "none"; reset(); return; }
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (!dropping) setDropping(true);
      if (spring && !spring.expanded && spring.readable && timer.current === undefined) {
        timer.current = window.setTimeout(() => { expandDirs([spring.path]); timer.current = undefined; }, 600);
      }
    },
    onDragLeave: (e: ReactDragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return; // moved onto a child, not out
      reset();
    },
    onDrop: (e: ReactDragEvent) => {
      if (!isMove(e)) return;
      e.stopPropagation();
      reset();
      e.preventDefault();
      const got = parseMovePaths(e.dataTransfer.getData(MOVE_TYPE));
      const sources = got.length ? got : draggedPaths();
      if (sources.length) dnd.move(dir, sources);
    },
    onDragEnd: () => { clearDrag(); reset(); }, // fires on the source row when the drag ends
  };
  return { dropping, props };
}

export function FileTree({ rootPath, filter }: { rootPath: string; filter: string }) {
  const openMenu = useRoom(s => s.openExplorerMenu);
  const select = useRoom(s => s.selectExplorer);

  // Git decorations: poll status (keeps colours live as files are edited/staged) + the ignore
  // list, both only when the workspace is a repo. Paths from git are relative to rootPath (the
  // cwd git runs in), so that's the base for matching tree entries.
  const isRepo = !!useQuery({ queryKey: ["git", "info", rootPath], queryFn: () => api.git.info(rootPath), staleTime: 30_000 }).data?.isRepo;
  const status = useQuery({ queryKey: ["git", "status", rootPath], queryFn: () => api.git.status(rootPath), enabled: isRepo, refetchInterval: 4000, refetchIntervalInBackground: true }).data;
  const ignored = useQuery({ queryKey: ["git", "ignored", rootPath], queryFn: () => api.git.ignored(rootPath).then(r => r.ignored), enabled: isRepo, staleTime: 60_000 }).data;
  const deco = useMemo(() => buildDecorations(status, ignored, rootPath), [status, ignored, rootPath]);
  const dnd = useTreeDnd();
  const sel = useTreeSelection(rootPath, filter);

  // Right-clicking empty space (not a row) targets the root dir so New File / Paste still work.
  const onBackground = (e: ReactMouseEvent) => {
    e.preventDefault();
    select(null);
    openMenu({ x: e.clientX, y: e.clientY, target: { path: rootPath, name: "", type: "dir" } });
  };
  // Clicking the empty space below the rows selects the root node (VS Code / Finder behaviour). Only
  // when the hit is the container itself — row clicks bubble up here but have a deeper target.
  const onBackgroundClick = (e: ReactMouseEvent) => {
    if (e.target === e.currentTarget) select(rootPath);
  };
  return (
    <DecoContext.Provider value={deco}>
      <DndContext.Provider value={dnd}>
        <SelContext.Provider value={sel}>
          <div className="text-sm select-none min-h-full" onContextMenu={onBackground} onClick={onBackgroundClick}>
            <RootNode rootPath={rootPath} filter={filter.trim().toLowerCase()} />
          </div>
        </SelContext.Provider>
      </DndContext.Provider>
    </DecoContext.Provider>
  );
}

/**
 * The workspace root rendered as the top tree node (VS Code style): one collapsible folder row
 * with everything nested beneath it at depth+1. Collapse it to "minimize" the tree down to just
 * this folder. Its collapse state lives in `collapsedRoots` (default = expanded), separate from
 * `expandedDirs`, so Collapse All never hides the root. The root isn't draggable or renamable here.
 */
function RootNode({ rootPath, filter }: { rootPath: string; filter: string }) {
  const collapsed = useRoom(s => s.collapsedRoots.has(rootPath));
  const toggleRoot = useRoom(s => s.toggleRoot);
  const selected = useRoom(s => s.selectedPaths.has(rootPath));
  const rowMenu = useRowMenu();
  const sel = useSel();
  const deco = useDeco(rootPath, true);
  const drop = useDropTarget(rootPath);
  const name = basename(rootPath);

  return (
    <>
      <Indented depth={0}
        {...drop.props}
        onClick={(e) => sel.click(rootPath, e, () => { if (e.detail === 1) toggleRoot(rootPath); })}
        onContextMenu={(e) => rowMenu(e, { path: rootPath, name, type: "dir" })}
        className={`cursor-pointer flex items-center gap-1 ${drop.dropping ? "ring-1 ring-inset ring-accent bg-accent/15" : selected ? "bg-elevated" : "hover:bg-surface"} ${deco?.dim ? "opacity-50" : ""}`}>
        <span className="text-dim w-3 inline-block">{collapsed ? "▸" : "▾"}</span>
        <Icon src={getFolderIconUrl(name, !collapsed)} />
        <span className={`truncate font-medium ${deco?.className ?? ""}`}>{name}</span>
      </Indented>
      {!collapsed && <DirChildren path={rootPath} depth={1} filter={filter} />}
    </>
  );
}

/** Open the right-click menu for a row; shared by dir and file rows. */
function useRowMenu() {
  const openMenu = useRoom(s => s.openExplorerMenu);
  return (e: ReactMouseEvent, target: ExplorerTarget) => {
    e.preventDefault();
    e.stopPropagation(); // don't also trigger the background (root) menu
    openMenu({ x: e.clientX, y: e.clientY, target });
  };
}

function DirChildren({ path, depth, filter }: { path: string; depth: number; filter: string }) {
  const edit = useRoom(s => s.explorerEdit);
  // Poll the listing so files added/removed OUTSIDE the app (Finder, another terminal) show up
  // without switching tabs to force a remount. Same 4s cadence as the git-status poll above, so
  // both refresh together. Only expanded (mounted) dirs poll — we watch only what's on screen.
  const { data, isLoading, error } = useQuery({
    queryKey: ["fs", path],
    queryFn: () => api.fsList(path, true),
    staleTime: 10_000,
    refetchInterval: 4000,
  });

  if (isLoading) return <Indented depth={depth} className="text-dim">…</Indented>;
  if (error) return <Indented depth={depth} className="text-red-400/80">can’t read</Indented>;

  const dirs = data!.entries.filter(e => e.type === "dir");
  const files = data!.entries.filter(e => e.type === "file" && (!filter || e.name.toLowerCase().includes(filter)));
  // An in-progress "New File"/"New Folder" under this dir renders an inline input as the first child.
  const newEdit = edit && edit.target === path && edit.mode !== "rename" ? edit : null;

  return (
    <>
      {newEdit && <EditRow depth={depth} kind={newEdit.mode === "new-folder" ? "dir" : "file"} edit={newEdit} initialName="" />}
      {dirs.map(d => <DirNode key={d.path} entry={d} depth={depth} filter={filter} />)}
      {files.map(f => <FileRow key={f.path} entry={f} depth={depth} />)}
    </>
  );
}

function DirNode({ entry, depth, filter }: { entry: FsEntry; depth: number; filter: string }) {
  const expanded = useRoom(s => s.expandedDirs.has(entry.path));
  const selected = useRoom(s => s.selectedPaths.has(entry.path));
  const toggleDir = useRoom(s => s.toggleDir);
  const startEdit = useRoom(s => s.startExplorerEdit);
  const renaming = useRoom(s => s.explorerEdit?.mode === "rename" && s.explorerEdit?.target === entry.path);
  const rowMenu = useRowMenu();
  const sel = useSel();
  const deco = useDeco(entry.path, true);
  // Drop a dragged row onto this folder to move it in; spring-load opens the folder on hover so a
  // collapsed folder reveals its subfolders mid-drag.
  const drop = useDropTarget(entry.path, { path: entry.path, expanded, readable: entry.readable });

  if (renaming) return <EditRow depth={depth} kind="dir" edit={{ mode: "rename", target: entry.path }} initialName={entry.name} />;

  return (
    <>
      <Indented depth={depth}
        draggable
        onDragStart={(e) => sel.dragStart(entry.path, e)}
        {...drop.props}
        // Plain click selects + toggles; Ctrl/Shift click multi-selects (no toggle). Double-click
        // renames inline — e.detail>1 skips the toggle so the folder doesn't flip under the input.
        onClick={(e) => sel.click(entry.path, e, () => { if (e.detail === 1 && entry.readable) toggleDir(entry.path); })}
        onDoubleClick={() => startEdit({ mode: "rename", target: entry.path })}
        onContextMenu={(e) => rowMenu(e, { path: entry.path, name: entry.name, type: "dir" })}
        className={`cursor-pointer flex items-center gap-1 ${drop.dropping ? "ring-1 ring-inset ring-accent bg-accent/15" : selected ? "bg-elevated" : "hover:bg-surface"} ${entry.readable ? "" : "opacity-40 cursor-not-allowed"} ${deco?.dim ? "opacity-50" : ""}`}>
        <span className="text-dim w-3 inline-block">{expanded ? "▾" : "▸"}</span>
        <Icon src={getFolderIconUrl(entry.name, expanded)} />
        <span className={`truncate ${deco?.className ?? ""}`}>{entry.name}</span>
      </Indented>
      {expanded && <DirChildren path={entry.path} depth={depth + 1} filter={filter} />}
    </>
  );
}

function FileRow({ entry, depth }: { entry: FsEntry; depth: number }) {
  const open = useRoom(s => s.openFile);
  const startEdit = useRoom(s => s.startExplorerEdit);
  const selected = useRoom(s => s.selectedPaths.has(entry.path));
  const revealed = useRoom(s => s.revealTarget === entry.path);
  const clearReveal = useRoom(s => s.clearRevealTarget);
  const renaming = useRoom(s => s.explorerEdit?.mode === "rename" && s.explorerEdit?.target === entry.path);
  const rowMenu = useRowMenu();
  const sel = useSel();
  const deco = useDeco(entry.path, false);
  // Dropping a dragged row onto a file moves it into that file's folder (like a desktop tree).
  const drop = useDropTarget(dirname(entry.path));
  const ref = useRef<HTMLDivElement>(null);
  // When this is the reveal target, scroll it into view and flash; clear after the flash so
  // the highlight is transient and a later reveal of the same file re-triggers.
  useEffect(() => {
    if (!revealed) return;
    ref.current?.scrollIntoView({ block: "center" });
    const t = setTimeout(clearReveal, 1500);
    return () => clearTimeout(t);
  }, [revealed, clearReveal]);

  if (renaming) return <EditRow depth={depth} kind="file" edit={{ mode: "rename", target: entry.path }} initialName={entry.name} />;

  return (
    <Indented depth={depth} innerRef={ref}
      draggable
      onDragStart={(e) => sel.dragStart(entry.path, e)}
      {...drop.props}
      // Plain click selects + opens; Ctrl/Shift click multi-selects (no open). Double-click renames
      // inline — e.detail>1 skips the open so a rename doesn't also re-open the file.
      onClick={(e) => sel.click(entry.path, e, () => { if (e.detail === 1) open({ path: entry.path, name: entry.name }); })}
      onDoubleClick={() => startEdit({ mode: "rename", target: entry.path })}
      onContextMenu={(e) => rowMenu(e, { path: entry.path, name: entry.name, type: "file" })}
      className={`cursor-pointer flex items-center gap-1 ${drop.dropping ? "ring-1 ring-inset ring-accent bg-accent/15" : revealed || selected ? "bg-elevated" : "hover:bg-surface"} ${deco?.dim ? "opacity-50" : ""}`}>
      <span className="w-3 inline-block" />
      <Icon src={getFileIconUrl(entry.name)} />
      <span className={`truncate flex-1 min-w-0 ${deco?.className ?? ""}`}>{entry.name}</span>
      {deco?.letter && <span data-deco-letter className={`shrink-0 text-[11px] font-medium ${deco.className}`}>{deco.letter}</span>}
    </Indented>
  );
}

/** Inline text input for renaming a row or naming a new file/folder. Enter commits, Esc/blur cancels. */
function EditRow({ depth, kind, edit, initialName }:
  { depth: number; kind: "dir" | "file"; edit: ExplorerEdit; initialName: string }) {
  const { commitEdit } = useExplorerEdit();
  const cancel = useRoom(s => s.cancelExplorerEdit);
  const [value, setValue] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);
  const committed = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // Select the basename (sans extension) on rename, like VS Code; select all for new entries.
    if (edit.mode === "rename" && kind === "file") {
      const [base] = splitExt(initialName);
      el.setSelectionRange(0, base.length);
    } else el.select();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = (commit: boolean) => {
    if (committed.current) return;
    committed.current = true;
    if (commit) commitEdit(edit, value);
    cancel();
  };

  return (
    <Indented depth={depth} className="flex items-center gap-1">
      <span className="w-3 inline-block">{kind === "dir" ? "▸" : ""}</span>
      <Icon src={kind === "dir" ? getFolderIconUrl(value || "folder", false) : getFileIconUrl(value || "file")} />
      <input ref={inputRef} value={value} spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(true);
          else if (e.key === "Escape") finish(false);
          e.stopPropagation();
        }}
        onBlur={() => finish(true)}
        className="flex-1 min-w-0 bg-panel border border-blue-500 rounded px-1 py-0 text-sm text-bright outline-none" />
    </Indented>
  );
}

function Icon({ src }: { src?: string }) {
  // Keep row alignment even if an icon name has no SVG (rare): render a sized blank.
  if (!src) return <span className="w-4 h-4 shrink-0 inline-block" />;
  return <img src={src} alt="" aria-hidden draggable={false} className="w-4 h-4 shrink-0" />;
}

function Indented({ depth, className = "", children, innerRef, ...rest }:
  { depth: number; className?: string; children: ReactNode; innerRef?: Ref<HTMLDivElement> } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div ref={innerRef} {...rest} className={`px-2 py-0.5 ${className}`} style={{ paddingLeft: 8 + depth * 12 }}>
      {children}
    </div>
  );
}
