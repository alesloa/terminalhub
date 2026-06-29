import { type ReactNode, type HTMLAttributes, type MouseEvent as ReactMouseEvent } from "react";
import { useRoom, type ExplorerTarget } from "../../store/room";
import { getFileIconUrl, getFolderIconUrl } from "../../lib/materialIcons";
import { relativeTo } from "../../lib/paths";
import { startPathDrag } from "../../lib/dragImage";

/** A node in the filtered path-tree: a folder (with children) or a matched file leaf. */
export type FilterNode =
  | { kind: "dir"; name: string; path: string; children: FilterNode[] }
  | { kind: "file"; name: string; path: string };

interface DirAcc { name: string; path: string; dirs: Map<string, DirAcc>; files: { name: string; path: string }[]; }

/** Fold a flat list of matched absolute file paths into a nested folder tree (only the ancestor
 *  folders of matches appear), returning the tree plus every folder path in it (for collapse-all).
 *  Folders sort before files; both alphabetically — the natural file-tree order. */
export function buildFilterTree(rootPath: string, paths: string[]): { nodes: FilterNode[]; folders: string[] } {
  const rootAcc: DirAcc = { name: "", path: rootPath, dirs: new Map(), files: [] };
  for (const abs of paths) {
    const segs = relativeTo(abs, rootPath).split("/");
    let cur = rootAcc;
    let curPath = rootPath;
    for (let i = 0; i < segs.length - 1; i++) {
      curPath += "/" + segs[i];
      let next = cur.dirs.get(segs[i]);
      if (!next) { next = { name: segs[i], path: curPath, dirs: new Map(), files: [] }; cur.dirs.set(segs[i], next); }
      cur = next;
    }
    cur.files.push({ name: segs[segs.length - 1], path: abs });
  }
  const folders: string[] = [];
  const toNodes = (acc: DirAcc): FilterNode[] => {
    const dirs: FilterNode[] = [...acc.dirs.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((d) => { folders.push(d.path); return { kind: "dir" as const, name: d.name, path: d.path, children: toNodes(d) }; });
    const files: FilterNode[] = acc.files
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((f) => ({ kind: "file" as const, name: f.name, path: f.path }));
    return [...dirs, ...files];
  };
  return { nodes: toNodes(rootAcc), folders };
}

/** The "Filter Files" result list: matched files shown in their (expanded) folder path, like image 7.
 *  Folders collapse/expand; clicking a file opens it. Empty/typing states live in the parent. */
export function FilterResults({ nodes, collapsed, onToggleDir, footer }: {
  nodes: FilterNode[];
  collapsed: Set<string>;
  onToggleDir: (path: string) => void;
  footer?: ReactNode;
}) {
  return (
    <div className="text-sm select-none">
      {nodes.map((n) => <Node key={n.path} node={n} depth={0} collapsed={collapsed} onToggleDir={onToggleDir} />)}
      {footer}
    </div>
  );
}

/** Open the Explorer right-click menu for a result row — the panel renders the menu itself. */
function useRowMenu() {
  const openMenu = useRoom((s) => s.openExplorerMenu);
  return (e: ReactMouseEvent, target: ExplorerTarget) => {
    e.preventDefault();
    e.stopPropagation();
    openMenu({ x: e.clientX, y: e.clientY, target });
  };
}

function Node({ node, depth, collapsed, onToggleDir }: {
  node: FilterNode; depth: number; collapsed: Set<string>; onToggleDir: (path: string) => void;
}) {
  const rowMenu = useRowMenu();
  if (node.kind === "file") return <FileRow node={node} depth={depth} />;
  const isCollapsed = collapsed.has(node.path);
  return (
    <>
      <Indented depth={depth} onClick={() => onToggleDir(node.path)}
        draggable onDragStart={(e) => startPathDrag(e, [node.path])}
        onContextMenu={(e) => rowMenu(e, { path: node.path, name: node.name, type: "dir" })}
        className="cursor-pointer flex items-center gap-1 hover:bg-surface">
        <span className="text-dim w-3 inline-block">{isCollapsed ? "▸" : "▾"}</span>
        <Icon src={getFolderIconUrl(node.name, !isCollapsed)} />
        <span className="truncate">{node.name}</span>
      </Indented>
      {!isCollapsed && node.children.map((c) => <Node key={c.path} node={c} depth={depth + 1} collapsed={collapsed} onToggleDir={onToggleDir} />)}
    </>
  );
}

function FileRow({ node, depth }: { node: Extract<FilterNode, { kind: "file" }>; depth: number }) {
  const open = useRoom((s) => s.openFile);
  const selected = useRoom((s) => s.selectedPaths.has(node.path));
  const rowMenu = useRowMenu();
  return (
    <Indented depth={depth} title={node.path}
      draggable onDragStart={(e) => startPathDrag(e, [node.path])}
      onClick={() => open({ path: node.path, name: node.name })}
      onContextMenu={(e) => rowMenu(e, { path: node.path, name: node.name, type: "file" })}
      className={`cursor-pointer flex items-center gap-1 ${selected ? "bg-elevated" : "hover:bg-surface"}`}>
      <span className="w-3 inline-block" />
      <Icon src={getFileIconUrl(node.name)} />
      <span className="truncate flex-1 min-w-0">{node.name}</span>
    </Indented>
  );
}

function Icon({ src }: { src?: string }) {
  if (!src) return <span className="w-4 h-4 shrink-0 inline-block" />;
  return <img src={src} alt="" aria-hidden draggable={false} className="w-4 h-4 shrink-0" />;
}

function Indented({ depth, className = "", children, ...rest }:
  { depth: number; className?: string; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={`px-2 py-0.5 ${className}`} style={{ paddingLeft: 8 + depth * 12 }}>
      {children}
    </div>
  );
}
