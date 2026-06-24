import { gutter, GutterMarker, EditorView } from "@codemirror/view";
import { StateField, StateEffect, RangeSet, RangeSetBuilder, Prec } from "@codemirror/state";

/** A bookmark as the gutter needs it: a stable id + its 1-based line. */
export interface GutterBookmark { id: string; line: number }

class BookmarkMarker extends GutterMarker {
  constructor(readonly id: string) { super(); }
  toDOM() {
    const dot = document.createElement("span");
    dot.className = "cm-tr-bookmark";
    return dot;
  }
}

/** Replace the whole bookmark set for the open file. */
export const setBookmarks = StateEffect.define<GutterBookmark[]>();

const bookmarkField = StateField.define<RangeSet<BookmarkMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    set = set.map(tr.changes); // sticky: markers follow edits while the editor is open
    for (const e of tr.effects) {
      if (e.is(setBookmarks)) {
        const doc = tr.state.doc;
        const builder = new RangeSetBuilder<BookmarkMarker>();
        for (const b of [...e.value].sort((a, c) => a.line - c.line)) {
          if (b.line >= 1 && b.line <= doc.lines) {
            const at = doc.line(b.line).from;
            builder.add(at, at, new BookmarkMarker(b.id));
          }
        }
        set = builder.finish();
      }
    }
    return set;
  },
});

/** Current marker positions mapped back to (id, 1-based line) — for sticky reconcile on save. */
export function currentBookmarkLines(view: EditorView): { id: string; line: number }[] {
  const set = view.state.field(bookmarkField, false);
  if (!set) return [];
  const out: { id: string; line: number }[] = [];
  const it = set.iter();
  while (it.value) {
    out.push({ id: it.value.id, line: view.state.doc.lineAt(it.from).number });
    it.next();
  }
  return out;
}

const theme = EditorView.theme({
  ".cm-tr-bookmark-gutter": { width: "14px", cursor: "pointer" },
  // Flex-center every cell so the dot aligns to the middle of its line (margin:auto only
  // centers horizontally in block flow, leaving it stuck at the top).
  ".cm-tr-bookmark-gutter .cm-gutterElement": {
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  ".cm-tr-bookmark": {
    width: "8px", height: "8px", borderRadius: "50%", background: "rgb(var(--tr-accent))",
  },
  // Faint dot on hover hints the line is clickable, without shifting the real marker.
  ".cm-tr-bookmark-gutter .cm-gutterElement:hover:empty::after": {
    content: '""', width: "8px", height: "8px", borderRadius: "50%",
    background: "rgba(21,126,251,0.3)",
  },
});

/** The bookmark gutter: a blue dot per bookmarked line, click to toggle, right-click for a menu. */
export function bookmarkGutter(handlers: {
  onToggle: (line: number) => void;
  onContext: (line: number, x: number, y: number) => void;
}) {
  return [
    bookmarkField,
    // High precedence so this gutter sits at the far-left edge, like VS Code.
    Prec.high(gutter({
      class: "cm-tr-bookmark-gutter",
      markers: (view) => view.state.field(bookmarkField),
      domEventHandlers: {
        mousedown(view, line, event) {
          const e = event as MouseEvent;
          const ln = view.state.doc.lineAt(line.from).number;
          if (e.button === 2) { e.preventDefault(); handlers.onContext(ln, e.clientX, e.clientY); return true; }
          if (e.button === 0) { handlers.onToggle(ln); return true; }
          return false;
        },
        contextmenu(view, line, event) {
          const e = event as MouseEvent;
          e.preventDefault();
          const ln = view.state.doc.lineAt(line.from).number;
          handlers.onContext(ln, e.clientX, e.clientY);
          return true;
        },
      },
    })),
    theme,
  ];
}
