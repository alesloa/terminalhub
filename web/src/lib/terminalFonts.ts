// The terminal font stack. MesloLGS Nerd Font leads so powerline / devicon glyphs (p10k, starship,
// coralline-style statuslines) render instead of tofu boxes; the rest are graceful system fallbacks.
// A user-picked font is prepended but ALWAYS keeps Meslo in the chain, so glyphs still resolve even
// when the chosen font has no Nerd Font variant. Picker `value`s are full CSS font-family strings, so
// applying one is a plain `term.options.fontFamily = value` with no string building at the call site.

export const DEFAULT_TERM_FONT = "MesloLGS Nerd Font, ui-monospace, SFMono-Regular, Menlo, monospace";

// Kept after every user-picked font so Nerd Font glyphs + the system monospace still fill any gaps.
const NERD_FALLBACK = '"MesloLGS Nerd Font", ui-monospace, SFMono-Regular, Menlo, monospace';

export const TERM_FONT_OPTIONS: { label: string; value: string }[] = [
  { label: "MesloLGS Nerd Font (default)", value: DEFAULT_TERM_FONT },
  { label: "JetBrains Mono", value: `"JetBrains Mono", ${NERD_FALLBACK}` },
  { label: "Fira Code", value: `"Fira Code", ${NERD_FALLBACK}` },
  { label: "Cascadia Code", value: `"Cascadia Code", ${NERD_FALLBACK}` },
  { label: "IBM Plex Mono", value: `"IBM Plex Mono", ${NERD_FALLBACK}` },
  { label: "Source Code Pro", value: `"Source Code Pro", ${NERD_FALLBACK}` },
  { label: "SF Mono", value: `"SF Mono", ${NERD_FALLBACK}` },
  { label: "Hack", value: `"Hack", ${NERD_FALLBACK}` },
  { label: "Menlo", value: `Menlo, ${NERD_FALLBACK}` },
];

// Font weights offered in the picker (xterm's FontWeight accepts these numeric values). 400 = default.
export const TERM_FONT_WEIGHTS = [300, 400, 500, 600, 700] as const;

// Scrollback line counts offered in the picker. 1000 is xterm's default in-pane buffer (tmux still
// holds the full host-side history regardless — this only sizes what xterm keeps for selection/scroll).
export const TERM_SCROLLBACKS = [1000, 5000, 10000, 50000] as const;
