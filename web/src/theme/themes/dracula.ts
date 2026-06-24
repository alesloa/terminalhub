import type { Theme } from "../tokens";

// Dracula — the famous purple/pink dark theme. #282a36 base, #44475a current-line, #f8f8f2 text,
// purple #bd93f9 accent, cyan #8be9fd links. ANSI palette is the upstream Dracula scheme verbatim.
export const dracula: Theme = {
  id: "dracula",
  name: "Dracula",
  type: "dark",
  tokens: {
    bg: "#21222c",
    panel: "#282a36",
    surface: "#343746",
    elevated: "#424450",
    code: "#1e1f29",
    edge: "#3a3c4e",
    edgeStrong: "#4d4f68",
    text: "#f8f8f2",
    textBright: "#ffffff",
    textMuted: "#a8acc4",
    textDim: "#6272a4",
    accent: "#bd93f9",
    accentHover: "#a87ee8",
    accentFg: "#21222c",
    link: "#8be9fd",
    selection: "#44475a",
    success: "#50fa7b",
    error: "#ff5555",
    warn: "#f1fa8c",
    info: "#8be9fd",
  },
  ansi: {
    black: "#21222c", red: "#ff5555", green: "#50fa7b", yellow: "#f1fa8c",
    blue: "#bd93f9", magenta: "#ff79c6", cyan: "#8be9fd", white: "#f8f8f2",
    brightBlack: "#6272a4", brightRed: "#ff6e6e", brightGreen: "#69ff94", brightYellow: "#ffffa5",
    brightBlue: "#d6acff", brightMagenta: "#ff92df", brightCyan: "#a4ffff", brightWhite: "#ffffff",
  },
  terminal: {
    background: "#282a36",
    foreground: "#f8f8f2",
    cursor: "#f8f8f2",
    cursorAccent: "#282a36",
    selectionBackground: "#44475a",
  },
};
