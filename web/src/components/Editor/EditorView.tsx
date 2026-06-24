import { useCallback, useEffect, useRef, useState } from "react";
import { EditorView as CMView, keymap } from "@codemirror/view";
import { EditorState, Compartment, Prec } from "@codemirror/state";
import { indentWithTab } from "@codemirror/commands";
import { search } from "@codemirror/search";
import { basicSetup } from "codemirror";
import { api } from "../../api/client";
import type { FsFile } from "../../api/types";
import { useRoom } from "../../store/room";
import { useUi } from "../../store/ui";
import { useToasts } from "../../store/toasts";
import { editorTheme, loadLanguage, minimapExt, languageIdFor } from "../../lib/codeMirror";
import { vscodeDark } from "../../lib/vscodeDark";
import { findHighlighter } from "../../lib/findInFile";
import { betterCommentsExtension } from "../../lib/betterComments";
import { useEditorBookmarks } from "../../hooks/useEditorBookmarks";
import { useFileLanguageServer } from "../../hooks/useLanguageServers";
import { acquireLspClient, releaseLspClient } from "../../lib/lsp/client";
import { lspEditorExtension } from "../../lib/lsp/extensions";
import { pathToFileUri, isExternalTo } from "../../lib/lsp/uri";
import { FindWidget } from "./FindWidget";

// basicSetup bakes in the line-number gutter, so we toggle it by hiding that one gutter
// rather than fighting the bundle. Other gutters (fold) stay.
const hideLineNumbers = CMView.theme({ ".cm-lineNumbers": { display: "none" } });

