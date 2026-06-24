import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { EditorView } from "@codemirror/view";
import { useRoom } from "../store/room";
import { useBookmarks, neighborBookmark } from "./useBookmarks";
import { bookmarkGutter, setBookmarks, currentBookmarkLines } from "../lib/bookmarksGutter";
import { FileContextMenu, type FileMenuEntry } from "../components/Scm/FileContextMenu";
import { LabelModal } from "../components/Bookmarks/LabelModal";

const basename = (p: string) => p.split("/").pop() ?? p;

/**
 * Wires line-level bookmarks into one open file's CodeMirror editor: the blue-dot gutter, the
 * toggle/jump keybindings (⌘⌥K / ⌘⌥L / ⌘⌥J), the gutter context menu, and sticky-on-save line
 * reconcile. Returns the gutter `extension` to add at editor creation, the `menu` node to render,
 * and `reconcile` to call after a successful save.
 */
export function useEditorBookmarks(opts: {
  workspaceId: string;
  path: string;
  status: string;
  viewRef: MutableRefObject<EditorView | null>;
}) {
  const { workspaceId, path, status, viewRef } = opts;
  const { bookmarks, toggle, create, update, remove } = useBookmarks(workspaceId);
  const activeFile = useRoom(s => s.activeFile);
  const jumpToLine = useRoom(s => s.jumpToLine);

  const fileBookmarks = useMemo(() => bookmarks.filter(b => b.filePath === path), [bookmarks, path]);

  // Latest values for the stable (created-once) gutter/key handlers to read through.
  const refs = useRef({ bookmarks, fileBookmarks, activeFile, status });
  refs.current = { bookmarks, fileBookmarks, activeFile, status };

  const [menu, setMenu] = useState<{ line: number; x: number; y: number } | null>(null);
  const [labelFor, setLabelFor] = useState<{ mode: "create" | "edit"; line: number; id?: string; initial: string } | null>(null);

  const lineText = useCallback((line: number): string | null => {
    const v = viewRef.current;
    if (!v || line < 1 || line > v.state.doc.lines) return null;
    return v.state.doc.line(line).text.trim().slice(0, 200) || null;
  }, [viewRef]);

  const toggleAtLine = useCallback((line: number) => {
    toggle(path, line, lineText(line));
  }, [toggle, path, lineText]);

  const cursorLine = useCallback((): number => {
    const v = viewRef.current;
    return v ? v.state.doc.lineAt(v.state.selection.main.head).number : 1;
  }, [viewRef]);

  const jump = useCallback((dir: 1 | -1) => {
    const next = neighborBookmark(refs.current.bookmarks, { filePath: path, line: cursorLine() }, dir);
    if (next) jumpToLine({ path: next.filePath, name: basename(next.filePath) }, next.line);
  }, [path, cursorLine, jumpToLine]);

  // Stable gutter handlers (created once) that read the freshest callbacks via a ref.
  const apiRef = useRef({ toggle: toggleAtLine, context: (_l: number, _x: number, _y: number) => {} });
  apiRef.current.toggle = toggleAtLine;
  apiRef.current.context = (line, x, y) => setMenu({ line, x, y });
  const extension = useMemo(() => bookmarkGutter({
    onToggle: (l) => apiRef.current.toggle(l),
    onContext: (l, x, y) => apiRef.current.context(l, x, y),
  }), []);

  // Push this file's bookmarks into the gutter whenever the server set changes (add/remove/
  // reconcile). Keyed by id+line, which only changes from server data — never on local edits —
  // so live marker positions aren't clobbered while typing.
  const signature = fileBookmarks.map(b => `${b.id}:${b.line}`).join(",");
  useEffect(() => {
    const v = viewRef.current;
    if (!v || status !== "ready") return;
    v.dispatch({ effects: setBookmarks.of(fileBookmarks.map(b => ({ id: b.id, line: b.line }))) });
  }, [signature, status, viewRef]); // eslint-disable-line react-hooks/exhaustive-deps

  // ⌘⌥K toggle · ⌘⌥L next · ⌘⌥J previous — only for the active tab's editor. Uses e.code so the
  // macOS Alt dead-key transform doesn't matter. Capture phase to beat browser defaults.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (refs.current.activeFile !== path || refs.current.status !== "ready") return;
      if (!(e.metaKey || e.ctrlKey) || !e.altKey) return;
      if (e.code === "KeyK") { e.preventDefault(); e.stopPropagation(); toggleAtLine(cursorLine()); }
      else if (e.code === "KeyL") { e.preventDefault(); e.stopPropagation(); jump(1); }
      else if (e.code === "KeyJ") { e.preventDefault(); e.stopPropagation(); jump(-1); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [path, toggleAtLine, cursorLine, jump]);

  // After a save, persist any bookmark whose line drifted from edits so it stays put on reopen.
  // `update` is read through a ref so `reconcile` stays referentially stable — EditorView's
  // save() depends on it, and a changing identity would rebuild the whole editor.
  const updateRef = useRef(update);
  updateRef.current = update;
  const reconcile = useCallback(() => {
    const v = viewRef.current;
    if (!v) return;
    const live = currentBookmarkLines(v);
    for (const { id, line } of live) {
      const stored = refs.current.fileBookmarks.find(b => b.id === id);
      if (stored && stored.line !== line) updateRef.current.mutate({ id, patch: { line } });
    }
  }, [viewRef]);

  const existing = menu ? refs.current.fileBookmarks.find(b => b.line === menu.line) : undefined;
  const menuItems: FileMenuEntry[] = !menu ? [] : existing
    ? [
        { label: "Edit label…", onClick: () => setLabelFor({ mode: "edit", line: menu.line, id: existing.id, initial: existing.label ?? "" }) },
        { label: "Remove bookmark", onClick: () => remove.mutate(existing.id) },
      ]
    : [
        { label: "Add bookmark", onClick: () => toggleAtLine(menu.line) },
        { label: "Add labeled bookmark…", onClick: () => setLabelFor({ mode: "create", line: menu.line, initial: "" }) },
      ];

  const menuNode = (
    <>
      {menu && <FileContextMenu x={menu.x} y={menu.y} items={menuItems} dismiss={() => setMenu(null)} />}
      {labelFor && (
        <LabelModal
          title={labelFor.mode === "edit" ? "Edit bookmark label" : "Labeled bookmark"}
          initial={labelFor.initial}
          onConfirm={(label) => {
            if (labelFor.mode === "edit" && labelFor.id) update.mutate({ id: labelFor.id, patch: { label } });
            else create.mutate({ filePath: path, line: labelFor.line, label, preview: lineText(labelFor.line) });
            setLabelFor(null);
          }}
          onCancel={() => setLabelFor(null)}
        />
      )}
    </>
  );

  return { extension, menu: menuNode, reconcile };
}
