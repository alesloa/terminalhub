import type { Theme } from "../tokens";

// One Dark — Atom's iconic dark theme (One Dark Pro). Blue-grey #282c34 editor surface, soft
// #abb2bf text, blue #61afef accent. ANSI palette is the upstream Atom One Dark scheme verbatim.
export const atomOneDark: Theme = {
  id: "atom-one-dark",
  name: "One Dark",
  type: "dark",
  tokens: {
    bg: "#21252b",
    panel: "#282c34",
    surface: "#2c313a",
    elevated: "#3a3f4b",
    code: "#1b1e24",
    edge: "#3a3f4b",
    edgeStrong: "#4b5263",
    text: "#abb2bf",
    textBright: "#ffffff",
    textMuted: "#828997",
    textDim: "#5c6370",
    accent: "#61afef",
    accentHover: "#4d9ee6",
    accentFg: "#ffffff",
    link: "#61afef",
    selection: "#3e4451",
    success: "#98c379",
    error: "#e06c75",
    warn: "#e5c07b",
    info: "#61afef",
  },
  ansi: {
    black: "#21252b", red: "#e06c75", green: "#98c379", yellow: "#e5c07b",
    blue: "#61afef", magenta: "#c678dd", cyan: "#56b6c2", white: "#abb2bf",
    brightBlack: "#767676", brightRed: "#e06c75", brightGreen: "#98c379", brightYellow: "#e5c07b",
    brightBlue: "#61afef", brightMagenta: "#c678dd", brightCyan: "#56b6c2", brightWhite: "#abb2bf",
  },
  terminal: {
    background: "#21252b",
    foreground: "#abb2bf",
    cursor: "#528bff",
    cursorAccent: "#21252b",
    selectionBackground: "#3e4451",
  },
};
