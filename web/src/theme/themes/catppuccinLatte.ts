import type { Theme } from "../tokens";

// Catppuccin Latte — the warm light Catppuccin. Base #eff1f5, #4c4f69 text, mauve #8839ef accent,
// blue #1e66f5 links. ANSI palette is the upstream Catppuccin Latte scheme verbatim.
export const catppuccinLatte: Theme = {
  id: "catppuccin-latte",
  name: "Catppuccin Latte",
  type: "light",
  tokens: {
    bg: "#eff1f5",
    panel: "#e6e9ef",
    surface: "#dce0e8",
    elevated: "#ccd0da",
    code: "#e6e9ef",
    edge: "#ccd0da",
    edgeStrong: "#bcc0cc",
    text: "#4c4f69",
    textBright: "#11111b",
    textMuted: "#6c6f85",
    textDim: "#8c8fa1",
    accent: "#8839ef",
    accentHover: "#7a2fe0",
    accentFg: "#ffffff",
    link: "#1e66f5",
    selection: "#acb0be",
    success: "#40a02b",
    error: "#d20f39",
    warn: "#df8e1d",
    info: "#1e66f5",
  },
  ansi: {
    black: "#5c5f77", red: "#d20f39", green: "#40a02b", yellow: "#df8e1d",
    blue: "#1e66f5", magenta: "#ea76cb", cyan: "#179299", white: "#acb0be",
    brightBlack: "#6c6f85", brightRed: "#de293e", brightGreen: "#49af3d", brightYellow: "#eea02d",
    brightBlue: "#456eff", brightMagenta: "#fe85d8", brightCyan: "#2d9fa8", brightWhite: "#bcc0cc",
  },
  terminal: {
    background: "#eff1f5",
    foreground: "#4c4f69",
    cursor: "#dc8a78",
    cursorAccent: "#eff1f5",
    selectionBackground: "#acb0be",
  },
};
