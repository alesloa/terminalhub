import type { Theme } from "../tokens";

// Solarized Light — Ethan Schoonover's classic. Cream base3 #fdf6e3, base2 #eee8d5 surfaces,
// base00 #657b83 text, blue #268bd2 accent. ANSI palette is the upstream Solarized Light scheme.
export const solarizedLight: Theme = {
  id: "solarized-light",
  name: "Solarized Light",
  type: "light",
  tokens: {
    bg: "#fdf6e3",
    panel: "#eee8d5",
    surface: "#e3dcc4",
    elevated: "#dcd4ba",
    code: "#eee8d5",
    edge: "#e0d9c4",
    edgeStrong: "#ccc5b0",
    text: "#657b83",
    textBright: "#586e75",
    textMuted: "#839496",
    textDim: "#93a1a1",
    accent: "#268bd2",
    accentHover: "#1f7ab8",
    accentFg: "#fdf6e3",
    link: "#268bd2",
    selection: "#eee8d5",
    success: "#859900",
    error: "#dc322f",
    warn: "#b58900",
    info: "#268bd2",
  },
  ansi: {
    black: "#073642", red: "#dc322f", green: "#859900", yellow: "#b58900",
    blue: "#268bd2", magenta: "#d33682", cyan: "#2aa198", white: "#bbb5a2",
    brightBlack: "#002b36", brightRed: "#cb4b16", brightGreen: "#586e75", brightYellow: "#657b83",
    brightBlue: "#839496", brightMagenta: "#6c71c4", brightCyan: "#93a1a1", brightWhite: "#fdf6e3",
  },
  terminal: {
    background: "#fdf6e3",
    foreground: "#657b83",
    cursor: "#657b83",
    cursorAccent: "#fdf6e3",
    selectionBackground: "#eee8d5",
  },
};
