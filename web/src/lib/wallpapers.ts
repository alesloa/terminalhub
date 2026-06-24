// The canvas wallpaper roster: built-in photo wallpapers shipped as static assets
// (web/public/wallpapers, all CC BY-SA 4.0 — see that folder's CREDITS.md) plus a set of dark CSS
// gradients. User uploads aren't listed here; they come from GET /api/wallpapers and are referenced
// by the id `upload:<wp_id>`. Every entry's `css` is a ready-to-use `background` shorthand value.

import type { CanvasBackground } from "../api/types";

export interface WallpaperDef {
  id: string;                  // wallpaper id stored in CanvasBackground.wallpaper
  name: string;
  kind: "photo" | "gradient";
  css: string;                 // a CSS `background` shorthand (image or gradient)
}

// The theme-default backdrop (mirrors the server's DEFAULT_CANVAS_BG): a solid canvas with no chosen
// color (falls back to the theme's --tr-bg), no wallpaper, scrim off. Used as the fallback before
// settings load and as the seed when clearing a custom background.
export const DEFAULT_CANVAS_BACKGROUND: CanvasBackground = { kind: "solid", color: null, wallpaper: null, overlay: false, dim: 50 };

/** A `background` shorthand that covers the area with an image url, centered, no repeat. */
export function coverCss(url: string): string {
  return `center / cover no-repeat url("${url}")`;
}

// Built-in photo wallpapers (KDE Plasma Workspace Wallpapers, CC BY-SA 4.0). Served from /wallpapers.
const PHOTO_SLUGS: { slug: string; name: string }[] = [
  { slug: "orionids", name: "Orionids" },
  { slug: "nuvole", name: "Nuvole" },
  { slug: "nexus", name: "Nexus" },
  { slug: "patak", name: "Patak" },
  { slug: "milkyway", name: "Milky Way" },
  { slug: "kay", name: "Kay" },
  { slug: "flow", name: "Flow" },
  { slug: "mountain", name: "Mountain" },
];
export const PHOTO_WALLPAPERS: WallpaperDef[] = PHOTO_SLUGS.map(p => ({
  id: p.slug,
  name: p.name,
  kind: "photo",
  css: coverCss(`/wallpapers/${p.slug}.jpg`),
}));

// Dark CSS gradients — cohesive with the app chrome, no asset bytes. Like Linux distros' built-in
// gradient backgrounds. The id is prefixed `gradient:` so it never collides with a photo slug.
export const GRADIENT_WALLPAPERS: WallpaperDef[] = [
  { id: "gradient:midnight", name: "Midnight", kind: "gradient", css: "linear-gradient(150deg, #0b1020 0%, #131b33 52%, #090d18 100%)" },
  { id: "gradient:aurora", name: "Aurora", kind: "gradient", css: "linear-gradient(160deg, #07131a 0%, #0c2a2a 55%, #07140f 100%)" },
  { id: "gradient:ocean", name: "Ocean", kind: "gradient", css: "radial-gradient(125% 125% at 28% 18%, #11263f 0%, #0a1526 55%, #060b14 100%)" },
  { id: "gradient:plum", name: "Plum", kind: "gradient", css: "linear-gradient(150deg, #150a1f 0%, #2a1140 55%, #100a1c 100%)" },
  { id: "gradient:rose", name: "Rosewood", kind: "gradient", css: "linear-gradient(150deg, #1a0a14 0%, #3a1130 55%, #120813 100%)" },
  { id: "gradient:ember", name: "Ember", kind: "gradient", css: "linear-gradient(150deg, #1a0d08 0%, #3a160c 55%, #140a07 100%)" },
  { id: "gradient:slate", name: "Slate", kind: "gradient", css: "linear-gradient(135deg, #15171a 0%, #20242b 50%, #0f1113 100%)" },
  { id: "gradient:mono", name: "Vignette", kind: "gradient", css: "radial-gradient(130% 130% at 50% 0%, #1c1f25 0%, #0c0e11 60%, #060708 100%)" },
];

export const BUILTIN_WALLPAPERS: WallpaperDef[] = [...PHOTO_WALLPAPERS, ...GRADIENT_WALLPAPERS];
const BY_ID = new Map(BUILTIN_WALLPAPERS.map(w => [w.id, w]));

/** True for the `upload:<id>` form; returns the raw wallpaper id (or null if not an upload ref). */
export function uploadIdOf(wallpaperId: string): string | null {
  return wallpaperId.startsWith("upload:") ? wallpaperId.slice("upload:".length) : null;
}
export function uploadRef(wpId: string): string { return `upload:${wpId}`; }

/** Resolve a wallpaper id to a `background` CSS value. Uploads need their fetched data URL passed in
 *  (`uploadUrl`); returns null while that's still loading or the id is unknown. */
export function resolveWallpaperCss(wallpaperId: string | null, uploadUrl?: string | null): string | null {
  if (!wallpaperId) return null;
  const builtin = BY_ID.get(wallpaperId);
  if (builtin) return builtin.css;
  if (uploadIdOf(wallpaperId)) return uploadUrl ? coverCss(uploadUrl) : null;
  return null;
}
