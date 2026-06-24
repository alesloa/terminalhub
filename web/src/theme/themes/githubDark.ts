import type { Theme } from "../tokens";

// GitHub Dark — GitHub's official dark default. Canvas #0d1117 over #010409, #e6edf3 text, blue
// #2f81f7 accent. ANSI is the upstream GitHub Dark Default scheme; terminal selection uses a
// muted blue (#1f3a5f) in place of the scheme's near-white so text stays legible.
export const githubDark: Theme = {
  id: "github-dark",
  name: "GitHub Dark",
  type: "dark",
  tokens: {
    bg: "#010409",
    panel: "#0d1117",
    surface: "#161b22",
    elevated: "#21262d",
    code: "#0d1117",
    edge: "#30363d",
    edgeStrong: "#444c56",
    text: "#e6edf3",
    textBright: "#ffffff",
    textMuted: "#7d8590",
    textDim: "#6e7681",
    accent: "#2f81f7",
    accentHover: "#1f6feb",
    accentFg: "#ffffff",
    link: "#2f81f7",
    selection: "#1f3a5f",
    success: "#3fb950",
    error: "#f85149",
    warn: "#d29922",
    info: "#58a6ff",
  },
  ansi: {
    black: "#484f58", red: "#ff7b72", green: "#3fb950", yellow: "#d29922",
    blue: "#58a6ff", magenta: "#bc8cff", cyan: "#39c5cf", white: "#b1bac4",
    brightBlack: "#6e7681", brightRed: "#ffa198", brightGreen: "#56d364", brightYellow: "#e3b341",
    brightBlue: "#79c0ff", brightMagenta: "#d2a8ff", brightCyan: "#56d4dd", brightWhite: "#ffffff",
  },
  terminal: {
    background: "#0d1117",
    foreground: "#e6edf3",
    cursor: "#2f81f7",
    cursorAccent: "#0d1117",
    selectionBackground: "#1f3a5f",
  },
};
