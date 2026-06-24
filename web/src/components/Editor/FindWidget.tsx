import { useCallback, useEffect, useRef, useState } from "react";
import { EditorView as CMView } from "@codemirror/view";
import { setSearchQuery, findNext, findPrevious, replaceNext, replaceAll } from "@codemirror/search";
import {
  buildQuery,
  findMatches,
  activeMatchIndex,
  setFindMatches,
  type Match,
} from "../../lib/findInFile";

interface FindWidgetProps {
  view: CMView | null;
  /** Bumps whenever the document changes, so matches recompute on edits. */
  docRevision: unknown;
  /** Selection text to seed the input with on (re)open; "" keeps the current query. */
  seed: string;
  /** Bumps on every Ctrl+F so an already-open widget refocuses (and reseeds). */
  seedNonce: number;
  /** Opened via the replace shortcut — expand the replace row. */
  openWithReplace: boolean;
  /** Whether the minimap is showing — the widget shifts left to clear it. */
  minimap: boolean;
  onClose: () => void;
}

// Gap between the widget's right edge and the editor's right edge (no minimap) or the
// minimap's left edge (minimap on).
const EDGE_GAP = 16;
const MINIMAP_GAP = 6;

const TOGGLES = [
  { key: "caseSensitive", label: "Aa", title: "Match case" },
  { key: "wholeWord", label: "ab", title: "Match whole word" },
  { key: "regexp", label: ".*", title: "Use regular expression" },
] as const;

const iconBtn =
  "px-1.5 py-0.5 rounded text-muted hover:bg-elevated hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted";

