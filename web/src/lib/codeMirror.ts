import { EditorView } from "@codemirror/view";
import { Prec, type Extension } from "@codemirror/state";
import { LanguageDescription, StreamLanguage, type StreamParser } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { showMinimap } from "@replit/codemirror-minimap";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

// Surface colors. The editor sits a touch darker than before; the minimap is its own
// darker column so the "scroll" strip on the right reads as a separate region (like VS Code).
const EDITOR_BG = "rgb(var(--tr-bg))";     // main editor window
const MINIMAP_BG = "rgb(var(--tr-code))";  // minimap column — a touch darker than the editor so it
                                           // reads as a separate strip (long lines disappear UNDER it,
                                           // they don't bleed into the glyphs)
const BORDER = "1px solid rgb(var(--tr-edge))";
const MINIMAP_BORDER = "1px solid rgb(var(--tr-edge-strong))"; // clearer seam at the minimap's left edge

interface EnvState { section: "key" | "beforeValue" | "value" }
interface LineState { kind: "line" }

const envParser: StreamParser<EnvState> = {
  name: "dotenv",
  startState: () => ({ section: "key" }),
  blankLine: (state) => { state.section = "key"; },
  token(stream, state) {
    if (stream.sol()) {
      stream.eatSpace();
      if (stream.peek() === "#") {
        stream.skipToEnd();
        return "comment";
      }
      state.section = "key";
    }

    if (state.section === "key") {
      if (stream.match(/export\b/)) return "keyword";
      if (stream.match(/[A-Za-z_][A-Za-z0-9_.-]*/)) { state.section = "beforeValue"; return "variableName"; }
      if (stream.eat("=")) { state.section = "value"; return "operator"; }
      stream.next();
      return null;
    }

    if (state.section === "beforeValue") {
      stream.eatSpace();
      if (stream.eat("=")) { state.section = "value"; return "operator"; }
      state.section = "value";
    }

    if (state.section === "value") {
      if (stream.peek() === "#") {
        stream.skipToEnd();
        return "comment";
      }
      if (stream.match(/"(?:[^"\\]|\\.)*"?/) || stream.match(/'(?:[^'\\]|\\.)*'?/)) return "string";
      if (stream.match(/[^#\s]+/)) return "string";
      stream.next();
      return null;
    }

    return null;
  },
};

const ignoreParser: StreamParser<LineState> = {
  name: "ignore",
  startState: () => ({ kind: "line" }),
  token(stream) {
    if (stream.sol()) {
      stream.eatSpace();
      if (stream.peek() === "#") {
        stream.skipToEnd();
        return "comment";
      }
      if (stream.eat("!")) return "keyword";
    }
    stream.skipToEnd();
    return "string";
  },
};

const makefileParser: StreamParser<LineState> = {
  name: "makefile",
  startState: () => ({ kind: "line" }),
  token(stream) {
    if (stream.sol()) {
      if (stream.peek() === "#") {
        stream.skipToEnd();
        return "comment";
      }
      if (stream.peek() === "\t") {
        stream.skipToEnd();
        return "string";
      }
      if (stream.match(/[A-Za-z0-9_.%/-]+(?=\s*:)/)) return "variableName";
      if (stream.match(/[A-Za-z_][A-Za-z0-9_]*(?=\s*(?:[:?+]?=))/)) return "variableName";
    }
    if (stream.match(/[:?+]?=/) || stream.eat(":")) return "operator";
    stream.next();
    return null;
  },
};

// `.cm-minimap-gutter` is also a `.cm-gutters`, so its background must be declared AFTER the
// `.cm-gutters` rule (same specificity → source order wins) to override it with the darker shade.
const surface = {
  ".cm-gutters": { backgroundColor: EDITOR_BG, borderRight: BORDER },
  ".cm-minimap-gutter": { backgroundColor: MINIMAP_BG, borderLeft: MINIMAP_BORDER },
};

// Prec.highest so our backgrounds beat oneDark's own `.cm-editor`/`.cm-gutters` colors,
// regardless of extension order in the host editor.
/** Editor chrome for a regular file: fills its pane and owns its own scroll. */
export const editorTheme = Prec.highest(EditorView.theme({
  "&": { height: "100%", backgroundColor: EDITOR_BG },
  ".cm-scroller": { overflow: "auto", fontFamily: MONO },
  ...surface,
}));

/** Same look for diffs, but content-height (no forced 100%) so stacked per-file merge
 * views size to their content and the outer pane does the scrolling. */
export const diffTheme = Prec.highest(EditorView.theme({
  "&": { backgroundColor: EDITOR_BG },
  ".cm-scroller": { fontFamily: MONO },
  ...surface,
}));

/**
 * Make a (unified) diff editor fill its host and own its own vertical scroll — the SAME
 * scroll model as the normal editor. A single-file diff uses this so its `.cm-scroller` is the
 * scroll container, which is what the minimap pins to: the minimap stays put while you scroll
 * and its overlay thumb can drag-scroll. Without it the editor is content-height and an outer
 * pane scrolls, so the minimap rides up and off-screen and the thumb can't drive anything.
 */
export const fillHeight = Prec.highest(EditorView.theme({
  "&": { height: "100%" },
  ".cm-scroller": { overflow: "auto" },
}));

/** The LSP language id for a filename, or null when no language server covers it. Extension-driven —
 *  must use the same ids as the server registry's `languageIds` (server/src/lsp/registry.ts). */
export function languageIdFor(filename: string): string | null {
  const base = (filename.split("/").pop() ?? filename).toLowerCase();
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".")) : "";
  switch (ext) {
    case ".ts": case ".mts": case ".cts": return "typescript";
    case ".tsx": return "typescriptreact";
    case ".js": case ".mjs": case ".cjs": return "javascript";
    case ".jsx": return "javascriptreact";
    case ".py": case ".pyi": return "python";
    case ".go": return "go";
    case ".rs": return "rust";
    default: return null;
  }
}

/** CodeMirror language support for a filename, or null when no language matches. */
export async function loadLanguage(filename: string): Promise<Extension | null> {
  if (isEnvFile(filename)) return StreamLanguage.define(envParser);
  if (isIgnoreFile(filename)) return StreamLanguage.define(ignoreParser);
  if (isMakefile(filename)) return StreamLanguage.define(makefileParser);
  const alias = languageAlias(filename);
  if (alias) return alias;
  const desc = LanguageDescription.matchFilename(languages, filename);
  return desc ? await desc.load() : null;
}

function isEnvFile(filename: string) {
  const base = filename.split("/").pop() ?? filename;
  return base === ".env" || base.startsWith(".env.") || base.endsWith(".env");
}

function isIgnoreFile(filename: string) {
  const base = filename.split("/").pop() ?? filename;
  return [".gitignore", ".dockerignore", ".eslintignore", ".prettierignore", ".npmignore"].includes(base);
}

function isMakefile(filename: string) {
  const base = filename.split("/").pop() ?? filename;
  return base === "Makefile" || base.endsWith(".mk");
}

function languageAlias(filename: string): Promise<Extension | null> | null {
  const base = filename.split("/").pop() ?? filename;
  if (base.startsWith("Dockerfile.")) return loadLanguageByName("Dockerfile");
  if ([".npmrc", ".yarnrc", ".editorconfig"].includes(base)) return loadLanguageByName("Properties files");
  if (base === "Caddyfile") return loadLanguageByName("Nginx");
  return null;
}

async function loadLanguageByName(name: string): Promise<Extension | null> {
  const desc = languages.find(l => l.name === name);
  return desc ? await desc.load() : null;
}

// The minimap fills a bare container the extension owns; we just hand it the element.
const createMinimap = () => ({ dom: document.createElement("div") });

// The package only calls preventDefault while dragging the overlay box; scrubbing the canvas
// (or overshooting past the top/bottom) otherwise starts a native selection of the editor
// text — drag to the top and it selects everything. Marking the minimap unselectable stops
// the selection from ever beginning there (the same thing VS Code's minimap does).
const minimapTheme = EditorView.theme({
  // The gutter already sits above the editor content (it carries CodeMirror's `.cm-gutters`
  // z-index 200), so a long line never paints ON TOP of the minimap. Keep its background opaque
  // (gutter + the canvas's inner box) so the code cleanly disappears UNDER the column instead of
  // bleeding through the transparent glyph canvas — VS Code's behaviour.
  ".cm-minimap-gutter": { userSelect: "none", WebkitUserSelect: "none", backgroundColor: MINIMAP_BG },
  ".cm-minimap-inner": { backgroundColor: MINIMAP_BG },
  ".cm-minimap-overlay-container": { userSelect: "none", WebkitUserSelect: "none" },
});

/**
 * The code minimap extension (right-gutter, VS Code-style character render). Always returns a
 * `showMinimap` provider — `null` when disabled — never an empty extension. That keeps the facet
 * provided and the minimap's ViewPlugin alive across a toggle, so the package's own prev→now logic
 * re-creates AND repaints on re-enable. Dropping the provider entirely (returning `[]`) tears the
 * plugin down; the next enable builds a fresh plugin that never gets its first render, leaving a
 * blank canvas until the next scroll.
 *
 * `displayText: "characters"` draws the actual glyph shapes (syntax-coloured) like VS Code's
 * minimap, rather than solid "blocks" bars — the look the maintainer asked for.
 */
export function minimapExt(enabled: boolean): Extension {
  return [
    showMinimap.of(enabled ? { create: createMinimap, displayText: "characters", showOverlay: "always" } : null),
    minimapTheme,
  ];
}
