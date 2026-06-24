import type { Workspace } from "../../api/types";
import { StageMiniWindow, type TermDot } from "./StageMiniWindow";

// Thumbnail footprint for one room in the dock. The mini window reflows its panels to the room's real
// proportions inside this fixed box, so the strip stays a clean grid instead of ragged window shapes.
export const TILE_W = 208;
export const TILE_H = 136;

// One floating thumbnail in the Stage Manager dock: a faithful mini render of the whole room window,
// with attention (amber ring/glow/badge — reuses the .tr-glow cadence) and working (breathing dot)
// state overlaid. No opaque card chrome — the mini window IS the tile.
export function StageTile({
  ws, active, previewTerminalId, attnCount, termDots, enabled, onClick,
}: {
  ws: Workspace;
  active: boolean;
  previewTerminalId: string | null;
  attnCount: number;
  termDots: TermDot[];
  enabled: boolean;
  onClick: () => void;
}) {
  const attn = attnCount > 0;
  return (
    <button
      onClick={onClick}
      className={`tr-stage-tile relative shrink-0 rounded-lg overflow-hidden border bg-canvas text-left
        transition-[border-color,box-shadow] duration-150
        ${attn ? "tr-glow" : ""}
        ${active ? "border-accent shadow-2xl" : "border-edge shadow-lg hover:border-edge-strong"}`}
      style={{ width: TILE_W, height: TILE_H, ["--tr-glow-color" as string]: "#fbbf24" } as React.CSSProperties}
      title={attn ? `${ws.name} — needs attention` : ws.name}
    >
      {/* The mini window's title bar carries the per-terminal status dots (gray/green/amber), so the
          tile needs no separate corner overlay — attention still washes the whole tile via tr-glow. */}
      <StageMiniWindow ws={ws} previewTerminalId={previewTerminalId} enabled={enabled} termDots={termDots} />
    </button>
  );
}
