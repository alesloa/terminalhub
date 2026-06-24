import { useCallback, useEffect, useRef, useState, type CSSProperties, type TransitionEventHandler } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { EditorView as CMView, keymap } from "@codemirror/view";
import { EditorState, Compartment, Prec } from "@codemirror/state";
import { indentWithTab } from "@codemirror/commands";
import { search } from "@codemirror/search";
import { basicSetup } from "codemirror";
import { api } from "../../api/client";
import type { FsFile } from "../../api/types";
import { useToasts } from "../../store/toasts";
import { useDraggableWindow } from "../../hooks/useDraggableWindow";
import { useFileWatch } from "../../hooks/useFileWatch";
import { spacesBarBottom, type WinRect } from "../../store/ui";
import { editorTheme, loadLanguage } from "../../lib/codeMirror";
import { vscodeDark } from "../../lib/vscodeDark";
import { findHighlighter } from "../../lib/findInFile";
import { saveDraft, loadDraft, clearDraft } from "../../lib/editorDrafts";
import { ResizeHandles } from "../ResizeHandles";
import { FindWidget } from "../Editor/FindWidget";
import { refKey, type Ref } from "./ref";

const MIN_W = 420, MIN_H = 280;
const DURATION = 240; // ms — grow-from-row / shrink-to-row, matching Quick Look

// The two things an editable file resolves to: a host path, or a Drive (account, fileId). Account
// nodes / Drive folders (no fileId) aren't editable and never reach here.
type EditTarget =
  | { kind: "host"; path: string }
  | { kind: "drive"; accountId: string; fileId: string };

export function editTargetOf(ref_: Ref): EditTarget | null {
  if (ref_.kind === "host") return { kind: "host", path: ref_.path };
  if (ref_.fileId) return { kind: "drive", accountId: ref_.accountId, fileId: ref_.fileId };
  return null;
}

type Status = "loading" | "ready" | "binary" | "toolarge" | "error";

/**
 * The File Browser's real editor: a free-floating, draggable/resizable window that grows out of the
 * file's row and minimizes back into it on close. Unlike Quick Look (preview-only), this is a full
 * CodeMirror code editor — syntax highlighting per the file's language, ⌘/Ctrl-S to save, a dirty
 * dot, and the same VS Code-style find / find-&-replace widget the workspace editor uses
 * (⌘/Ctrl-F find; ⌘/Ctrl-Alt-F or Ctrl-H replace). Works for BOTH host files (api.fs*) and regular
 * Drive files (api.drive* read/write the same file id). Binary / too-large files report instead of
 * opening. Closing with unsaved edits prompts Save / Don't Save / Cancel (Notepad-style) so changes
 * are never silently dropped — and never silently written either.
 */
