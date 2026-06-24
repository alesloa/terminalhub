import type { Theme } from "../tokens";

// Night Owl — Sarah Drasner's deep-ocean theme tuned for low light. #011627 navy base, #d6deeb
// text, blue #82aaff accent, teal #7fdbca links. ANSI palette is the upstream Night Owl scheme.
export const nightOwl: Theme = {
  id: "night-owl",
  name: "Night Owl",
  type: "dark",
  tokens: {
    bg: "#010e1a",
    panel: "#011627",
    surface: "#0b2942",
    elevated: "#11324d",
    code: "#00111f",
    edge: "#0e2d44",
    edgeStrong: "#1d3b53",
    text: "#d6deeb",
    textBright: "#ffffff",
    textMuted: "#8badc4",
    textDim: "#637777",
    accent: "#82aaff",
    accentHover: "#6d99f5",
    accentFg: "#011627",
    link: "#7fdbca",
    selection: "#1d3b53",
    success: "#22da6e",
    error: "#ef5350",
    warn: "#addb67",
    info: "#82aaff",
  },
  ansi: {
    black: "#011627", red: "#ef5350", green: "#22da6e", yellow: "#addb67",
    blue: "#82aaff", magenta: "#c792ea", cyan: "#21c7a8", white: "#ffffff",
    brightBlack: "#575656", brightRed: "#ef5350", brightGreen: "#22da6e", brightYellow: "#ffeb95",
    brightBlue: "#82aaff", brightMagenta: "#c792ea", brightCyan: "#7fdbca", brightWhite: "#ffffff",
  },
  terminal: {
    background: "#011627",
    foreground: "#d6deeb",
    cursor: "#7e57c2",
    cursorAccent: "#011627",
    selectionBackground: "#5f7e97",
  },
};
