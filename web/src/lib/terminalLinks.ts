// Cmd/Ctrl-clickable tokens in the terminal: web URLs (http/https) and file paths. This is the pure
// layer — matchers for each token shape, a parser that splits a path's trailing :line[:col], and an
// xterm ILinkProvider that maps matches back to buffer cells so they underline on hover. Resolving a
// path to a real file (needs the server + room store) and opening a URL in the browser are the
// caller's job, injected as `openPath` / `openUrl`.
//
// Paths: we deliberately match only ASCII, space-free tokens (plus a trailing :line[:col]) — the
// common shapes printed by agents, compilers, and test runners: absolute paths, ~/home, ./rel,
// a/b/c.ts, and bare name.ext. Paths with spaces would need fs-validated greedy expansion (what
// VS Code does); out of scope here.
//
// URLs take precedence over paths: a path-shaped substring inside a URL (e.g. the "/bots/<id>/edit"
// tail of http://localhost:5174/bots/<id>/edit) must never steal the click, so we match URLs first
// and skip any path match overlapping one.

import type { ILink, ILinkProvider, Terminal } from "@xterm/xterm";

// Three path token shapes, each optionally suffixed with :line or :line:col.
const ROOTED = String.raw`(?:~|\.{0,2})?\/[\w.\-/~]+`;       // /abs, ~/home, ./rel, ../rel, /a
const RELSEG = String.raw`[\w.\-]+(?:\/[\w.\-]+)+`;          // a/b/c.ts  (multi-segment relative)
const BAREEXT = String.raw`[\w.\-]+\.[A-Za-z][\w-]*`;        // report.pdf  (bare file with extension)
const LINECOL = String.raw`(?::\d+(?::\d+)?)?`;
const PATH_RE = new RegExp(`(?:${ROOTED}|${RELSEG}|${BAREEXT})${LINECOL}`, "g");

// Web URLs: http/https only, running until whitespace or a quote/bracket delimiter. URL_TRAIL strips
// trailing prose punctuation so "see http://x/y." or a markdown "(http://x/y)" doesn't underline the
// closing char. Leading "]" is excluded from the trim so IPv6 hosts (http://[::1]:8189/) survive.
const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/g;
const URL_TRAIL = /[.,;:!?)'">]+$/;

export interface ParsedPath { path: string; line?: number; col?: number }

/** Strip wrapping quotes/backticks + trailing sentence punctuation, and split off a trailing
 *  :line[:col] (compiler/test output). Returns null if nothing path-like remains. */
