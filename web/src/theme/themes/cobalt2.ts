import type { Theme } from "../tokens";

// Cobalt2 — Wes Bos's high-contrast deep-blue theme. #193549 panels over #132738 terminal, white
// text, signature yellow #ffc600 accent. ANSI palette is the upstream Cobalt2 scheme verbatim.
export const cobalt2: Theme = {
  id: "cobalt2",
  name: "Cobalt2",
  type: "dark",
  tokens: {
    bg: "#102433",
    panel: "#193549",
    surface: "#234e6c",
    elevated: "#2d5e80",
    code: "#0c1e2c",
    edge: "#234e6c",
    edgeStrong: "#2d6188",
    text: "#ffffff",
    textBright: "#ffffff",
    textMuted: "#aebfcc",
    textDim: "#6f8ba0",
    accent: "#ffc600",
    accentHover: "#f0bb00",
    accentFg: "#193549",
    link: "#ffc600",
    selection: "#18354f",
    success: "#3bd01d",
    error: "#ff628c",
    warn: "#ffc600",
    info: "#0088ff",
  },
  ansi: {
    black: "#000000", red: "#ff0000", green: "#38de21", yellow: "#ffe50a",
    blue: "#1460d2", magenta: "#ff005d", cyan: "#00bbbb", white: "#bbbbbb",
    brightBlack: "#555555", brightRed: "#f40e17", brightGreen: "#3bd01d", brightYellow: "#edc809",
    brightBlue: "#5555ff", brightMagenta: "#ff55ff", brightCyan: "#6ae3fa", brightWhite: "#ffffff",
  },
  terminal: {
    background: "#132738",
    foreground: "#ffffff",
    cursor: "#f0cc09",
    cursorAccent: "#132738",
    selectionBackground: "#18354f",
  },
};
