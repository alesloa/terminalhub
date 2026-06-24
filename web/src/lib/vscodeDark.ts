import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

/**
 * VS Code "Dark Modern" (= Dark+) syntax theme for CodeMirror — colors taken verbatim from the
 * VS Code source (`extensions/theme-defaults/themes/dark_vs.json` + `dark_plus.json`) so the editor
 * and the diff view render code exactly the way VS Code does. Replaces `oneDark`, whose palette is
 * noticeably more saturated. The editor *background* stays terminalhub's (forced by `editorTheme` /
 * `diffTheme` at Prec.highest); only the syntax + chrome (caret/selection/active-line) come from here.
 */

// --- VS Code Dark+ token palette (exact hex from the theme JSON) ---
const FG = "#d4d4d4";        // default foreground / punctuation / operators
const COMMENT = "#6a9955";   // comment
const STRING = "#ce9178";    // string, attribute value
const KEYWORD = "#569cd6";   // keyword, storage (class/function/const), tag, constant.language
const CONTROL = "#c586c0";   // keyword.control — control flow + import/export (purple)
const NUMBER = "#b5cea8";    // constant.numeric
const FUNCTION = "#dcdcaa";  // entity.name.function, support.function
const TYPE = "#4ec9b0";      // type, class, support.type
const VARIABLE = "#9cdcfe";  // variable, property, attribute name
const CONSTANT = "#4fc1ff";  // variable.other.constant (readonly)
const REGEXP = "#d16969";    // string.regexp
const ANGLE = "#808080";     // tag punctuation < >
const INVALID = "#f44747";   // invalid

const highlightStyle = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: COMMENT },
  { tag: [t.string, t.special(t.string), t.character], color: STRING },
  { tag: t.regexp, color: REGEXP },
  { tag: t.escape, color: NUMBER },

  { tag: t.keyword, color: KEYWORD },
  { tag: [t.controlKeyword, t.moduleKeyword], color: CONTROL },
  { tag: [t.operatorKeyword, t.definitionKeyword, t.modifier], color: KEYWORD },
  { tag: [t.bool, t.null, t.atom, t.self], color: KEYWORD },

  { tag: [t.number, t.integer, t.float], color: NUMBER },

  { tag: [t.variableName, t.propertyName], color: VARIABLE },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: FUNCTION },
  { tag: t.definition(t.function(t.variableName)), color: FUNCTION },
  { tag: [t.constant(t.variableName), t.standard(t.variableName)], color: CONSTANT },
  { tag: [t.macroName, t.special(t.variableName)], color: CONSTANT },

  { tag: [t.typeName, t.namespace, t.className], color: TYPE },

  { tag: t.tagName, color: KEYWORD },
  { tag: t.angleBracket, color: ANGLE },
  { tag: t.attributeName, color: VARIABLE },
  { tag: t.attributeValue, color: STRING },

  { tag: [t.operator, t.punctuation, t.separator, t.bracket, t.derefOperator, t.meta], color: FG },

  { tag: t.heading, color: KEYWORD, fontWeight: "bold" },
  { tag: [t.link, t.url], color: STRING, textDecoration: "underline" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.invalid, color: INVALID },
]);

// Chrome (caret / selection / active line / gutter foreground) using VS Code Dark+ values. `dark: true`
// flags the editor as dark so `@codemirror/merge`'s `&dark` base rules resolve correctly.
const chrome = EditorView.theme(
  {
    "&": { color: FG },
    ".cm-content": { caretColor: "#aeafad" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#aeafad" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "#264f78",
    },
    ".cm-activeLine": { backgroundColor: "rgba(255, 255, 255, 0.04)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#c6c6c6" },
    ".cm-gutters": { color: "#858585", border: "none" },
    ".cm-selectionMatch": { backgroundColor: "rgba(173, 214, 255, 0.15)" },
    "&.cm-focused .cm-matchingBracket, .cm-matchingBracket": {
      backgroundColor: "rgba(0, 100, 0, 0.25)",
      outline: "1px solid rgba(136, 136, 136, 0.5)",
    },
    ".cm-foldPlaceholder": { backgroundColor: "transparent", border: "none", color: "#cccccc" },

    // Autocomplete / hover popups (LSP completions, signature help) — VS Code's suggest-widget look.
    ".cm-tooltip": { backgroundColor: "#252526", border: "1px solid #454545", color: "#d4d4d4" },
    ".cm-tooltip .cm-tooltip-arrow:before": { borderTopColor: "#454545", borderBottomColor: "#454545" },
    ".cm-tooltip .cm-tooltip-arrow:after": { borderTopColor: "#252526", borderBottomColor: "#252526" },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "#04395e", color: "#ffffff" },
    ".cm-tooltip-autocomplete > ul > li": { color: "#d4d4d4" },
    ".cm-completionIcon": { color: "#858585" },
    ".cm-completionMatchedText": { color: "#18a3ff", textDecoration: "none", fontWeight: "600" },
  },
  { dark: true },
);

export const vscodeDark: Extension = [chrome, syntaxHighlighting(highlightStyle)];
