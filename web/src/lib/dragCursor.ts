/**
 * Force a single cursor across the whole document for the lifetime of a pointer drag,
 * and suppress text selection. Without this the cursor follows whatever element sits under
 * the pointer mid-drag, so it flickers between the handle's resize/move cursor and the
 * content's default. A global `*{cursor:…!important}` rule overrides every element.
 *
 * Call on pointer-down; invoke the returned function on pointer-up to release.
 */
// Map a native resize/move keyword to our high-visibility custom cursor (dark arrow + white outline,
// defined as CSS vars in theme.css) so the locked cursor stays readable on dark themes. col/row map
// to the horizontal/vertical arrow; anything not listed (text, default, …) passes through unchanged.
const CURSOR_VAR: Record<string, string> = {
  "ns-resize": "var(--cur-ns-resize, ns-resize)",
  "ew-resize": "var(--cur-ew-resize, ew-resize)",
  "nwse-resize": "var(--cur-nwse-resize, nwse-resize)",
  "nesw-resize": "var(--cur-nesw-resize, nesw-resize)",
  "row-resize": "var(--cur-ns-resize, row-resize)",
  "col-resize": "var(--cur-ew-resize, col-resize)",
  move: "var(--cur-move, move)",
};

export function lockCursor(cursor: string): () => void {
  const c = CURSOR_VAR[cursor] ?? cursor;
  const style = document.createElement("style");
  style.textContent = `*{cursor:${c}!important;user-select:none!important;}`;
  document.head.appendChild(style);
  return () => style.remove();
}
