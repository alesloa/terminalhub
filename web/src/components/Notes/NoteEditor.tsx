import { useEffect, useMemo, useRef, useState } from "react";
import type { Note } from "../../api/types";

const SAVE_DELAY = 700; // debounce (ms) after the last keystroke before persisting

type SaveStatus = "saved" | "unsaved" | "saving";

/** All start indices of a literal `needle` in `hay` (overlap-free), case-folded when asked. */
function findAll(hay: string, needle: string, caseSensitive: boolean): number[] {
  if (!needle) return [];
  const h = caseSensitive ? hay : hay.toLowerCase();
  const n = caseSensitive ? needle : needle.toLowerCase();
  const out: number[] = [];
  let i = h.indexOf(n);
  while (i !== -1) { out.push(i); i = h.indexOf(n, i + n.length); }
  return out;
}

/**
 * The right pane: a title field + a free-form textarea, with a toggleable find/replace bar.
 * Edits autosave to the server after a quiet period and flush on unmount (note switch / close),
 * so nothing is lost. Mount this keyed by note.id so switching notes resets the draft cleanly.
 * `onRegisterInsert` lets the window title bar's mic drop transcribed speech into this textarea.
 */
export function NoteEditor({ note, onSave, onRegisterInsert }: {
  note: Note;
  onSave: (id: string, patch: { title?: string; content?: string }) => Promise<Note>;
  onRegisterInsert?: (insert: ((text: string) => void) | null) => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [status, setStatus] = useState<SaveStatus>("saved");

  const [showFind, setShowFind] = useState(false);
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [cur, setCur] = useState(0);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const dirty = useRef(false);
  const latest = useRef({ title, content });
  latest.current = { title, content };

  const flush = () => {
    if (!dirty.current) return;
    dirty.current = false;
    setStatus("saving");
    onSave(note.id, { ...latest.current }).then(() => setStatus("saved")).catch(() => setStatus("unsaved"));
  };
  // Keep the unmount cleanup pointed at the freshest flush (captures the current note + draft).
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => { window.clearTimeout(timer.current); flushRef.current(); }, []);

  const markDirty = () => {
    dirty.current = true;
    setStatus("unsaved");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_DELAY);
  };

  // Insert text at the caret (replacing any selection), then drop the caret after it. Used by the
  // window's mic to inject dictated speech. Reads the live draft + textarea via refs so a single
  // stable function registered once stays correct as the content changes.
  const insertAtCursor = (text: string) => {
    const ta = taRef.current;
    const cur = latest.current.content;
    const start = ta?.selectionStart ?? cur.length;
    const end = ta?.selectionEnd ?? cur.length;
    setContent(cur.slice(0, start) + text + cur.slice(end));
    markDirty();
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      const pos = start + text.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };
  const insertRef = useRef(insertAtCursor);
  insertRef.current = insertAtCursor;
  // Register a stable wrapper (the ref indirection keeps it current) for this note's lifetime;
  // clear it on unmount so the mic disables when no note is open.
  useEffect(() => {
    if (!onRegisterInsert) return;
    onRegisterInsert((t: string) => insertRef.current(t));
    return () => onRegisterInsert(null);
  }, [onRegisterInsert]);

  const matches = useMemo(() => findAll(content, find, caseSensitive), [content, find, caseSensitive]);
  // Keep the active-match index in range as matches change (edits, replace-all, toggles).
  useEffect(() => { if (cur >= matches.length) setCur(matches.length ? matches.length - 1 : 0); }, [matches.length, cur]);

  // Jump the textarea selection to match #i (wraps). Imperative — only on explicit navigation,
  // never on every find-box keystroke, so typing in the find field doesn't steal focus.
  const selectMatch = (i: number) => {
    const ta = taRef.current;
    const ms = findAll(content, find, caseSensitive);
    if (!ta || !ms.length) return;
    const idx = ((i % ms.length) + ms.length) % ms.length;
    setCur(idx);
    const s = ms[idx];
    ta.focus();
    ta.setSelectionRange(s, s + find.length);
  };

  const doReplace = () => {
    const ms = findAll(content, find, caseSensitive);
    if (!ms.length) return;
    const idx = Math.min(cur, ms.length - 1);
    const s = ms[idx];
    setContent(content.slice(0, s) + replace + content.slice(s + find.length));
    markDirty();
  };
  const doReplaceAll = () => {
    const ms = findAll(content, find, caseSensitive);
    if (!ms.length) return;
    let out = ""; let prev = 0;
    for (const m of ms) { out += content.slice(prev, m) + replace; prev = m + find.length; }
    out += content.slice(prev);
    setContent(out);
    setCur(0);
    markDirty();
  };

  const openFind = () => { setShowFind(true); setTimeout(() => findRef.current?.select(), 0); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") { e.preventDefault(); openFind(); }
  };

  const matchLabel = matches.length ? `${Math.min(cur, matches.length - 1) + 1}/${matches.length}` : (find ? "0/0" : "");

  return (
    <div className="flex-1 min-w-0 flex flex-col" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-2 px-4 py-2 border-b border-surface">
        <input value={title} onChange={(e) => { setTitle(e.target.value); markDirty(); }} placeholder="Untitled note"
          className="flex-1 min-w-0 bg-transparent outline-none text-sm font-medium placeholder:text-dim" />
        <button onClick={openFind} title="Find & replace (⌘F)"
          className="shrink-0 px-2 py-1 bg-elevated hover:bg-edge rounded text-xs text-fg">Find</button>
        <span className="shrink-0 w-16 text-right text-xs text-dim">
          {status === "saving" ? "Saving…" : status === "unsaved" ? "Unsaved" : "Saved"}
        </span>
      </div>

      {showFind && (
        // VS Code-style two-row find/replace. A 1fr/auto grid keeps both inputs the same width and
        // left-aligned, with controls in the right column — so it shrinks with the pane and never wraps.
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5 px-4 py-2 bg-code border-b border-surface text-xs">
          {/* Find row: input + count, nav, match-case, close */}
          <input ref={findRef} value={find} onChange={(e) => setFind(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); selectMatch(e.shiftKey ? cur - 1 : cur + 1); } if (e.key === "Escape") setShowFind(false); }}
            placeholder="Find" autoFocus
            className="min-w-0 px-2 py-1 bg-panel border border-edge rounded outline-none" />
          <div className="flex items-center gap-1 shrink-0">
            <span className="px-1 text-dim tabular-nums whitespace-nowrap">{matchLabel}</span>
            <button onClick={() => selectMatch(cur - 1)} disabled={!matches.length} title="Previous (⇧⏎)"
              className="shrink-0 px-1.5 py-1 bg-elevated hover:bg-edge rounded disabled:opacity-40">↑</button>
            <button onClick={() => selectMatch(cur + 1)} disabled={!matches.length} title="Next (⏎)"
              className="shrink-0 px-1.5 py-1 bg-elevated hover:bg-edge rounded disabled:opacity-40">↓</button>
            <button onClick={() => setCaseSensitive((v) => !v)} title="Match case"
              className={`shrink-0 px-1.5 py-1 rounded ${caseSensitive ? "bg-blue-600 text-white" : "bg-elevated hover:bg-edge"}`}>Aa</button>
            <button onClick={() => setShowFind(false)} title="Close (Esc)"
              className="shrink-0 px-1.5 py-1 text-dim hover:text-fg">✕</button>
          </div>

          {/* Replace row: input + replace / replace-all, right-aligned under the find controls */}
          <input value={replace} onChange={(e) => setReplace(e.target.value)} placeholder="Replace"
            onKeyDown={(e) => { if (e.key === "Escape") setShowFind(false); }}
            className="min-w-0 px-2 py-1 bg-panel border border-edge rounded outline-none" />
          <div className="flex items-center gap-1 shrink-0 justify-self-end">
            <button onClick={doReplace} disabled={!matches.length} title="Replace"
              className="shrink-0 px-2 py-1 bg-elevated hover:bg-edge rounded disabled:opacity-40">Replace</button>
            <button onClick={doReplaceAll} disabled={!matches.length} title="Replace all"
              className="shrink-0 px-2 py-1 bg-elevated hover:bg-edge rounded disabled:opacity-40">All</button>
          </div>
        </div>
      )}

      <textarea ref={taRef} value={content} onChange={(e) => { setContent(e.target.value); markDirty(); }}
        placeholder="Start typing…" spellCheck
        className="flex-1 min-h-0 w-full resize-none bg-transparent outline-none px-4 py-3 text-[13px] leading-6 font-mono" />
    </div>
  );
}
