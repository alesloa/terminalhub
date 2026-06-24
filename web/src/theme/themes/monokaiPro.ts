import type { Theme } from "../tokens";

// Monokai Pro — the modern, desaturated Monokai. #2d2a2e aubergine base, #fcfcfa text, amber
// #ffd866 accent, pink/green syntax. ANSI palette is the upstream Monokai Pro scheme verbatim.
export const monokaiPro: Theme = {
  id: "monokai-pro",
  name: "Monokai Pro",
  type: "dark",
  tokens: {
    bg: "#221f22",
    panel: "#2d2a2e",
    surface: "#363336",
    elevated: "#403e41",
    code: "#1c191c",
    edge: "#403e41",
    edgeStrong: "#5b595c",
    text: "#fcfcfa",
    textBright: "#ffffff",
    textMuted: "#c1c0c0",
    textDim: "#727072",
    accent: "#ffd866",
    accentHover: "#f5c84e",
    accentFg: "#2d2a2e",
    link: "#78dce8",
    selection: "#5b595c",
    success: "#a9dc76",
    error: "#ff6188",
    warn: "#ffd866",
    info: "#78dce8",
  },
  ansi: {
    black: "#2d2a2e", red: "#ff6188", green: "#a9dc76", yellow: "#ffd866",
    blue: "#fc9867", magenta: "#ab9df2", cyan: "#78dce8", white: "#fcfcfa",
    brightBlack: "#727072", brightRed: "#ff6188", brightGreen: "#a9dc76", brightYellow: "#ffd866",
    brightBlue: "#fc9867", brightMagenta: "#ab9df2", brightCyan: "#78dce8", brightWhite: "#fcfcfa",
  },
  terminal: {
    background: "#2d2a2e",
    foreground: "#fcfcfa",
    cursor: "#c1c0c0",
    cursorAccent: "#2d2a2e",
    selectionBackground: "#5b595c",
  },
};
