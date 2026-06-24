import type { Theme } from "../tokens";

// GitHub Light — GitHub's official light default. White canvas, #f6f8fa chrome, #1f2328 text, blue
// #0969da accent. ANSI is the upstream GitHub Light Default scheme; terminal cursor/selection use
// GitHub's blue + a soft #b6d7ff highlight (the scheme stores selection as the dark fg color).
export const githubLight: Theme = {
  id: "github-light",
  name: "GitHub Light",
  type: "light",
  tokens: {
    bg: "#ffffff",
    panel: "#f6f8fa",
    surface: "#eaeef2",
    elevated: "#e1e6eb",
    code: "#f6f8fa",
    edge: "#d0d7de",
    edgeStrong: "#afb8c1",
    text: "#1f2328",
    textBright: "#010409",
    textMuted: "#656d76",
    textDim: "#818b98",
    accent: "#0969da",
    accentHover: "#0860c8",
    accentFg: "#ffffff",
    link: "#0969da",
    selection: "#b6d7ff",
    success: "#1a7f37",
    error: "#cf222e",
    warn: "#9a6700",
    info: "#0969da",
  },
  ansi: {
    black: "#24292f", red: "#cf222e", green: "#116329", yellow: "#4d2d00",
    blue: "#0969da", magenta: "#8250df", cyan: "#1b7c83", white: "#6e7781",
    brightBlack: "#57606a", brightRed: "#a40e26", brightGreen: "#1a7f37", brightYellow: "#633c01",
    brightBlue: "#218bff", brightMagenta: "#a475f9", brightCyan: "#3192aa", brightWhite: "#8c959f",
  },
  terminal: {
    background: "#ffffff",
    foreground: "#1f2328",
    cursor: "#0969da",
    cursorAccent: "#ffffff",
    selectionBackground: "#b6d7ff",
  },
};