export function FileEditorWindow({ ref_, name, origin, onClose }:
  { ref_: Ref; name: string; origin: WinRect; onClose: () => void }) {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const target = editTargetOf(ref_);
  const draftK = refKey(ref_); // stable per open — keys this file's hot-exit draft

  const hostRef = useRef<HTMLDivElement>(null);
  const winRef = useRef<HTMLDivElement>(null); // the window chrome — scopes the find shortcut to this editor
  const viewRef = useRef<CMView | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [docRev, setDocRev] = useState(0); // bumps on every doc change so the find widget recomputes matches
  const [askClose, setAskClose] = useState(false); // unsaved-changes prompt is showing

  // Find / find-&-replace widget (reused from the workspace editor). `seedNonce` bumps on every
  // open so an already-open widget refocuses; `findSeed` prefills it with a single-line selection.
  const [findOpen, setFindOpen] = useState(false);
  const [findSeed, setFindSeed] = useState("");
  const [seedNonce, setSeedNonce] = useState(0);
  const [findWithReplace, setFindWithReplace] = useState(false);
  const openFindRef = useRef((_withReplace: boolean) => {});
  openFindRef.current = (withReplace: boolean) => {
    if (!findOpen) {
      const view = viewRef.current;
      let seed = "";
      if (view) {
        const sel = view.state.selection.main;
        const text = view.state.sliceDoc(sel.from, sel.to);
        if (text && !text.includes("\n")) seed = text;
      }
      setFindSeed(seed);
    } else setFindSeed(""); // already open → refocus without clobbering the current query
    setFindWithReplace(withReplace);
    setSeedNonce((n) => n + 1);
    setFindOpen(true);
  };
  // Live disk-change state. `dirtyRef` mirrors `dirty` for the watch callback (no stale closure);
  // `externalApply` suppresses the dirty flag while WE swap in disk content; `pendingDisk` holds the
  // new disk text for a conflict's Reload; `conflict` drives the banner when disk changes under edits.
  const dirtyRef = useRef(false);
  const externalApply = useRef(false);
  const pendingDisk = useRef<string | null>(null);
  const [conflict, setConflict] = useState<{ kind: "changed" | "removed" } | null>(null);

  const reduce = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [expanded, setExpanded] = useState(reduce);

  // A comfortable, centered default; the user can drag/resize from there. Clamped below the spaces bar.
  const [seedRect] = useState<WinRect>(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.min(1000, Math.round(vw * 0.7));
    const h = Math.min(720, Math.round(vh * 0.78));
    return { w, h, x: Math.max(8, Math.round((vw - w) / 2)), y: Math.max(spacesBarBottom() + 8, Math.round((vh - h) / 2)) };
  });
  const { rect, beginDrag, beginResize } = useDraggableWindow(seedRect, MIN_W, MIN_H);

  // Save the current doc back to wherever the file lives, then refresh listings so size/mtime catch up.
  const save = useCallback(async () => {
    const view = viewRef.current;
    if (!view || !target) return;
    setSaving(true);
    try {
      const doc = view.state.doc.toString();
      if (target.kind === "host") await api.fsWriteFile(target.path, doc);
      else await api.driveWriteText(target.accountId, target.fileId, doc);
      setDirty(false); dirtyRef.current = false;
      clearDraft(draftK); // it's on disk now — drop the hot-exit backup
      setConflict(null); // our write IS the disk now — any pending conflict is resolved
      qc.invalidateQueries({ queryKey: ["fb-list"] });
      qc.invalidateQueries({ queryKey: ["fs"] });
    } catch (e) {
      push(`Save failed: ${(e as Error).message}`);
      throw e;
    } finally {
      setSaving(false);
    }
  }, [target, qc, push, draftK]);

  // Swap the editor buffer to `text` from disk, preserving the cursor, WITHOUT marking dirty.
  const applyExternal = useCallback((text: string) => {
    const view = viewRef.current;
    if (!view) return;
    externalApply.current = true;
    const head = Math.min(view.state.selection.main.head, text.length);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: head } });
    externalApply.current = false;
    setDirty(false); dirtyRef.current = false;
    clearDraft(draftK); // buffer now matches disk — no draft to keep
    pendingDisk.current = null;
    setConflict(null);
  }, [draftK]);

  // The file changed on disk (host only). Refetch and reconcile: identical content (e.g. the echo of
  // our own save) is a no-op; otherwise reload live when the buffer is clean, or — to never clobber
  // unsaved edits — raise a conflict banner letting the user choose Reload vs Keep mine.
  const onDiskChange = useCallback(async (event: "changed" | "removed") => {
    if (!viewRef.current || target?.kind !== "host") return;
    if (event === "removed") { setConflict({ kind: "removed" }); return; }
    let f: FsFile;
    try { f = await api.fsReadFile(target.path); } catch { return; }
    if (f.binary || f.tooLarge || f.content == null) return;
    const next = f.content;
    if (next === viewRef.current.state.doc.toString()) { setConflict(null); return; }
    if (dirtyRef.current) { pendingDisk.current = next; setConflict({ kind: "changed" }); return; }
    applyExternal(next);
  }, [target, applyExternal]);

  useFileWatch(target?.kind === "host" ? target.path : null, onDiskChange);

  // ⌘/Ctrl-F = find, ⌘/Ctrl-Alt-F or Ctrl-H = find + replace. Capture phase so it beats the
  // browser's native find and CodeMirror's own search keymap. Scoped to THIS window (only fires
  // when focus is inside it) so it never steals the shortcut from a workspace editor behind it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (status !== "ready" || askClose) return;
      if (!winRef.current?.contains(document.activeElement)) return;
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
  }, [status, askClose]);

  // Grow-from-row on open.
  useEffect(() => {
    if (reduce) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setExpanded(true)));
    return () => cancelAnimationFrame(id);
  }, [reduce]);

  // Start the minimize-to-row animation (or close immediately under reduced-motion).
  const collapse = () => { if (reduce) { onClose(); return; } setExpanded(false); };
  // Close: with unsaved edits, ask Save / Don't Save / Cancel (Notepad-style) instead of silently
  // saving or silently discarding. Clean buffer → just close.
  const handleClose = () => { if (dirty) { setAskClose(true); return; } collapse(); };
  const saveAndClose = async () => {
    try { await save(); } catch { setAskClose(false); return; } // save failed (toast shown) → leave the window open
    setAskClose(false); collapse();
  };
  const discardAndClose = () => {
    setDirty(false); dirtyRef.current = false; // stop the hot-exit flush from re-stashing it
    clearDraft(draftK);
    setAskClose(false); collapse();
  };
  const onTransitionEnd: TransitionEventHandler = (e) => {
    if (e.target === e.currentTarget && e.propertyName === "transform" && !expanded) onClose();
  };

  // Build the editor once content loads. ⌘/Ctrl-S saves; basicSetup brings find (⌘/Ctrl-F), folding,
  // history, etc. Language support loads async then reconfigures so highlighting matches the file.
  useEffect(() => {
    if (!target) { setStatus("error"); return; }
    let disposed = false;
    const langComp = new Compartment();

    const load = async (): Promise<{ content: string } | { fail: Status }> => {
      if (target.kind === "host") {
        const f: FsFile = await api.fsReadFile(target.path);
        if (f.binary) return { fail: "binary" };
        if (f.tooLarge) return { fail: "toolarge" };
        return { content: f.content ?? "" };
      }
      return { content: await api.driveReadText(target.accountId, target.fileId) };
    };

    load().then(async (res) => {
      if (disposed) return;
      if ("fail" in res) { setStatus(res.fail); return; }

      // Hot-exit restore: if a saved draft differs from disk, open that (dirty) instead; if it matches
      // disk it's stale, so drop it. So a File-Browser-close / refresh resumes exactly where you left off.
      const disk = res.content;
      const draft = loadDraft(draftK);
      const restored = draft != null && draft !== disk;
      if (draft != null && !restored) clearDraft(draftK);

      const saveKeymap = Prec.highest(keymap.of([{ key: "Mod-s", run: () => { void save(); return true; } }]));
      const view = new CMView({
        parent: hostRef.current!,
        state: EditorState.create({
          doc: restored ? draft! : disk,
          extensions: [
            basicSetup,
            keymap.of([indentWithTab]),
            saveKeymap,
            search({ top: true }),
            findHighlighter,
            vscodeDark,
            editorTheme,
            langComp.of([]),
            CMView.updateListener.of((u) => {
              if (!u.docChanged) return;
              if (!externalApply.current) { setDirty(true); dirtyRef.current = true; }
              setDocRev((r) => r + 1); // refresh find matches (covers disk reloads too)
            }),
          ],
        }),
      });
      viewRef.current = view;
      if (restored) { setDirty(true); dirtyRef.current = true; push("Restored unsaved changes"); }
      setStatus("ready");
      view.focus();

      const support = await loadLanguage(name);
      if (support && !disposed && viewRef.current) view.dispatch({ effects: langComp.reconfigure(support) });
    }).catch(() => { if (!disposed) setStatus("error"); });

    return () => { disposed = true; viewRef.current?.destroy(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]); // target is stable for a given open; re-mount the window to edit a different file

  // Hot-exit backup: stash the dirty buffer to a local draft shortly after each edit, so closing the
  // File Browser (or a refresh) never loses it. Debounced; cleared on Save / Don't Save / disk-match.
  useEffect(() => {
    if (status !== "ready" || !dirty) return;
    const id = window.setTimeout(() => {
      if (dirtyRef.current && viewRef.current) saveDraft(draftK, viewRef.current.state.doc.toString());
    }, 600);
    return () => window.clearTimeout(id);
  }, [docRev, dirty, status, draftK]);

  // Catch the case where the window unmounts before the debounce fires (the File Browser is closed
  // while editing): flush the still-dirty buffer so it's there on the next open.
  useEffect(() => {
    return () => { if (dirtyRef.current && viewRef.current) saveDraft(draftK, viewRef.current.state.doc.toString()); };
  }, [draftK]);

  const collapsed = `translate(${origin.x - rect.x}px, ${origin.y - rect.y}px) scale(${origin.w / rect.w}, ${origin.h / rect.h})`;
  const style: CSSProperties = {
    left: rect.x, top: rect.y, width: rect.w, height: rect.h,
    ...(reduce ? {} : {
      transformOrigin: "0 0",
      transform: expanded ? "translate(0px, 0px) scale(1, 1)" : collapsed,
      opacity: expanded ? 1 : 0,
      transition: `transform ${DURATION}ms cubic-bezier(.22,.61,.36,1), opacity ${DURATION}ms ease`,
      willChange: "transform, opacity",
    }),
  };

  const body = () => {
    if (status === "loading") return <Centered>Loading…</Centered>;
    if (status === "binary") return <Centered>Binary file — can’t edit as text.</Centered>;
    if (status === "toolarge") return <Centered>File is too large to open in the editor.</Centered>;
    if (status === "error") return <Centered>Couldn’t open this file.</Centered>;
    return null;
  };

  return (
   <>
    <div className="fixed inset-0 z-[60]">
      {/* A faint backdrop marks the editor as focused; clicking it does NOT close (an editor
          shouldn't vanish on a stray click) — the ✕ / ⌘S are the way out. */}
      <div className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${expanded ? "opacity-100" : "opacity-0"}`} />
      <div ref={winRef} onTransitionEnd={onTransitionEnd} style={style}
        className="fixed flex flex-col rounded-xl overflow-hidden border border-edge-strong bg-canvas shadow-2xl">
        <div onPointerDown={beginDrag}
          className="h-9 shrink-0 flex items-center gap-2 px-3 border-b border-edge cursor-move select-none">
          <span className="flex-1 min-w-0 truncate text-sm font-medium">
            {name}{dirty ? " •" : ""}
          </span>
          <div className="flex items-center gap-2" onPointerDown={(e) => e.stopPropagation()}>
            <button onClick={() => void save()} disabled={!dirty || saving || status !== "ready"}
              title="Save (⌘/Ctrl-S)"
              className="px-2 h-6 inline-flex items-center bg-elevated hover:bg-edge rounded text-xs disabled:opacity-40">
              {saving ? "Saving…" : "Save"}
            </button>
            <button onClick={() => void handleClose()} title="Close"
              className="px-2 h-6 inline-flex items-center bg-elevated hover:bg-edge rounded text-xs">✕</button>
          </div>
        </div>
        <div className="flex-1 min-h-0 relative">
          {conflict && status === "ready" && (
            <div className="absolute top-0 inset-x-0 z-10 flex items-center gap-2 px-3 py-1.5 text-xs bg-amber-500/15 border-b border-amber-500/40 text-amber-200">
              {conflict.kind === "changed" ? (
                <>
                  <span className="flex-1 min-w-0">This file changed on disk while you have unsaved edits.</span>
                  <button onClick={() => { if (pendingDisk.current != null) applyExternal(pendingDisk.current); }}
                    className="px-2 h-6 inline-flex items-center bg-elevated hover:bg-edge rounded">Reload</button>
                  <button onClick={() => setConflict(null)}
                    className="px-2 h-6 inline-flex items-center bg-elevated hover:bg-edge rounded">Keep mine</button>
                </>
              ) : (
                <>
                  <span className="flex-1 min-w-0">This file was deleted on disk.</span>
                  <button onClick={() => void save().then(() => setConflict(null)).catch(() => {})}
                    className="px-2 h-6 inline-flex items-center bg-elevated hover:bg-edge rounded">Save to recreate</button>
                  <button onClick={() => setConflict(null)}
                    className="px-2 h-6 inline-flex items-center bg-elevated hover:bg-edge rounded">Dismiss</button>
                </>
              )}
            </div>
          )}
          <div ref={hostRef} className={status === "ready" ? "h-full" : "hidden"} />
          {body()}
          {findOpen && status === "ready" && (
            <FindWidget view={viewRef.current} docRevision={docRev} seed={findSeed}
              seedNonce={seedNonce} openWithReplace={findWithReplace} minimap={false}
              onClose={() => setFindOpen(false)} />
          )}
        </div>
        <ResizeHandles onStart={beginResize} />
      </div>
    </div>
    {askClose && (
      <UnsavedDialog name={name} onSave={() => void saveAndClose()} onDiscard={discardAndClose} onCancel={() => setAskClose(false)} />
    )}
   </>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="h-full flex items-center justify-center text-dim text-sm">{children}</div>;
}

/** Notepad-style unsaved-changes prompt on close: Save (default/Enter) · Don't Save · Cancel (Esc). */
function UnsavedDialog({ name, onSave, onDiscard, onCancel }:
  { name: string; onSave: () => void; onDiscard: () => void; onCancel: () => void }) {
  const saveRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    saveRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      else if (e.key === "Enter") { e.preventDefault(); onSave(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onSave, onCancel]);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80]" onMouseDown={onCancel}>
      <div className="relative bg-panel w-[420px] rounded-lg p-5 flex flex-col gap-3 border border-edge"
        onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="text-lg">Save changes?</h2>
        <p className="text-sm text-muted whitespace-pre-line">“{name}” has unsaved changes. Save them before closing?</p>
        <div className="flex justify-end gap-2 mt-2">
          <button onClick={onDiscard} className="px-3 py-1.5 bg-elevated rounded hover:bg-edge">Don’t Save</button>
          <button onClick={onCancel} className="px-3 py-1.5 bg-elevated rounded hover:bg-edge">Cancel</button>
          <button ref={saveRef} onClick={onSave} className="px-3 py-1.5 rounded text-white bg-blue-600 hover:bg-blue-500">Save</button>
        </div>
      </div>
    </div>
  );
}
