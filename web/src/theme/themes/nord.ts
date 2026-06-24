import type { Theme } from "../tokens";

// Nord — arctic, north-bluish palette. Polar Night #2e3440→#4c566a surfaces, Snow Storm text,
// Frost #88c0d0 accent. ANSI is the upstream Nord scheme; terminal selection uses Polar Night
// nord2 (#434c5e) instead of the scheme's near-white so it doesn't wash out under text.
export const nord: Theme = {
  id: "nord",
  name: "Nord",
  type: "dark",
  tokens: {
    bg: "#2e3440",
    panel: "#3b4252",
    surface: "#434c5e",
    elevated: "#4c566a",
    code: "#292e39",
    edge: "#434c5e",
    edgeStrong: "#4c566a",
    text: "#d8dee9",
    textBright: "#eceff4",
    textMuted: "#abb4c4",
    textDim: "#6f7a90",
    accent: "#88c0d0",
    accentHover: "#8fbcbb",
    accentFg: "#2e3440",
    link: "#88c0d0",
    selection: "#434c5e",
    success: "#a3be8c",
    error: "#bf616a",
    warn: "#ebcb8b",
    info: "#81a1c1",
  },
  ansi: {
    black: "#3b4252", red: "#bf616a", green: "#a3be8c", yellow: "#ebcb8b",
    blue: "#81a1c1", magenta: "#b48ead", cyan: "#88c0d0", white: "#e5e9f0",
    brightBlack: "#596377", brightRed: "#bf616a", brightGreen: "#a3be8c", brightYellow: "#ebcb8b",
    brightBlue: "#81a1c1", brightMagenta: "#b48ead", brightCyan: "#8fbcbb", brightWhite: "#eceff4",
  },
  terminal: {
    background: "#2e3440",
    foreground: "#d8dee9",
    cursor: "#d8dee9",
    cursorAccent: "#2e3440",
    selectionBackground: "#434c5e",
  },
};