export function FindWidget({ view, docRevision, seed, seedNonce, openWithReplace, minimap, onClose }: FindWidgetProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const matchesRef = useRef<Match[]>([]);
  const [rightPx, setRightPx] = useState(EDGE_GAP);
  const [query, setQuery] = useState(seed);
  const [replace, setReplace] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regexp, setRegexp] = useState(false);
  const [count, setCount] = useState<{ index: number; total: number }>({ index: -1, total: 0 });

  // Recompute every match, repaint the highlights, and update the counter. When `jump` is set
  // (the query or an option changed), also move the selection to the first match at/after the
  // cursor — like VS Code. On a plain document edit we keep the cursor where the user left it.
  const recompute = useCallback((jump: boolean) => {
    if (!view) return;
    const q = buildQuery({ query, caseSensitive, wholeWord, regexp, replace });
    const matches = findMatches(view.state, q);
    matchesRef.current = matches;

    const sel = view.state.selection.main;
    let active = activeMatchIndex(matches, sel.from, sel.to);
    if (active === -1 && matches.length) {
      active = matches.findIndex(m => m.from >= sel.from);
      if (active === -1) active = 0;
    }

    const effects = [setSearchQuery.of(q), setFindMatches.of({ matches, active })];
    if (jump && active >= 0) {
      const m = matches[active];
      view.dispatch({ selection: { anchor: m.from, head: m.to }, effects, scrollIntoView: true });
    } else {
      view.dispatch({ effects });
    }
    setCount({ index: active, total: matches.length });
  }, [view, query, caseSensitive, wholeWord, regexp, replace]);

  // Query / option changes re-search and jump to the first match.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { recompute(true); }, [query, caseSensitive, wholeWord, regexp]);
  // Document edits re-search without moving the cursor.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { recompute(false); }, [docRevision]);

  // Focus (and reseed) the input whenever the widget opens or Ctrl+F is pressed again.
  useEffect(() => {
    if (seed) setQuery(seed);
    if (openWithReplace) setShowReplace(true); // replace shortcut only expands, never collapses
    const id = requestAnimationFrame(() => {
      // preventScroll: focusing the overhanging top-right widget would otherwise make the browser
      // scroll the nearest scrollable ancestor to reveal it, yanking the whole editor content left
      // on every Ctrl/Cmd+F. (Same guard BoardModal uses on focus.)
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedNonce]);

  // Keep the widget clear of the minimap: its right edge lands at the minimap's left edge
  // (measured live, since the minimap width is dynamic). No minimap → sit at the editor edge.
  useEffect(() => {
    if (!view) return;
    let ro: ResizeObserver | null = null;
    const measure = () => {
      const mm = view.dom.querySelector(".cm-minimap-gutter") as HTMLElement | null;
      setRightPx(mm && mm.offsetWidth ? mm.offsetWidth + MINIMAP_GAP : EDGE_GAP);
    };
    const id = requestAnimationFrame(() => {
      measure();
      const mm = view.dom.querySelector(".cm-minimap-gutter");
      if (mm) { ro = new ResizeObserver(measure); ro.observe(mm); }
    });
    return () => { cancelAnimationFrame(id); ro?.disconnect(); };
  }, [view, minimap]);

  // On close, clear the search query + highlights and hand focus back to the editor.
  useEffect(() => {
    return () => {
      if (!view) return;
      view.dispatch({
        effects: [
          setSearchQuery.of(buildQuery({ query: "", caseSensitive: false, wholeWord: false, regexp: false })),
          setFindMatches.of({ matches: [], active: -1 }),
        ],
      });
      view.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const navigate = useCallback((dir: 1 | -1) => {
    if (!view || !matchesRef.current.length) return;
    (dir === 1 ? findNext : findPrevious)(view);
    const sel = view.state.selection.main;
    const idx = activeMatchIndex(matchesRef.current, sel.from, sel.to);
    view.dispatch({ effects: setFindMatches.of({ matches: matchesRef.current, active: idx }), scrollIntoView: true });
    setCount(c => ({ index: idx, total: c.total }));
  }, [view]);

  // Replace reads the live `replace` text, so push the query (with that text) into the search
  // state synchronously right before running the command — recompute doesn't watch `replace`.
  const runReplace = useCallback((all: boolean) => {
    if (!view || !matchesRef.current.length) return;
    view.dispatch({ effects: setSearchQuery.of(buildQuery({ query, caseSensitive, wholeWord, regexp, replace })) });
    (all ? replaceAll : replaceNext)(view);
    // The doc just changed → the docRevision effect repaints matches + refreshes the count.
  }, [view, query, caseSensitive, wholeWord, regexp, replace]);

  const setToggle = (key: (typeof TOGGLES)[number]["key"]) => {
    if (key === "caseSensitive") setCaseSensitive(v => !v);
    else if (key === "wholeWord") setWholeWord(v => !v);
    else setRegexp(v => !v);
  };

  const onWrapperKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  const toggleState = { caseSensitive, wholeWord, regexp };
  const hasQuery = query.length > 0;
  const noResults = hasQuery && count.total === 0;

  return (
    <div
      className="absolute top-2 z-20 flex items-start gap-1 rounded border border-edge bg-panel px-1.5 py-1 shadow-lg shadow-black/40"
      style={{ right: rightPx }}
      onKeyDown={onWrapperKeyDown}
    >
      <button
        title={showReplace ? "Hide Replace" : "Toggle Replace"}
        onClick={() => setShowReplace(v => !v)}
        className="self-stretch px-0.5 rounded text-muted hover:bg-elevated hover:text-fg"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" className={`w-3 h-3 transition-transform ${showReplace ? "rotate-90" : ""}`}>
          <path d="M6 4l4 4-4 4z" />
        </svg>
      </button>

      <div className="flex flex-col gap-1">
        {/* Find row */}
        <div className="flex items-center gap-1">
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); navigate(e.shiftKey ? -1 : 1); }
            }}
            placeholder="Find"
            spellCheck={false}
            className={`w-48 bg-canvas border rounded px-2 py-0.5 text-sm text-fg outline-none placeholder:text-dim ${
              noResults ? "border-red-500/70" : "border-edge focus:border-blue-500"
            }`}
          />

          {TOGGLES.map(t => (
            <button
              key={t.key}
              title={t.title}
              onClick={() => setToggle(t.key)}
              className={`px-1.5 py-0.5 rounded text-xs font-mono leading-none ${
                toggleState[t.key]
                  ? "bg-blue-600 text-white"
                  : "text-muted hover:bg-elevated hover:text-fg"
              }`}
            >
              {t.label}
            </button>
          ))}

          <span
            className={`px-1 text-xs tabular-nums whitespace-nowrap min-w-[4rem] text-center select-none ${
              noResults ? "text-red-400" : "text-dim"
            }`}
          >
            {!hasQuery ? "" : noResults ? "No results" : `${count.index + 1} of ${count.total}`}
          </span>

          <button title="Previous match (Shift+Enter)" onClick={() => navigate(-1)} disabled={count.total === 0} className={iconBtn}>↑</button>
          <button title="Next match (Enter)" onClick={() => navigate(1)} disabled={count.total === 0} className={iconBtn}>↓</button>
          <button title="Close (Esc)" onClick={onClose} className={iconBtn}>✕</button>
        </div>

        {/* Replace row */}
        {showReplace && (
          <div className="flex items-center gap-1">
            <input
              value={replace}
              onChange={e => setReplace(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") { e.preventDefault(); runReplace(false); }
              }}
              placeholder="Replace"
              spellCheck={false}
              className="w-48 bg-canvas border border-edge rounded px-2 py-0.5 text-sm text-fg outline-none placeholder:text-dim focus:border-blue-500"
            />
            <button title="Replace (Enter)" onClick={() => runReplace(false)} disabled={count.total === 0} className={iconBtn}>
              <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d="M8 3v6M5.5 6.5L8 9l2.5-2.5" />
                <path d="M3.5 12.5h9" />
              </svg>
            </button>
            <button title="Replace All" onClick={() => runReplace(true)} disabled={count.total === 0} className={iconBtn}>
              <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.25">
                <path d="M5 3v4.5M3 6l2 2 2-2M11 3v4.5M9 6l2 2 2-2" />
                <path d="M3.5 12.5h9" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
