// Canvas card grid. Drives both "Snap to grid" (drop-to-nearest-cell) and where a freshly
// created workspace card lands (first empty cell, not the top-left corner).

export const CARD_W = 288;          // matches the card's Tailwind w-72 (18rem @ 16px root)
export const CARD_H = 144;          // row pitch height ≥ the card's rendered footprint (~134px) so rows never overlap
export const GAP = 24;              // gutter between cells (Tailwind space-6)
export const MARGIN = 24;           // grid origin offset from the canvas top-left corner
export const COL = CARD_W + GAP;    // 312 — horizontal pitch between columns
export const ROW = CARD_H + GAP;    // 168 — vertical pitch between rows

/** Round a free position to the nearest grid cell (clamped to the visible canvas). */
export function snapToGrid(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.max(0, MARGIN + Math.round((x - MARGIN) / COL) * COL),
    y: Math.max(0, MARGIN + Math.round((y - MARGIN) / ROW) * ROW),
  };
}

/** Map a (possibly free-placed) card position to its nearest grid cell index. */
function cellOf(x: number, y: number): { col: number; row: number } {
  return { col: Math.max(0, Math.round((x - MARGIN) / COL)), row: Math.max(0, Math.round((y - MARGIN) / ROW)) };
}

/**
 * First EMPTY grid cell in COLUMN-major order (top→bottom down a column, then wrap to the next column
 * to the right) — so a fresh card stacks vertically down the left column, matching Arrange/Tidy,
 * instead of spreading across the top. `occupied` must list every item that actually holds a canvas
 * cell — loose cards PLUS folder tiles — but NOT workspaces that live inside a folder: those keep stale
 * pre-grouping coords and aren't on the canvas, so counting them wrongly marks cells full and shoves
 * the new card off to the right. Each item is bucketed to its nearest cell, so a freely-moved card
 * frees the cell it left. `boardHeight` sets how many rows fit a column before it wraps.
 */
export function nextFreeCell(occupied: { x: number; y: number }[], boardHeight: number): { x: number; y: number } {
  const rows = Math.max(1, Math.floor((boardHeight - MARGIN) / ROW));
  const taken = new Set(occupied.map(c => { const { col, row } = cellOf(c.x, c.y); return `${col},${row}`; }));
  for (let col = 0; ; col++) {
    for (let row = 0; row < rows; row++) {
      if (!taken.has(`${col},${row}`)) return { x: MARGIN + col * COL, y: MARGIN + row * ROW };
    }
  }
}

/**
 * Column-major grid cell positions (fill top→bottom, then wrap to the next column to the right) like a
 * desktop's icon grid — `count` cells, with however many rows per column fit boardHeight. The caller
 * lays its items onto these cells in order (e.g. folders first, then cards), so a re-flow repacks from
 * the top-left origin and pulls anything parked past the visible edge back into view.
 */
export function gridCells(count: number, boardHeight: number): { x: number; y: number }[] {
  const rows = Math.max(1, Math.floor((boardHeight - MARGIN) / ROW));
  return Array.from({ length: count }, (_, i) => ({
    x: MARGIN + Math.floor(i / rows) * COL,
    y: MARGIN + (i % rows) * ROW,
  }));
}

/** Stable column-major reading order (current column, then row) — keeps items near where they were. */
export function byCell<T extends { x: number; y: number }>(items: T[]): T[] {
  return items
    .map(item => ({ item, ...cellOf(item.x, item.y) }))
    .sort((a, b) => a.col - b.col || a.row - b.row)
    .map(({ item }) => item);
}
