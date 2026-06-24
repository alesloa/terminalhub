import type { Theme } from "../tokens";

// One Light — Atom's clean light theme. #fafafa base, #383a42 text, blue #4078f2 accent. ANSI
// palette is the upstream Atom One Light scheme verbatim.
export const atomOneLight: Theme = {
  id: "atom-one-light",
  name: "One Light",
  type: "light",
  tokens: {
    bg: "#ffffff",
    panel: "#fafafa",
    surface: "#f0f0f0",
    elevated: "#e5e5e6",
    code: "#f2f2f2",
    edge: "#e5e5e6",
    edgeStrong: "#c9c9cb",
    text: "#383a42",
    textBright: "#1c1c1e",
    textMuted: "#6a6b73",
    textDim: "#a0a1a7",
    accent: "#4078f2",
    accentHover: "#2f6ae8",
    accentFg: "#ffffff",
    link: "#4078f2",
    selection: "#e5e5e6",
    success: "#50a14f",
    error: "#e45649",
    warn: "#c18401",
    info: "#4078f2",
  },
  ansi: {
    black: "#000000", red: "#de3e35", green: "#3f953a", yellow: "#d2b67c",
    blue: "#2f5af3", magenta: "#950095", cyan: "#3f953a", white: "#bbbbbb",
    brightBlack: "#000000", brightRed: "#de3e35", brightGreen: "#3f953a", brightYellow: "#d2b67c",
    brightBlue: "#2f5af3", brightMagenta: "#a00095", brightCyan: "#3f953a", brightWhite: "#ffffff",
  },
  terminal: {
    background: "#f9f9f9",
    foreground: "#2a2c33",
    cursor: "#bbbbbb",
    cursorAccent: "#f9f9f9",
    selectionBackground: "#ededed",
  },
};
