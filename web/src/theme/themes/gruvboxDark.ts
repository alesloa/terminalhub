import type { Theme } from "../tokens";

// Gruvbox Dark — warm, retro, low-contrast. #282828 base over #1d2021, cream #ebdbb2 text, orange
// #fe8019 accent, aqua #83a598 links. ANSI palette is the upstream Gruvbox Dark scheme verbatim.
export const gruvboxDark: Theme = {
  id: "gruvbox-dark",
  name: "Gruvbox Dark",
  type: "dark",
  tokens: {
    bg: "#1d2021",
    panel: "#282828",
    surface: "#3c3836",
    elevated: "#504945",
    code: "#161819",
    edge: "#3c3836",
    edgeStrong: "#504945",
    text: "#ebdbb2",
    textBright: "#fbf1c7",
    textMuted: "#bdae93",
    textDim: "#928374",
    accent: "#fe8019",
    accentHover: "#f06010",
    accentFg: "#1d2021",
    link: "#83a598",
    selection: "#504945",
    success: "#b8bb26",
    error: "#fb4934",
    warn: "#fabd2f",
    info: "#83a598",
  },
  ansi: {
    black: "#282828", red: "#cc241d", green: "#98971a", yellow: "#d79921",
    blue: "#458588", magenta: "#b16286", cyan: "#689d6a", white: "#a89984",
    brightBlack: "#928374", brightRed: "#fb4934", brightGreen: "#b8bb26", brightYellow: "#fabd2f",
    brightBlue: "#83a598", brightMagenta: "#d3869b", brightCyan: "#8ec07c", brightWhite: "#ebdbb2",
  },
  terminal: {
    background: "#282828",
    foreground: "#ebdbb2",
    cursor: "#ebdbb2",
    cursorAccent: "#282828",
    selectionBackground: "#665c54",
  },
};
