import type { DragEvent } from "react";

/** Private MIME type marking a drag that started on an Explorer row (an internal move), so drop
 *  targets can tell it apart from an OS file drag (which carries the "Files" type instead). Its
 *  value is a JSON array of the dragged absolute paths (one, or the whole multi-selection). */
export const MOVE_TYPE = "application/x-terminalhub-move";

// The absolute paths being dragged within the Explorer (one row, or the whole multi-selection).
// Held at module scope (only one drag happens at a time) because a drop target needs them during
// `dragover` to validate the move — and there the DataTransfer's getData() is blocked for security;
// only `.types` is visible. Set on drag start, cleared on drag end.
let dragged: string[] | null = null;
export const draggedPaths = (): string[] => dragged ?? [];
export const clearDrag = () => { dragged = null; };

/** Parse the MOVE_TYPE payload (a JSON path array) read on drop; [] if absent/malformed. */
export function parseMovePaths(raw: string): string[] {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((p): p is string => typeof p === "string") : []; }
  catch { return []; }
}

/**
 * Start dragging one or more file/folder paths. Drops the first as `text/plain` (so the terminal and
 * any other target receive a usable path) and the full set as MOVE_TYPE (so Explorer folders move
 * them all). effectAllowed is "copyMove": the terminal copies the path as text; a folder moves it.
 *
 * Also swaps the browser's default drag ghost — a snapshot of the row that carries its
 * hover/selected background box — for a transparent clone, so only the icon + name follow
 * the cursor with no box behind it. The git status letter (M/U/…) is stripped from the clone; when
 * more than one item is dragged, a small count badge is appended so the ghost reads "name  +3".
 */
export function startPathDrag(e: DragEvent<HTMLElement>, paths: string[]) {
  dragged = paths;
  e.dataTransfer.setData("text/plain", paths[0] ?? "");
  e.dataTransfer.setData(MOVE_TYPE, JSON.stringify(paths));
  e.dataTransfer.effectAllowed = "copyMove";

  const row = e.currentTarget;
  const ghost = row.cloneNode(true) as HTMLElement;
  ghost.querySelectorAll("[data-deco-letter]").forEach((n) => n.remove());
  Object.assign(ghost.style, {
    position: "fixed",
    top: "-9999px",
    left: "0",
    width: `${row.offsetWidth}px`,
    background: "transparent", // inline wins over the row's bg-* class → no box in the ghost
    pointerEvents: "none",
    display: "flex",
    alignItems: "center",
  });
  if (paths.length > 1) {
    const badge = document.createElement("span");
    badge.textContent = `+${paths.length - 1}`;
    Object.assign(badge.style, {
      marginLeft: "6px",
      padding: "0 6px",
      borderRadius: "9px",
      fontSize: "11px",
      lineHeight: "16px",
      color: "#fff",
      background: "rgb(37 99 235)", // accent blue — a clear "carrying N items" cue
    });
    ghost.appendChild(badge);
  }
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 12, row.offsetHeight / 2);
  // The browser snapshots the ghost synchronously, so it's safe to drop on the next tick.
  setTimeout(() => ghost.remove(), 0);
}
