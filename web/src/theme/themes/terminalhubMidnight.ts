import type { Theme } from "../tokens";

// Terminal Hub Midnight — the app's original blue-tinted dark palette, preserved verbatim so users
// who prefer the old look lose nothing. Token values are the exact hex the app shipped before
// the theme system landed.
export const terminalhubMidnight: Theme = {
  id: "terminalhub-midnight",
  name: "Terminal Hub Midnight",
  type: "dark",
  tokens: {
    bg: "#0b0e14",
    panel: "#11141c",
    surface: "#151a26",
    elevated: "#1b2030",
    code: "#090c12",
    edge: "#222838",
    edgeStrong: "#2c3346",
    text: "#cdd6f4",
    textBright: "#f3f4f6",
    textMuted: "#94a3b8",
    textDim: "#64748b",
    accent: "#3b82f6",
    accentHover: "#2563eb",
    accentFg: "#ffffff",
    link: "#93c5fd",
    selection: "#264f78",
    success: "#22c55e",
    error: "#f43f5e",
    warn: "#fbbf24",
    info: "#60a5fa",
  },
  ansi: {
    black: "#1b2030", red: "#f43f5e", green: "#22c55e", yellow: "#fbbf24",
    blue: "#3b82f6", magenta: "#a855f7", cyan: "#06b6d4", white: "#cdd6f4",
    brightBlack: "#64748b", brightRed: "#fb7185", brightGreen: "#4ade80", brightYellow: "#fcd34d",
    brightBlue: "#60a5fa", brightMagenta: "#c084fc", brightCyan: "#22d3ee", brightWhite: "#f3f4f6",
  },
  terminal: {
    background: "#0b0e14",
    foreground: "#cbd5e1",
    cursor: "#f3f4f6",
    cursorAccent: "#0b0e14",
    selectionBackground: "#264f78",
  },
};
