import type { Theme } from "../tokens";

// Terminal Hub — the default house theme. A neutral dark scale anchored on a #141414 canvas with a
// green-500 accent. Surfaces step up from the canvas for VS Code-style depth; `code` (#111110) is
// the warm recessed/inset tone. Text: #cccccc primary, #9d9d9d secondary (neutral, VS Code-ish).
export const terminalhub: Theme = {
  id: "terminalhub",
  name: "Terminal Hub",
  type: "dark",
  tokens: {
    bg: "#141414",
    panel: "#1e1e1e",
    surface: "#262626",
    elevated: "#2e2e2e",
    code: "#111110",
    edge: "#2a2a2a",
    edgeStrong: "#3a3a3a",
    text: "#cccccc",
    textBright: "#ffffff",
    textMuted: "#9d9d9d",
    textDim: "#717171",
    accent: "#22c55e",
    accentHover: "#16a34a",
    accentFg: "#ffffff",
    link: "#4ade80",
    selection: "#14532d",
    success: "#22c55e",
    error: "#ef4444",
    warn: "#f59e0b",
    info: "#60a5fa",
  },
  ansi: {
    black: "#0a0a0a", red: "#ef4444", green: "#22c55e", yellow: "#eab308",
    blue: "#3b82f6", magenta: "#a855f7", cyan: "#06b6d4", white: "#d4d4d8",
    brightBlack: "#71717a", brightRed: "#f87171", brightGreen: "#4ade80", brightYellow: "#facc15",
    brightBlue: "#60a5fa", brightMagenta: "#c084fc", brightCyan: "#22d3ee", brightWhite: "#fafafa",
  },
  terminal: {
    background: "#141414",
    foreground: "#cbcbcb",
    cursor: "#cbcbcb",
    cursorAccent: "#141414",
    selectionBackground: "#14532d",
  },
};
