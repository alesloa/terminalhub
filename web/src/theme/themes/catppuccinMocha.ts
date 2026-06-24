import type { Theme } from "../tokens";

// Catppuccin Mocha — soft pastel dark. Base #1e1e2e, surfaces step through #313244/#45475a,
// #cdd6f4 text, mauve #cba6f7 accent. ANSI palette is the upstream Catppuccin Mocha scheme.
export const catppuccinMocha: Theme = {
  id: "catppuccin-mocha",
  name: "Catppuccin Mocha",
  type: "dark",
  tokens: {
    bg: "#181825",
    panel: "#1e1e2e",
    surface: "#313244",
    elevated: "#45475a",
    code: "#11111b",
    edge: "#313244",
    edgeStrong: "#45475a",
    text: "#cdd6f4",
    textBright: "#ffffff",
    textMuted: "#a6adc8",
    textDim: "#6c7086",
    accent: "#cba6f7",
    accentHover: "#b48ef0",
    accentFg: "#1e1e2e",
    link: "#89b4fa",
    selection: "#585b70",
    success: "#a6e3a1",
    error: "#f38ba8",
    warn: "#f9e2af",
    info: "#89b4fa",
  },
  ansi: {
    black: "#45475a", red: "#f38ba8", green: "#a6e3a1", yellow: "#f9e2af",
    blue: "#89b4fa", magenta: "#f5c2e7", cyan: "#94e2d5", white: "#a6adc8",
    brightBlack: "#585b70", brightRed: "#f37799", brightGreen: "#89d88b", brightYellow: "#ebd391",
    brightBlue: "#74a8fc", brightMagenta: "#f2aede", brightCyan: "#6bd7ca", brightWhite: "#bac2de",
  },
  terminal: {
    background: "#1e1e2e",
    foreground: "#cdd6f4",
    cursor: "#f5e0dc",
    cursorAccent: "#1e1e2e",
    selectionBackground: "#585b70",
  },
};
