import type { StageDock } from "../../api/types";

// Frosted-panel defaults — mirror server DEFAULT_STAGE_DOCK (store.ts). Used as the fallback before
// /api/settings resolves so the dock paints with the panel immediately.
export const DEFAULT_STAGE_DOCK: StageDock = {
  enabled: true,
  color: null,
  opacity: 55,
  blur: 16,
  borderColor: null,
  borderOpacity: 40,
};

// Theme-tracking surface colors used when the user hasn't pinned an explicit hex (color === null):
// the fill follows the elevated surface, the border follows the strong edge — so the dock matches the
// active theme out of the box and still reacts to theme switches.
const FILL_VAR = "--tr-elevated";
const BORDER_VAR = "--tr-edge-strong";

// "#rgb" / "#rrggbb" + a 0-100 opacity → an rgba() string. opacity 0 yields a fully transparent color
// (no fill / no border), which is how the picker's "Transparent" option is represented.
function hexToRgba(hex: string, opacity: number): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`;
}

// A null (theme-tracking) color mixed to the requested opacity against transparent, so it works for any
// theme and collapses to fully transparent at opacity 0.
const themeMix = (cssVar: string, opacity: number) =>
  `color-mix(in srgb, rgb(var(${cssVar})) ${opacity}%, transparent)`;

// The panel's fill (background). Pinned hex → rgba; null → theme elevated surface. Transparent at 0.
export const dockFill = (d: StageDock): string =>
  d.color ? hexToRgba(d.color, d.opacity) : themeMix(FILL_VAR, d.opacity);

// The panel's border color. Pinned hex → rgba; null → theme strong edge. Transparent at 0.
export const dockBorder = (d: StageDock): string =>
  d.borderColor ? hexToRgba(d.borderColor, d.borderOpacity) : themeMix(BORDER_VAR, d.borderOpacity);
