import { EditorView, Decoration, type DecorationSet } from "@codemirror/view";
import { StateField, StateEffect, type EditorState } from "@codemirror/state";
import { SearchQuery } from "@codemirror/search";

// One match in the open file. `from`/`to` are document offsets.
export interface Match {
  from: number;
  to: number;
}

export interface FindOptions {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
  replace?: string;
}

// Scanning the whole document on every keystroke is fine for the files this editor opens
// (anything past the size guard never reaches here), but a pathological match-everything
// regex on a big file could still spin — so we stop counting past this many.
const MAX_MATCHES = 20000;

/** Build the CodeMirror SearchQuery that both navigation and highlighting share. */
export function buildQuery(opts: FindOptions): SearchQuery {
  return new SearchQuery({
    search: opts.query,
    caseSensitive: opts.caseSensitive,
    wholeWord: opts.wholeWord,
    regexp: opts.regexp,
    literal: !opts.regexp,
    replace: opts.replace ?? "",
  });
}

/** All matches of `query` in the document, left to right. Empty when the query is blank or
 * (for a regex) invalid. */
export function findMatches(state: EditorState, query: SearchQuery): Match[] {
  if (!query.search || !query.valid) return [];
  const out: Match[] = [];
  const cursor = query.getCursor(state);
  for (let res = cursor.next(); !res.done; res = cursor.next()) {
    const m = res.value;
    if (m.from === m.to) continue; // zero-width regex match — skip, it can't be navigated
    out.push({ from: m.from, to: m.to });
    if (out.length >= MAX_MATCHES) break;
  }
  return out;
}

/** Index of the match that is currently selected (the active one), or -1. */
export function activeMatchIndex(matches: Match[], from: number, to: number): number {
  return matches.findIndex(m => m.from === from && m.to === to);
}

// --- Match highlighting -----------------------------------------------------------------
// We render our own decorations rather than CodeMirror's built-in search highlight, because
// the built-in only paints while its panel is open and we drive a custom widget instead.

const matchMark = Decoration.mark({ class: "cm-tr-find-match" });
const activeMark = Decoration.mark({ class: "cm-tr-find-match cm-tr-find-active" });

export const setFindMatches = StateEffect.define<{ matches: Match[]; active: number }>();

const findMatchField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setFindMatches)) {
        const { matches, active } = e.value;
        deco = Decoration.set(
          matches.map((m, i) => (i === active ? activeMark : matchMark).range(m.from, m.to)),
          true,
        );
      }
    }
    return deco;
  },
  provide: f => EditorView.decorations.from(f),
});

const findTheme = EditorView.theme({
  ".cm-tr-find-match": {
    backgroundColor: "rgba(234,179,8,0.25)",
    borderRadius: "2px",
  },
  ".cm-tr-find-active": {
    backgroundColor: "rgba(249,115,22,0.55)",
    outline: "1px solid rgba(249,115,22,0.9)",
  },
});

/** Editor extension that lets `setFindMatches` paint the find highlights. */
export const findHighlighter = [findMatchField, findTheme];
