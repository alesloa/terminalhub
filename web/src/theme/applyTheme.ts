import type { ITheme } from "@xterm/xterm";
import { CSS_VARS, type Theme, type Token } from "./tokens";
import { getTheme } from "./themes";

// "#1a2b3c" -> "26 43 60" (space-separated RGB channels). The vars hold channels, not hex, so
// Tailwind can wrap them as rgb(var(--x) / <alpha-value>) and opacity modifiers keep working.
export function hexToChannels(hex: string): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((d) => d + d).join("") : h, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

// Applies a theme to the document: writes every --tr-* custom property onto <html>, tags it with
// data-theme, and sets color-scheme so native form controls / scrollbars match. All Tailwind
// token classes (bg-panel, text-muted, …) resolve to these vars, so this is the single switch
// that recolors the entire app chrome.
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  for (const token of Object.keys(CSS_VARS) as Token[]) {
    root.style.setProperty(CSS_VARS[token], hexToChannels(theme.tokens[token]));
  }
  root.dataset.theme = theme.id;
  root.style.colorScheme = theme.type;
}

/** Resolve an id and apply it. Used on boot/hydrate and whenever the setting changes. */
export function applyThemeById(id: string): void {
  applyTheme(getTheme(id));
}

// ── Live terminal color comfort ───────────────────────────────────────────────────────────────
// Two per-browser sliders (Appearance settings) adjust the terminal on top of its theme without
// changing the theme itself: dim the foreground + ANSI palette (so stark white softens), and lift
// the near-black background toward a lighter gray. The bg can't be scaled multiplicatively (black ×
// anything is still black), so it gets an additive lift while text/ANSI get a multiplicative dim.
function parseHex(hex: string): [number, number, number] {
  const [r, g, b] = hexToChannels(hex).split(" ").map(Number);
  return [r, g, b];
}
function toHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
function scaleHex(hex: string, percent: number): string {
  const f = percent / 100;
  const [r, g, b] = parseHex(hex);
  return toHex(r * f, g * f, b * f);
}
function liftHex(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  return toHex(r + amount, g + amount, b + amount);
}

// Foreground roles that dim with the text slider — everything the user reads. cursor dims with the
// text so the caret tracks the palette; background + cursorAccent (the glyph painted under the cursor
// block) follow the lifted background instead so the inverted character stays legible.
const DIM_KEYS: (keyof ITheme)[] = [
  "foreground", "cursor",
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
];

/** Apply the live text-dim + background-lift sliders to a base xterm theme. 100/100 = unchanged. */
export function adjustXtermTheme(base: ITheme, textPercent: number, bgLevel: number): ITheme {
  if (textPercent === 100 && bgLevel === 100) return base; // fast path: sliders at theme default
  const out: ITheme = { ...base };
  const lifted = liftHex(base.background ?? "#000000", Math.max(0, bgLevel - 100));
  out.background = lifted;
  out.cursorAccent = lifted;
  for (const k of DIM_KEYS) {
    const v = base[k];
    if (typeof v === "string") (out as Record<string, string>)[k] = scaleHex(v, textPercent);
  }
  return out;
}

/** Build the xterm ITheme for a theme (terminal is canvas-rendered, themed in JS not CSS). */
export function xtermTheme(theme: Theme): ITheme {
  const a = theme.ansi;
  return {
    background: theme.terminal.background,
    foreground: theme.terminal.foreground,
    cursor: theme.terminal.cursor,
    cursorAccent: theme.terminal.cursorAccent,
    selectionBackground: theme.terminal.selectionBackground,
    black: a.black, red: a.red, green: a.green, yellow: a.yellow,
    blue: a.blue, magenta: a.magenta, cyan: a.cyan, white: a.white,
    brightBlack: a.brightBlack, brightRed: a.brightRed, brightGreen: a.brightGreen,
    brightYellow: a.brightYellow, brightBlue: a.brightBlue, brightMagenta: a.brightMagenta,
    brightCyan: a.brightCyan, brightWhite: a.brightWhite,
  };
}
