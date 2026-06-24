import { ColorSwatch } from "../../ColorSwatch";
import { WIDGET_L_MIN } from "../../TerminalContextMenu";
import type { WidgetSettingsCtx } from "../registry";
import { Row, BackgroundRow } from "./settingsShared";
import { readConfig, Seg } from "./WorldClockWidget";

// Settings body for the World Clock widget, rendered inside the pop-out WidgetSettingsWindow. Each
// color is a compact swatch that pops the full picker OUT (portaled) so the clocks behind stay
// visible. There's no layout toggle — the clock always reflows responsively, so resizing the card is
// the layout control. Clock/size commit immediately; the size slider previews live and commits on
// release; colors preview live while dragging and commit on release/select. Background (the universal
// control every widget shares) renders at the bottom.

export function WorldClockSettings(ctx: WidgetSettingsCtx) {
  const { config, preview, commit, clearPreview } = ctx;
  const cfg = readConfig(config);
  return (
    <div className="flex flex-col gap-3">
      <Row label="Clock">
        <Seg value={cfg.format24 ? "24" : "12"} onChange={(v) => commit({ format24: v === "24" })}
          options={[["12", "12h"], ["24", "24h"]]} />
      </Row>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] text-dim">Size</span>
          <span className="text-[10px] tabular-nums text-dim">{Math.round(cfg.zoom * 100)}%</span>
        </div>
        <input type="range" min={0.6} max={2.2} step={0.1} value={cfg.zoom} data-no-drag
          onChange={(e) => preview({ zoom: Number(e.target.value) })}
          onPointerUp={(e) => commit({ zoom: Number((e.target as HTMLInputElement).value) })}
          className="w-full" />
      </div>

      <Row label="Accent">
        <ColorSwatch value={cfg.accent} defaultColor="rgb(var(--tr-accent))" minLight={WIDGET_L_MIN} allowNeutral
          onPreview={(c) => preview({ accent: c })} onPick={(c) => commit({ accent: c })} onClose={clearPreview} />
      </Row>

      <div className="h-px bg-edge" />
      <BackgroundRow {...ctx} />
    </div>
  );
}
