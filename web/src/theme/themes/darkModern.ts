import type { Theme } from "../tokens";

// Dark Modern — VS Code's default dark theme, built on the maintainer's chosen anchors
// (#1b1b1b darkest, #292929 elevated, #cccccc text) with the signature #0078d4 blue accent.
// ANSI is VS Code's canonical default-dark terminal palette.
export const darkModern: Theme = {
  id: "dark-modern",
  name: "Dark Modern",
  type: "dark",
  tokens: {
    bg: "#1b1b1b",
    panel: "#1f1f1f",
    surface: "#242424",
    elevated: "#292929",
    code: "#181818",
    edge: "#2b2b2b",
    edgeStrong: "#3c3c3c",
    text: "#cccccc",
    textBright: "#ffffff",
    textMuted: "#9d9d9d",
    textDim: "#6e7681",
    accent: "#0078d4",
    accentHover: "#026ec1",
    accentFg: "#ffffff",
    link: "#4daafc",
    selection: "#264f78",
    success: "#2ea043",
    error: "#f85149",
    warn: "#e2c08d",
    info: "#0078d4",
  },
  ansi: {
    black: "#000000", red: "#cd3131", green: "#0dbc79", yellow: "#e5e510",
    blue: "#2472c8", magenta: "#bc3fbc", cyan: "#11a8cd", white: "#e5e5e5",
    brightBlack: "#666666", brightRed: "#f14c4c", brightGreen: "#23d18b", brightYellow: "#f5f543",
    brightBlue: "#3b8eea", brightMagenta: "#d670d6", brightCyan: "#29b8db", brightWhite: "#e5e5e5",
  },
  terminal: {
    background: "#1b1b1b",
    foreground: "#cccccc",
    cursor: "#cccccc",
    cursorAccent: "#1b1b1b",
    selectionBackground: "#264f78",
  },
};
