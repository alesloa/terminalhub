import type { Theme } from "../tokens";

// Tokyo Night (Storm) — muted neon over deep indigo. #24283b base, #1f2335 chrome, #c0caf5 text,
// blue #7aa2f7 accent. ANSI palette is the upstream TokyoNight Storm scheme verbatim.
export const tokyoNight: Theme = {
  id: "tokyo-night",
  name: "Tokyo Night",
  type: "dark",
  tokens: {
    bg: "#1f2335",
    panel: "#24283b",
    surface: "#2c3148",
    elevated: "#353b53",
    code: "#1b1e2e",
    edge: "#2c3148",
    edgeStrong: "#3b4261",
    text: "#c0caf5",
    textBright: "#ffffff",
    textMuted: "#9aa5ce",
    textDim: "#565f89",
    accent: "#7aa2f7",
    accentHover: "#6a92e7",
    accentFg: "#1f2335",
    link: "#7dcfff",
    selection: "#364a82",
    success: "#9ece6a",
    error: "#f7768e",
    warn: "#e0af68",
    info: "#7aa2f7",
  },
  ansi: {
    black: "#1d202f", red: "#f7768e", green: "#9ece6a", yellow: "#e0af68",
    blue: "#7aa2f7", magenta: "#bb9af7", cyan: "#7dcfff", white: "#a9b1d6",
    brightBlack: "#4e5575", brightRed: "#f7768e", brightGreen: "#9ece6a", brightYellow: "#e0af68",
    brightBlue: "#7aa2f7", brightMagenta: "#bb9af7", brightCyan: "#7dcfff", brightWhite: "#c0caf5",
  },
  terminal: {
    background: "#24283b",
    foreground: "#c0caf5",
    cursor: "#c0caf5",
    cursorAccent: "#24283b",
    selectionBackground: "#364a82",
  },
};