export function parsePathToken(raw: string): ParsedPath | null {
  let t = raw.trim().replace(/^['"`(]+/, "").replace(/['"`)]+$/, "");
  let line: number | undefined;
  let col: number | undefined;
  const m = t.match(/:(\d+)(?::(\d+))?$/);
  if (m) {
    line = Number(m[1]);
    col = m[2] ? Number(m[2]) : undefined;
    t = t.slice(0, m.index);
  }
  t = t.replace(/[.,;:]+$/, ""); // trailing prose punctuation, never part of the path
  return t ? { path: t, line, col } : null;
}

/** Rebuild the logical (possibly soft-wrapped) line that buffer row `bufferLineIndex` (0-based)
 *  belongs to: walk up through `isWrapped` continuation rows to the start, then collect down. Each
 *  row's trimmed string is full-width for wrapped rows (no trailing trim mid-content), so 1 char =
 *  1 column — good enough to back-map ASCII matches to cells. */
function logicalLine(term: Terminal, bufferLineIndex: number): { rows: string[]; topIndex: number } {
  const buf = term.buffer.active;
  let top = bufferLineIndex;
  while (top > 0 && buf.getLine(top)?.isWrapped) top--;
  const rows: string[] = [];
  const first = buf.getLine(top);
  if (!first) return { rows, topIndex: top };
  rows.push(first.translateToString(true));
  let i = top + 1;
  for (let l = buf.getLine(i); l && l.isWrapped; l = buf.getLine(++i)) rows.push(l.translateToString(true));
  return { rows, topIndex: top };
}

/** The reassembled logical line plus a mapper from an absolute string index to a 0-based
 *  { x: col, y: bufferRow }. Returns null when the row is empty. */
function lineMap(term: Terminal, bufferLineNumber: number): { text: string; map: (k: number) => { x: number; y: number } } | null {
  const { rows, topIndex } = logicalLine(term, bufferLineNumber - 1); // param is 1-based
  if (!rows.length) return null;
  const widths = rows.map((r) => r.length);
  const map = (k: number) => {
    let r = 0;
    while (r < widths.length - 1 && k >= widths[r]) { k -= widths[r]; r++; }
    return { x: k, y: topIndex + r };
  };
  return { text: rows.join(""), map };
}

/** Build an xterm ILink for `text` spanning absolute indices [start, end) of the logical line. */
function makeLink(
  text: string,
  start: number,
  end: number,
  map: (k: number) => { x: number; y: number },
  activate: (event: MouseEvent, token: string) => void,
): ILink {
  const s = map(start);
  const e = map(end); // end is exclusive → maps directly to the 1-based-inclusive end x
  return {
    text,
    range: { start: { x: s.x + 1, y: s.y + 1 }, end: { x: e.x, y: e.y + 1 } },
    decorations: { pointerCursor: true, underline: true },
    activate,
  };
}

export interface LinkActivators {
  /** Cmd/Ctrl-click a file path → resolve against the pane cwd and open it (caller wires the store). */
  openPath: (event: MouseEvent, token: string) => void;
  /** Cmd/Ctrl-click a web URL → open it in the browser. */
  openUrl: (event: MouseEvent, url: string) => void;
}

/** Create the provider. `isModHeld` gates discovery so links only light up while Cmd/Ctrl is held
 *  (matching VS Code / Zed); each link carries its own `activate`. URLs are matched first and win any
 *  overlap with a path-shaped substring. */
/** Right-click hit-test: the URL or path token at buffer cell (`bufferLineNumber` 1-based, `col`
 *  0-based), or null. Reuses the same logical-line reassembly + matchers as the hover provider, so a
 *  right-click "Open Link" recognizes exactly what a Cmd-hover would underline — but with no modifier
 *  and no mouse-move dependency. URLs win any overlap with a path-shaped substring. */
export function findLinkAt(term: Terminal, bufferLineNumber: number, col: number): { kind: "url" | "path"; text: string } | null {
  const { rows, topIndex } = logicalLine(term, bufferLineNumber - 1); // param is 1-based
  if (!rows.length) return null;
  const rowOffset = bufferLineNumber - 1 - topIndex; // which wrapped row of the logical line was clicked
  if (rowOffset < 0 || rowOffset >= rows.length) return null;
  let abs = col;
  for (let r = 0; r < rowOffset; r++) abs += rows[r].length; // absolute index into the joined logical line
  const text = rows.join("");
  if (abs < 0 || abs >= text.length) return null;

  URL_RE.lastIndex = 0;
  for (let m = URL_RE.exec(text); m; m = URL_RE.exec(text)) {
    const url = m[0].replace(URL_TRAIL, "");
    if (url && abs >= m.index && abs < m.index + url.length) return { kind: "url", text: url };
  }
  PATH_RE.lastIndex = 0;
  for (let m = PATH_RE.exec(text); m; m = PATH_RE.exec(text)) {
    if (abs >= m.index && abs < m.index + m[0].length) return { kind: "path", text: m[0] };
  }
  return null;
}

export function createTerminalLinkProvider(
  term: Terminal,
  isModHeld: () => boolean,
  on: LinkActivators,
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      if (!isModHeld()) { callback(undefined); return; }
      const lm = lineMap(term, bufferLineNumber);
      if (!lm) { callback(undefined); return; }
      const { text, map } = lm;
      const links: ILink[] = [];
      const urlSpans: Array<[number, number]> = [];

      // URLs first so a path-shaped tail inside the URL never steals the click.
      URL_RE.lastIndex = 0;
      for (let mt = URL_RE.exec(text); mt; mt = URL_RE.exec(text)) {
        const url = mt[0].replace(URL_TRAIL, "");
        if (!url) continue;
        const start = mt.index;
        const end = start + url.length;
        urlSpans.push([start, end]);
        links.push(makeLink(url, start, end, map, on.openUrl));
      }

      // Paths, skipping any match that overlaps a URL span.
      PATH_RE.lastIndex = 0;
      for (let mt = PATH_RE.exec(text); mt; mt = PATH_RE.exec(text)) {
        const token = mt[0];
        const start = mt.index;
        const end = start + token.length;
        if (urlSpans.some(([us, ue]) => start < ue && end > us)) continue;
        links.push(makeLink(token, start, end, map, on.openPath));
      }

      callback(links.length ? links : undefined);
    },
  };
}
