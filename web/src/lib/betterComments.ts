import { EditorView, Decoration, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder, Prec, type Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { BetterCommentsConfig, CommentTag } from "../api/types";

// VS Code "Better Comments" v3.0.2 defaults, verbatim. Mirrors server DEFAULT_BETTER_COMMENTS.
export const DEFAULT_BETTER_COMMENTS: BetterCommentsConfig = {
  enabled: true,
  tags: [
    { tag: "!", color: "#FF2D00", bold: false, italic: false, underline: false, strikethrough: false, backgroundColor: "transparent" },
    { tag: "?", color: "#3498DB", bold: false, italic: false, underline: false, strikethrough: false, backgroundColor: "transparent" },
    { tag: "//", color: "#474747", bold: false, italic: false, underline: false, strikethrough: true, backgroundColor: "transparent" },
    { tag: "todo", color: "#FF8C00", bold: false, italic: false, underline: false, strikethrough: false, backgroundColor: "transparent" },
    { tag: "*", color: "#98C379", bold: false, italic: false, underline: false, strikethrough: false, backgroundColor: "transparent" },
  ],
};

// The line/block comment delimiters a language advertises through CodeMirror's `commentTokens`
// language data. Lezer grammars (Python `#`, JS `//` + `/* */`, etc.) all provide these; the
// StreamLanguage config parsers (.env/.gitignore/Makefile) don't, so those are best-effort.
interface CommentTokens { line?: string; block?: { open: string; close: string } }

/** Inline CSS for one tag, mirroring Better Comments' style→CSS mapping. */
function styleFor(t: CommentTag): string {
  const decorations: string[] = [];
  if (t.underline) decorations.push("underline");
  if (t.strikethrough) decorations.push("line-through");
  // `!important` so the tag color beats the theme's own comment color when the two
  // decorations land on the same span.
  let css = `color:${t.color} !important;`;
  if (t.backgroundColor && t.backgroundColor !== "transparent") css += `background-color:${t.backgroundColor};`;
  if (t.bold) css += "font-weight:bold;";
  if (t.italic) css += "font-style:italic;";
  if (decorations.length) css += `text-decoration:${decorations.join(" ")};`;
  return css;
}

/**
 * Index of the tag whose marker the comment content starts with, or -1. Longest marker wins
 * (so `//` beats a hypothetical `/`), matching Better Comments' regex alternation. `content`
 * is the comment text with its delimiter and leading whitespace already stripped.
 */
export function matchCommentTag(content: string, tags: CommentTag[]): number {
  const lower = content.toLowerCase();
  let best = -1, bestLen = 0;
  for (let i = 0; i < tags.length; i++) {
    const marker = tags[i].tag.toLowerCase();
    if (marker && lower.startsWith(marker) && marker.length > bestLen) { best = i; bestLen = marker.length; }
  }
  return best;
}

/** Strip a line's leading whitespace + comment delimiter, returning the taggable content and
 * how many leading whitespace chars preceded the delimiter (where coloring should begin). */
function analyzeLine(segText: string, tokens: CommentTokens | undefined, isFirstLine: boolean): { content: string; wsLen: number } {
  const wsLen = segText.length - segText.trimStart().length;
  let rest = segText.slice(wsLen);
  const open = tokens?.block?.open;
  const close = tokens?.block?.close;
  const line = tokens?.line;
  if (isFirstLine) {
    if (open && rest.startsWith(open)) rest = rest.slice(open.length);
    else if (line && rest.startsWith(line)) rest = rest.slice(line.length);
  } else if (rest.startsWith("*") && !(close && rest.startsWith(close))) {
    // Continuation line of a block/JSDoc comment: drop the leading `*` gutter marker.
    rest = rest.slice(1);
  }
  return { content: rest.replace(/^\s+/, ""), wsLen };
}

/** Add a styled mark for every physical line of one comment node whose content opens with a tag. */
function decorateComment(
  nodeFrom: number, nodeTo: number, state: EditorState,
  tags: CommentTag[], marks: Decoration[], builder: RangeSetBuilder<Decoration>,
) {
  const doc = state.doc;
  const tokens = state.languageDataAt<CommentTokens>("commentTokens", nodeFrom)[0];
  const startLine = doc.lineAt(nodeFrom).number;
  const endLine = doc.lineAt(nodeTo).number;
  for (let ln = startLine; ln <= endLine; ln++) {
    const line = doc.line(ln);
    const segFrom = Math.max(nodeFrom, line.from);
    const segTo = Math.min(nodeTo, line.to);
    if (segTo <= segFrom) continue;
    const segText = doc.sliceString(segFrom, segTo);
    const { content, wsLen } = analyzeLine(segText, tokens, ln === startLine);
    if (!content) continue;
    if (tokens?.block && content.startsWith(tokens.block.close)) continue; // a bare `*/` closing line
    const idx = matchCommentTag(content, tags);
    if (idx < 0) continue;
    builder.add(segFrom + wsLen, segTo, marks[idx]); // color the delimiter + tag + text (BC-style)
  }
}

function buildDecorations(view: EditorView, tags: CommentTag[], marks: Decoration[]): DecorationSet {
  const ranges = view.visibleRanges;
  if (!ranges.length) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(view.state);
  // One pass across the visible span (not per-range) so additions stay sorted and comment
  // nodes straddling a range gap aren't visited twice.
  tree.iterate({
    from: ranges[0].from,
    to: ranges[ranges.length - 1].to,
    enter: (node) => {
      if (/comment/i.test(node.name)) decorateComment(node.from, node.to, view.state, tags, marks, builder);
    },
  });
  return builder.finish();
}

/**
 * "Better Comments" for CodeMirror: color a comment's text by a leading tag. Walks the
 * language's own syntax tree to find real comments (so it works for every grammar the editor
 * loads), then paints each tagged line with an inline-styled mark. `Prec.highest` so our color
 * nests innermost and wins over the theme's default comment color.
 */
export function betterCommentsExtension(config: BetterCommentsConfig): Extension {
  if (!config.enabled || config.tags.length === 0) return [];
  const tags = config.tags;
  const marks = tags.map((t) => Decoration.mark({ attributes: { style: styleFor(t) } }));

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) { this.decorations = buildDecorations(view, tags, marks); }
      update(u: ViewUpdate) {
        // Rebuild on edits, scroll, and when the async language parse changes the tree.
        if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
          this.decorations = buildDecorations(u.view, tags, marks);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );

  return Prec.highest(plugin);
}
