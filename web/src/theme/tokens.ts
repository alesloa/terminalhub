// The theme token contract — the single source of truth for every themeable color in the app
// chrome. Components never use raw hex; they use the Tailwind classes backed by these CSS vars
// (see tailwind.config.js, which mirrors TAILWIND_COLORS below — keep the two in sync by hand,
// same as the other duplicated cross-cutting maps in this repo).
//
// Terminal (xterm) colors are NOT here: xterm renders to a canvas and is themed via a JS ITheme
// object built in applyTheme.ts from each theme's `ansi` + `terminal` fields, not via CSS vars.

/** Every semantic chrome color role. A Theme must provide a value for each (enforced by tsc). */
export type Token =
  | "bg"          // app canvas / deepest background
  | "panel"       // sidebars, bars, modals, cards
  | "surface"     // subtle raised surface
  | "elevated"    // inputs, hover, inline code
  | "code"        // recessed/inset: code blocks, secondary buttons, terminal wells
  | "edge"        // default border / divider
  | "edgeStrong"  // input border, hover border
  | "text"        // primary text
  | "textBright"  // headings / emphasis
  | "textMuted"   // secondary text
  | "textDim"     // faint / placeholder
  | "accent"      // brand / focus / primary action
  | "accentHover" // accent hover state
  | "accentFg"    // text/icon on an accent fill
  | "link"        // hyperlinks
  | "selection"   // text-selection background
  | "success"     // additions, ok status
  | "error"       // deletions, error status
  | "warn"        // modified, warnings
  | "info";       // informational

/** CSS custom-property name for each token (applyTheme writes these onto <html>). */
export const CSS_VARS: Record<Token, string> = {
  bg: "--tr-bg",
  panel: "--tr-panel",
  surface: "--tr-surface",
  elevated: "--tr-elevated",
  code: "--tr-code",
  edge: "--tr-edge",
  edgeStrong: "--tr-edge-strong",
  text: "--tr-text",
  textBright: "--tr-text-bright",
  textMuted: "--tr-text-muted",
  textDim: "--tr-text-dim",
  accent: "--tr-accent",
  accentHover: "--tr-accent-hover",
  accentFg: "--tr-accent-fg",
  link: "--tr-link",
  selection: "--tr-selection",
  success: "--tr-success",
  error: "--tr-error",
  warn: "--tr-warn",
  info: "--tr-info",
};

/** The 16 standard terminal ANSI slots (xterm ITheme), supplied per theme. */
export interface AnsiPalette {
  black: string; red: string; green: string; yellow: string;
  blue: string; magenta: string; cyan: string; white: string;
  brightBlack: string; brightRed: string; brightGreen: string; brightYellow: string;
  brightBlue: string; brightMagenta: string; brightCyan: string; brightWhite: string;
}

/** xterm surface colors (background/foreground/cursor/selection) for the terminal itself. */
export interface TerminalColors {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
}

export type ThemeType = "dark" | "light";

export interface Theme {
  id: string;                       // stable id persisted in settings, e.g. "terminalhub"
  name: string;                     // display name in the picker
  type: ThemeType;                  // grouping in the picker
  tokens: Record<Token, string>;    // every token required — a missing one fails the build
  ansi: AnsiPalette;
  terminal: TerminalColors;
}
