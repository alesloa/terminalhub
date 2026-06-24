// Theme tokens are CSS custom properties holding "R G B" channels (set by web/src/theme/applyTheme).
// Wrapping them as rgb(var(--x) / <alpha-value>) lets Tailwind opacity modifiers (e.g. bg-accent/60)
// keep working. Class names mirror web/src/theme/tokens.ts — keep the two in sync by hand.
const c = (v) => `rgb(var(${v}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: c("--tr-bg"),
        panel: c("--tr-panel"),
        surface: c("--tr-surface"),
        elevated: c("--tr-elevated"),
        code: c("--tr-code"),
        edge: c("--tr-edge"),
        "edge-strong": c("--tr-edge-strong"),
        fg: c("--tr-text"),
        bright: c("--tr-text-bright"),
        muted: c("--tr-text-muted"),
        dim: c("--tr-text-dim"),
        accent: c("--tr-accent"),
        "accent-hover": c("--tr-accent-hover"),
        "accent-fg": c("--tr-accent-fg"),
        link: c("--tr-link"),
        selection: c("--tr-selection"),
        success: c("--tr-success"),
        error: c("--tr-error"),
        warn: c("--tr-warn"),
        info: c("--tr-info"),
      },
    },
  },
  plugins: [],
};
