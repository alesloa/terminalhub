import { useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useRoom } from "../../store/room";
import { useBookmarks } from "../../hooks/useBookmarks";
import type { Bookmark } from "../../api/types";
import { FileContextMenu, type FileMenuEntry } from "../Scm/FileContextMenu";
import { LabelModal } from "./LabelModal";

const basename = (p: string) => p.split("/").pop() ?? p;
const relTo = (root: string, p: string) => (p.startsWith(root + "/") ? p.slice(root.length + 1) : p);

/** The bookmark browser — VS Code "Bookmarks" side bar. Tree (grouped by file) or flat list. */
export function BookmarksPanel({ rootPath }: { rootPath: string }) {
  const workspaceId = useRoom(s => s.workspaceId);
  const view = useRoom(s => s.bookmarkView);
  const setView = useRoom(s => s.setBookmarkView);
  const jumpToLine = useRoom(s => s.jumpToLine);
  const { bookmarks, isLoading, update, remove, clearFile, clearAll } = useBookmarks(workspaceId);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; bm: Bookmark } | null>(null);
  const [editing, setEditing] = useState<Bookmark | null>(null);

  const groups = useMemo(() => {
    const m = new Map<string, Bookmark[]>();
    for (const b of bookmarks) (m.get(b.filePath) ?? m.set(b.filePath, []).get(b.filePath)!).push(b);
    return [...m.entries()];
  }, [bookmarks]);

  const open = (b: Bookmark) => jumpToLine({ path: b.filePath, name: basename(b.filePath) }, b.line);
  const toggleCollapse = (file: string) =>
    setCollapsed(s => { const n = new Set(s); n.has(file) ? n.delete(file) : n.add(file); return n; });

  const onContext = (e: ReactMouseEvent, bm: Bookmark) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, bm }); };
  const menuItems = (b: Bookmark): FileMenuEntry[] => [
    { label: "Go to bookmark", onClick: () => open(b) },
    { label: b.label ? "Edit label…" : "Add label…", onClick: () => setEditing(b) },
    "sep",
    { label: "Remove bookmark", onClick: () => remove.mutate(b.id) },
  ];

  const exportMarkdown = () => {
    const lines = [`# Bookmarks — ${basename(rootPath)}`, ""];
    for (const [file, items] of groups) {
      lines.push(`## ${relTo(rootPath, file)}`);
      for (const b of items) lines.push(`- L${b.line}: ${b.label ?? b.preview ?? ""}`.trimEnd());
      lines.push("");
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `bookmarks-${basename(rootPath)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const Row = ({ b, showFile }: { b: Bookmark; showFile?: boolean }) => (
    <div onClick={() => open(b)} onContextMenu={(e) => onContext(e, b)}
      className="group px-3 py-1 flex items-center gap-2 cursor-pointer hover:bg-elevated text-sm">
      <span className="w-3 h-3 shrink-0 rounded-full bg-accent" />
      <span className="text-dim text-xs tabular-nums shrink-0">{b.line}</span>
      <span className="truncate text-fg">
        {b.label ?? b.preview ?? <span className="text-dim italic">empty line</span>}
        {showFile && <span className="text-dim"> · {relTo(rootPath, b.filePath)}</span>}
      </span>
      <span className="ml-auto opacity-0 group-hover:opacity-100 flex items-center gap-1">
        <button title="Edit label" onClick={(e) => { e.stopPropagation(); setEditing(b); }} className="text-dim hover:text-fg text-xs">✎</button>
        <button title="Remove" onClick={(e) => { e.stopPropagation(); remove.mutate(b.id); }} className="text-dim hover:text-red-400 text-xs">✕</button>
      </span>
    </div>
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-3 pt-2 pb-1 flex items-center justify-between">
        <span className="text-[11px] tracking-wide text-muted">BOOKMARKS</span>
        <div className="flex items-center gap-2 text-xs">
          <button onClick={() => setView(view === "tree" ? "list" : "tree")}
            title={view === "tree" ? "Show as flat list" : "Group by file"}
            className="text-dim hover:text-fg">{view === "tree" ? "☰" : "⊞"}</button>
          <button onClick={exportMarkdown} disabled={bookmarks.length === 0}
            title="Export to Markdown" className="text-dim hover:text-fg disabled:opacity-30">↧</button>
          <button onClick={() => clearAll.mutate()} disabled={bookmarks.length === 0}
            title="Clear all bookmarks" className="text-dim hover:text-red-400 disabled:opacity-30">⌫</button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto pb-2">
        {isLoading && <div className="px-3 py-2 text-xs text-dim">loading bookmarks…</div>}
        {!isLoading && bookmarks.length === 0 && (
          <div className="px-3 py-4 text-xs text-dim leading-relaxed">
            No bookmarks yet.
            <div className="mt-1 text-dim">Open a file and press <span className="font-mono text-dim">⌘⌥K</span> on a line, or click the gutter.</div>
          </div>
        )}

        {!isLoading && view === "list" && bookmarks.map(b => <Row key={b.id} b={b} showFile />)}

        {!isLoading && view === "tree" && groups.map(([file, items]) => (
          <div key={file} className="mb-0.5">
            <div className="group px-2 py-1 flex items-center gap-1 cursor-pointer hover:bg-panel text-xs text-muted"
              onClick={() => toggleCollapse(file)}>
              <span className="text-dim">{collapsed.has(file) ? "▸" : "▾"}</span>
              <span className="truncate" title={relTo(rootPath, file)}>{basename(file)}</span>
              <span className="text-dim">{items.length}</span>
              <button title="Clear file" onClick={(e) => { e.stopPropagation(); clearFile.mutate(file); }}
                className="ml-auto opacity-0 group-hover:opacity-100 text-dim hover:text-red-400">⌫</button>
            </div>
            {!collapsed.has(file) && items.map(b => <Row key={b.id} b={b} />)}
          </div>
        ))}
      </div>

      {menu && <FileContextMenu x={menu.x} y={menu.y} items={menuItems(menu.bm)} dismiss={() => setMenu(null)} />}
      {editing && (
        <LabelModal
          title={editing.label ? "Edit bookmark label" : "Add bookmark label"}
          initial={editing.label ?? ""}
          onConfirm={(label) => { update.mutate({ id: editing.id, patch: { label } }); setEditing(null); }}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}
