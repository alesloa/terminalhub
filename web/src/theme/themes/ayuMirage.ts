import type { Theme } from "../tokens";

// Ayu Mirage — the muted mid-dark Ayu variant. #1f2430 base, #cccac2 text, warm #ffcc66 accent,
// blue #73d0ff links. ANSI is the upstream Ayu Mirage scheme; terminal selection uses a muted
// slate (#33415e) in place of the scheme's full-strength blue so selected text stays readable.
export const ayuMirage: Theme = {
  id: "ayu-mirage",
  name: "Ayu Mirage",
  type: "dark",
  tokens: {
    bg: "#1a1f29",
    panel: "#1f2430",
    surface: "#272d3a",
    elevated: "#2d3441",
    code: "#171b24",
    edge: "#272d3a",
    edgeStrong: "#343b4a",
    text: "#cccac2",
    textBright: "#ffffff",
    textMuted: "#9a9690",
    textDim: "#5c6773",
    accent: "#ffcc66",
    accentHover: "#f5bf4f",
    accentFg: "#1f2430",
    link: "#73d0ff",
    selection: "#33415e",
    success: "#87d96c",
    error: "#f28779",
    warn: "#ffd173",
    info: "#73d0ff",
  },
  ansi: {
    black: "#171b24", red: "#ed8274", green: "#87d96c", yellow: "#facc6e",
    blue: "#6dcbfa", magenta: "#dabafa", cyan: "#90e1c6", white: "#c7c7c7",
    brightBlack: "#686868", brightRed: "#f28779", brightGreen: "#d5ff80", brightYellow: "#ffd173",
    brightBlue: "#73d0ff", brightMagenta: "#dfbfff", brightCyan: "#95e6cb", brightWhite: "#ffffff",
  },
  terminal: {
    background: "#1f2430",
    foreground: "#cccac2",
    cursor: "#ffcc66",
    cursorAccent: "#1f2430",
    selectionBackground: "#33415e",
  },
};
