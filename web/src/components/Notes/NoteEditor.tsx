import { useEffect, useMemo, useRef, useState } from "react";
import type { MDXEditorMethods } from "@mdxeditor/editor";
import type { Note, NoteGroup } from "../../api/types";
import { NoteRichEditor } from "./NoteRichEditor";

const SAVE_DELAY = 700; // debounce (ms) after the last keystroke before persisting

type SaveStatus = "saved" | "unsaved" | "saving";
// "rich" = the formatted WYSIWYG editor (book icon); "source" = the raw-markdown textarea (code icon).
export type NoteViewMode = "rich" | "source";

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

/** Markdown for the clipboard: the title as an H1 (when set) above the body. */
export function noteToMarkdown(note: { title: string; content: string }): string {
  return note.title.trim() ? `# ${note.title.trim()}\n\n${note.content}` : note.content;
}

/**
 * The right pane: a title field + the note body in one of two modes. **Rich** (book icon) is a full
 * WYSIWYG markdown editor with a formatting toolbar — bold, headings (font size), lists, links, tables,
 * code; **Source** (code icon) is the raw-markdown textarea with find/replace. Both edit the same
 * autosaved content, so toggling never loses text; if the rich editor can't parse a note it falls back
 * to source automatically. A footer carries a group selector + live word count. Mount this keyed by
 * note.id so switching notes resets the draft cleanly. `onRegisterInsert` lets the window mic drop
 * dictated speech into whichever editor is active.
 */
export function NoteEditor({ note, groups, mode, onMode, onSave, onMove, onCopy, onRegisterInsert }: {
  note: Note;
  groups: NoteGroup[];
  mode: NoteViewMode;
  onMode: (m: NoteViewMode) => void;
  onSave: (id: string, patch: { title?: string; content?: string }) => Promise<Note>;
  onMove: (id: string, groupId: string | null) => void;
  onCopy: (note: Note) => void;
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
  const mdxRef = useRef<MDXEditorMethods>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const dirty = useRef(false);
  const latest = useRef({ title, content });
  latest.current = { title, content };
  const modeRef = useRef(mode);
  modeRef.current = mode;

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

  // Insert dictated text at the caret. In rich mode hand off to MDXEditor (its onChange re-syncs +
  // marks dirty); in source mode splice the textarea directly. Reads live refs so one stable
  // registration stays correct as the content + mode change.
  const insertAtCursor = (text: string) => {
    if (modeRef.current === "rich") { mdxRef.current?.insertMarkdown(text); return; }
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
  useEffect(() => {
    if (!onRegisterInsert) return;
    onRegisterInsert((t: string) => insertRef.current(t));
    return () => onRegisterInsert(null);
  }, [onRegisterInsert]);

  const matches = useMemo(() => findAll(content, find, caseSensitive), [content, find, caseSensitive]);
  useEffect(() => { if (cur >= matches.length) setCur(matches.length ? matches.length - 1 : 0); }, [matches.length, cur]);

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

  // Find/replace operates on the raw text, so it lives in source mode — opening it switches there.
  const openFind = () => { onMode("source"); setShowFind(true); setTimeout(() => findRef.current?.select(), 0); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") { e.preventDefault(); openFind(); }
  };

  const matchLabel = matches.length ? `${Math.min(cur, matches.length - 1) + 1}/${matches.length}` : (find ? "0/0" : "");
  const words = content.trim() ? content.trim().split(/\s+/).length : 0;

  const seg = (active: boolean) => `h-6 px-2 inline-flex items-center justify-center rounded ${active ? "bg-elevated text-bright" : "text-muted hover:text-fg"}`;

  return (
    <div className="flex-1 min-w-0 flex flex-col" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-2 px-4 py-2 border-b border-surface">
        <input value={title} onChange={(e) => { setTitle(e.target.value); markDirty(); }} placeholder="Untitled note"
          className="flex-1 min-w-0 bg-transparent outline-none text-sm font-medium placeholder:text-dim" />

        {/* Rich (formatted, book) ⇄ Source (raw markdown, code). Both editable. */}
        <div className="shrink-0 flex items-center rounded bg-surface p-0.5 text-xs">
          <button onClick={() => onMode("rich")} className={seg(mode === "rich")} title="Formatted — rich text & markdown tools" aria-label="Formatted">
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M8 3.5C6.8 2.7 5 2.5 3.2 2.8 2.8 2.85 2.5 3.2 2.5 3.6v8c0 .5.4.85.9.78C5 12.1 6.9 12.4 8 13.2M8 3.5c1.2-.8 3-1 4.8-.7.4.05.7.4.7.8v8c0 .5-.4.85-.9.78C11 12.1 9.1 12.4 8 13.2M8 3.5v9.7" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          </button>
          <button onClick={() => onMode("source")} className={seg(mode === "source")} title="Markdown source — edit the raw text" aria-label="Markdown source">
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M6 5 3 8l3 3M10 5l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <button onClick={() => onCopy(note)} title="Copy as Markdown"
          className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded text-muted hover:bg-surface hover:text-bright" aria-label="Copy as Markdown">
          <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
            <rect x="5.5" y="5.5" width="8" height="8" rx="1.4" /><path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" />
          </svg>
        </button>

        {mode === "source" && (
          <button onClick={openFind} title="Find & replace (⌘F)"
            className="shrink-0 px-2 py-1 bg-elevated hover:bg-edge rounded text-xs text-fg">Find</button>
        )}
        <span className="shrink-0 w-16 text-right text-xs text-dim">
          {status === "saving" ? "Saving…" : status === "unsaved" ? "Unsaved" : "Saved"}
        </span>
      </div>

      {showFind && mode === "source" && (
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
              className={`shrink-0 px-1.5 py-1 rounded ${caseSensitive ? "bg-accent text-accent-fg" : "bg-elevated hover:bg-edge"}`}>Aa</button>
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

      {mode === "rich" ? (
        <NoteRichEditor editorRef={mdxRef} markdown={content}
          onChange={(md, normalize) => { setContent(md); if (!normalize) markDirty(); }}
          onFail={() => onMode("source")} />
      ) : (
        <textarea ref={taRef} value={content} onChange={(e) => { setContent(e.target.value); markDirty(); }}
          placeholder="Start typing…" spellCheck
          className="flex-1 min-h-0 w-full resize-none bg-transparent outline-none px-4 py-3 text-[13px] leading-6 font-mono" />
      )}

      {/* Footer: group selector + live word count — echoes the PM2-manager status bar. */}
      <div className="shrink-0 flex items-center justify-between gap-3 px-4 h-7 border-t border-surface text-xs text-dim">
        <label className="flex items-center gap-1.5">
          <span>Move to</span>
          <select value={note.groupId ?? ""} onChange={(e) => onMove(note.id, e.target.value || null)}
            className="bg-surface border border-edge rounded px-1.5 py-0.5 outline-none text-fg cursor-pointer">
            <option value="">Ungrouped</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name || "Untitled group"}</option>)}
          </select>
        </label>
        <span className="tabular-nums">{words} {words === 1 ? "word" : "words"} · {content.length} chars</span>
      </div>
    </div>
  );
}
