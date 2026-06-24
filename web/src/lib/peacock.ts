/**
 * Peacock chrome tints (VS Code "Peacock" extension, ported to the room IDE). The room
 * frame sets the `--peacock` CSS variable to the workspace color; these color-mix strings
 * read it from anywhere in the subtree. When the workspace has no color the variable is
 * unset and color-mix falls back to the original dark surface, so an uncolored room looks
 * exactly as it did before — no tint leaks in.
 *
 * BAR  — top bar, activity bar, bottom bar (strongest tint, still dark enough for text).
 *        The file explorer / scm panel body is intentionally left default (untinted).
 * SEAM — the 1px borders between regions and the window frame outline.
 */
export const PEACOCK_BAR = "color-mix(in srgb, var(--peacock, rgb(var(--tr-bg))) 30%, rgb(var(--tr-bg)))";
export const PEACOCK_SEAM = "color-mix(in srgb, var(--peacock, rgb(var(--tr-edge))) 55%, rgb(var(--tr-edge)))";