export function FileEditor({ path, name, rootPath, readOnly }: { path: string; name: string; rootPath: string; readOnly?: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<CMView | null>(null);
  const setDirty = useRoom(s => s.setDirty);
  const setDocumentContent = useRoom(s => s.setDocumentContent);
  const liveContent = useRoom(s => s.documentContents[path]);
  const dirty = useRoom(s => s.dirtyFiles.has(path));
  const activeFile = useRoom(s => s.activeFile);
  const workspaceId = useRoom(s => s.workspaceId);
  const pendingJump = useRoom(s => s.pendingJump);
  const clearPendingJump = useRoom(s => s.clearPendingJump);
  const openFile = useRoom(s => s.openFile);
  const jumpToPosition = useRoom(s => s.jumpToPosition);
  const recordNav = useRoom(s => s.recordNav);
  const pushToast = useToasts(s => s.push);
  // The installed language server for this file's language (or null), and a toast if it's missing.
  const lspServer = useFileLanguageServer(name);
  const minimap = useUi(s => s.minimap);
  const wordWrap = useUi(s => s.wordWrap);
  const lineNumbers = useUi(s => s.lineNumbers);
  const autoSave = useUi(s => s.autoSave);
  const autoSaveDelaySeconds = useUi(s => s.autoSaveDelaySeconds);
  const betterComments = useUi(s => s.betterComments);
  const [status, setStatus] = useState<"loading" | "ready" | "binary" | "toolarge" | "error">("loading");
  const [saving, setSaving] = useState(false);

  // Line-level bookmarks: the gutter extension, its context menu, and sticky-on-save reconcile.
  const bookmarks = useEditorBookmarks({ workspaceId, path, status, viewRef });

  // Find-in-file widget (Ctrl/Cmd+F). `seedNonce` bumps on every open so an already-open
  // widget refocuses; `findSeed` carries a single-line selection to prefill the input with.
  const [findOpen, setFindOpen] = useState(false);
  const [findSeed, setFindSeed] = useState("");
  const [seedNonce, setSeedNonce] = useState(0);
  const [findWithReplace, setFindWithReplace] = useState(false);
  const openFindRef = useRef((_withReplace: boolean) => {});
  openFindRef.current = (withReplace: boolean) => {
    // Already open → just refocus the input (don't clobber what the user is typing).
    if (!findOpen) {
      const view = viewRef.current;
      let seed = "";
      if (view) {
        const sel = view.state.selection.main;
        const text = view.state.sliceDoc(sel.from, sel.to);
        if (text && !text.includes("\n")) seed = text;
      }
      setFindSeed(seed);
    } else {
      setFindSeed("");
    }
    setFindWithReplace(withReplace);
    setSeedNonce(n => n + 1);
    setFindOpen(true);
  };

  // Ctrl/Cmd+F = find, Ctrl/Cmd+Alt+F or Ctrl+H = find + replace. Works for whichever file
  // editor is active, regardless of where focus sits (capture phase, so it beats the browser's
  // native find and CodeMirror's own search keymap). Only the active tab's editor responds.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (activeFile !== path || status !== "ready") return;
      const k = e.key.toLowerCase();
      const mod = e.metaKey || e.ctrlKey;
      let wantReplace: boolean;
      if (k === "f" && mod && !e.shiftKey) wantReplace = e.altKey;
      else if (k === "h" && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) wantReplace = true;
      else return;
      e.preventDefault();
      e.stopPropagation();
      openFindRef.current(wantReplace);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [activeFile, path, status]);

  // Compartments persist across the editor's lifetime so a view-option toggle reconfigures
  // the running view instead of rebuilding it (which would refetch the file and lose the cursor).
  const minimapComp = useRef(new Compartment());
  const wrapComp = useRef(new Compartment());
  const lineNumComp = useRef(new Compartment());
  const commentComp = useRef(new Compartment());
  const lspComp = useRef(new Compartment());

  const save = useCallback(async () => {
    const view = viewRef.current;
    if (!view || readOnly) return; // read-only tabs (library/node_modules go-to-def targets) never write back
    setSaving(true);
    try {
      await api.fsWriteFile(path, view.state.doc.toString());
      setDirty(path, false);
      bookmarks.reconcile(); // persist any bookmark lines that drifted from edits
    } finally {
      setSaving(false);
    }
  }, [path, setDirty, bookmarks.reconcile, readOnly]);

  useEffect(() => {
    let disposed = false;
    const langComp = new Compartment();

    api.fsReadFile(path).then(async (file: FsFile) => {
      if (disposed) return;
      if (file.binary) { setStatus("binary"); return; }
      if (file.tooLarge) { setStatus("toolarge"); return; }
      setDocumentContent(path, file.content ?? "");

      const saveKeymap = Prec.highest(keymap.of([{
        key: "Mod-s",
        run: () => { void save(); return true; },
      }]));

      const view = new CMView({
        parent: hostRef.current!,
        state: EditorState.create({
          doc: file.content ?? "",
          extensions: [
            basicSetup,
            keymap.of([indentWithTab]),
            saveKeymap,
            search({ top: true }),
            findHighlighter,
            bookmarks.extension,
            vscodeDark,
            editorTheme,
            langComp.of([]),
            lspComp.current.of([]), // reconfigured post-mount with the LSP plugin + go-to-def input
            // Read-only tabs: go-to-def jumps into library/node_modules files mustn't be editable.
            ...(readOnly ? [EditorState.readOnly.of(true), CMView.editable.of(false)] : []),
            minimapComp.current.of(minimapExt(minimap)),
            wrapComp.current.of(wordWrap ? CMView.lineWrapping : []),
            lineNumComp.current.of(lineNumbers ? [] : hideLineNumbers),
            commentComp.current.of(betterCommentsExtension(betterComments)),
            CMView.updateListener.of(u => {
              if (!u.docChanged) return;
              setDirty(path, true);
              setDocumentContent(path, u.state.doc.toString());
            }),
          ],
        }),
      });
      viewRef.current = view;
      setStatus("ready");

      const support = await loadLanguage(name);
      if (support && !disposed && viewRef.current) view.dispatch({ effects: langComp.reconfigure(support) });
    }).catch(() => { if (!disposed) setStatus("error"); });

    return () => { disposed = true; viewRef.current?.destroy(); viewRef.current = null; };
  }, [path, name, save, setDirty, setDocumentContent, bookmarks.extension, readOnly]);

  // Wire the language server once the editor is ready AND we know its (installed) server — the server
  // list arrives async, so this is separate from view creation. One LSPClient is shared per
  // (workspace, languageId); we reconfigure lspComp with this file's plugin + the go-to-def input.
  // Cleanup clears the compartment and releases the (refcounted) client.
  useEffect(() => {
    if (status !== "ready" || !lspServer || !workspaceId || !rootPath) return;
    const languageId = languageIdFor(name);
    const view = viewRef.current;
    if (!languageId || !view) return;

    const client = acquireLspClient(workspaceId, languageId, rootPath);
    view.dispatch({ effects: lspComp.current.reconfigure(lspEditorExtension({
      client,
      uri: pathToFileUri(path),
      languageId,
      // A definition target opens in its own tab — read-only when it's outside the workspace (a
      // library / node_modules file) — then we jump to the exact line:col. Record the spot we
      // jumped FROM first, so the Back button returns to it.
      onNavigate: (t, sourcePos) => {
        const v = viewRef.current;
        if (v) {
          const ln = v.state.doc.lineAt(sourcePos);
          recordNav({ path, name, line: ln.number, col: sourcePos - ln.from });
        }
        openFile({ path: t.path, name: t.name, kind: "file", readOnly: isExternalTo(t.path, rootPath) });
        jumpToPosition({ path: t.path, name: t.name }, t.line, t.col);
      },
      onNoDefinition: () => pushToast("No definition found", { level: "info" }),
    })) });

    return () => {
      if (viewRef.current) viewRef.current.dispatch({ effects: lspComp.current.reconfigure([]) });
      releaseLspClient(workspaceId, languageId);
    };
  }, [status, lspServer, workspaceId, rootPath, path, name, openFile, jumpToPosition, recordNav, pushToast]);

  // Bookmark navigation / panel clicks / go-to-def ask this tab to scroll to a line (+ optional
  // column). Consume the request once the matching editor is ready: center + select the position,
  // then clear pendingJump.
  useEffect(() => {
    if (!pendingJump || pendingJump.path !== path || status !== "ready") return;
    const view = viewRef.current;
    if (!view) return;
    const lineNo = Math.min(Math.max(1, pendingJump.line), view.state.doc.lines);
    const line = view.state.doc.line(lineNo);
    const pos = pendingJump.col != null ? Math.min(line.from + pendingJump.col, line.to) : line.from;
    view.dispatch({ selection: { anchor: pos }, effects: CMView.scrollIntoView(pos, { y: "center" }) });
    view.focus();
    clearPendingJump();
  }, [pendingJump, path, status, clearPendingJump]);

  useEffect(() => {
    if (!autoSave || !dirty || status !== "ready") return;
    const id = window.setTimeout(() => { void save(); }, autoSaveDelaySeconds * 1000);
    return () => window.clearTimeout(id);
  }, [autoSave, autoSaveDelaySeconds, dirty, liveContent, save, status]);

  // The minimap only repaints on doc/scroll updates — never on resize. So if this editor was
  // hidden (a background tab → 0 height) when it last rendered, its canvas is blank and stays
  // blank when shown again. Re-dispatch on any size change so it repaints at the real height
  // (also fixes a stale minimap after a window resize).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let lastH = 0;
    const ro = new ResizeObserver(() => {
      const h = host.clientHeight;
      if (h > 0 && h !== lastH) { lastH = h; viewRef.current?.dispatch({}); }
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  // Flip the minimap / word-wrap on the live view when the global preference changes.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: minimapComp.current.reconfigure(minimapExt(minimap)) });
  }, [minimap]);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: wrapComp.current.reconfigure(wordWrap ? CMView.lineWrapping : []) });
  }, [wordWrap]);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: lineNumComp.current.reconfigure(lineNumbers ? [] : hideLineNumbers) });
  }, [lineNumbers]);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: commentComp.current.reconfigure(betterCommentsExtension(betterComments)) });
  }, [betterComments]);

  // Keep a source editor tab in sync when the Markdown editor tab changes the same file.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || liveContent === undefined) return;
    const current = view.state.doc.toString();
    if (current === liveContent) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: liveContent } });
  }, [liveContent]);

  if (status === "binary" || status === "toolarge" || status === "error") {
    const msg = status === "binary" ? "Binary file — can’t edit here."
      : status === "toolarge" ? "File is too large to open in the editor."
      : "Couldn’t read this file.";
    return <div className="h-full flex items-center justify-center text-dim text-sm">{msg}</div>;
  }

  return (
    <div className="h-full relative">
      {saving && <div className="absolute top-1 right-2 text-xs text-dim z-10">saving…</div>}
      <div ref={hostRef} className="h-full" />
      {bookmarks.menu}
      {findOpen && (
        <FindWidget
          view={viewRef.current}
          docRevision={liveContent}
          seed={findSeed}
          seedNonce={seedNonce}
          openWithReplace={findWithReplace}
          minimap={minimap}
          onClose={() => setFindOpen(false)}
        />
      )}
    </div>
  );
}
