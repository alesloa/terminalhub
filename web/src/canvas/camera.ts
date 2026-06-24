/**
 * The canvas "camera" — a single per-space view transform that replaces the old scroll-container +
 * cardPan + roomPan hybrid. One value drives the whole world (cards, folders, notes, widgets, and
 * floating rooms): they all render at raw world coordinates inside one layer transformed by
 * `cameraTransform(cam)`, so nothing can desync. transformOrigin on that layer MUST be "0 0" for the
 * math below to hold.
 *
 *   world point (wx, wy)  ──cam──▶  screen point (sx, sy)   sx = wx*zoom + x,  sy = wy*zoom + y
 *
 * `x`/`y` are the screen-pixel translation of the world origin; `zoom` is the scale. Pan is
 * unbounded (you can move anywhere); only zoom is clamped for sanity. Pure functions, no React — the
 * formulas here are the contract every coordinate site relies on.
 */

export interface Camera {
  /** screen-px translation of the world origin, X */
  x: number;
  /** screen-px translation of the world origin, Y */
  y: number;
  /** scale factor (1 = 100%) */
  zoom: number;
}

export interface Size {
  w: number;
  h: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const CAMERA_ZOOM_MIN = 0.25;
export const CAMERA_ZOOM_MAX = 2;

/** Clamp to the allowed zoom range and round to a whole percent (matches the zoom pill's display). */
export const clampZoom = (n: number) =>
  Math.min(CAMERA_ZOOM_MAX, Math.max(CAMERA_ZOOM_MIN, Math.round(n * 100) / 100));

export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

/** World coordinates → screen coordinates (relative to the viewport's top-left). */
export function worldToScreen(wx: number, wy: number, cam: Camera): { x: number; y: number } {
  return { x: wx * cam.zoom + cam.x, y: wy * cam.zoom + cam.y };
}

/** Screen coordinates (relative to the viewport's top-left) → world coordinates. */
export function screenToWorld(sx: number, sy: number, cam: Camera): { x: number; y: number } {
  return { x: (sx - cam.x) / cam.zoom, y: (sy - cam.y) / cam.zoom };
}

/** Pan by a screen-pixel delta. Unbounded — there is no clamp; Reset/Fit is the way back. */
export function panBy(cam: Camera, dxScreen: number, dyScreen: number): Camera {
  return { ...cam, x: cam.x + dxScreen, y: cam.y + dyScreen };
}

/**
 * Zoom to `nextZoom` while keeping the world point currently under (cursorSX, cursorSY) pinned to
 * that same screen pixel. cursor coords are relative to the viewport's top-left.
 */
export function zoomAround(cam: Camera, cursorSX: number, cursorSY: number, nextZoom: number): Camera {
  const z = clampZoom(nextZoom);
  if (z === cam.zoom) return cam;
  const w = screenToWorld(cursorSX, cursorSY, cam);
  return { x: cursorSX - w.x * z, y: cursorSY - w.y * z, zoom: z };
}

/** The CSS transform for the world layer. The layer's transformOrigin MUST be "0 0". */
export function cameraTransform(cam: Camera): string {
  return `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})`;
}

/**
 * A camera that centers `bounds` (world space) in `viewport` (screen space) with `padding` px of
 * breathing room, fitting it to whichever axis is tighter. Zoom is clamped. Used by Reset/Fit so an
 * unbounded pan can always be recovered. With no content, callers pass a degenerate box and get a
 * sensible centered view.
 */
export function fitToBounds(bounds: Bounds, viewport: Size, padding = 80): Camera {
  const bw = Math.max(1, bounds.maxX - bounds.minX);
  const bh = Math.max(1, bounds.maxY - bounds.minY);
  const availW = Math.max(1, viewport.w - padding * 2);
  const availH = Math.max(1, viewport.h - padding * 2);
  const zoom = clampZoom(Math.min(availW / bw, availH / bh));
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { zoom, x: viewport.w / 2 - cx * zoom, y: viewport.h / 2 - cy * zoom };
}
