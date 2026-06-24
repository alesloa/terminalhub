import type { ReactNode } from "react";
import { ColorSwatch } from "../../ColorSwatch";
import { WIDGET_L_MIN } from "../../TerminalContextMenu";
import type { WidgetSettingsCtx } from "../registry";

// Shared building blocks for widget settings bodies. `Row` is the standard label-left / control-right
// layout; `BackgroundRow` is the universal Background color control that every widget's settings gets
// (appended by SpaceWidgetCard after the widget-specific options) — it writes `config.background`,
// which the card paints behind the widget (and the meters read into their own screen).

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-dim">{label}</span>
      {children}
    </div>
  );
}

export function BackgroundRow({ config, preview, commit, clearPreview }: WidgetSettingsCtx) {
  const c = (config ?? {}) as { background?: unknown };
  const value = typeof c.background === "string" ? c.background : null;
  return (
    <Row label="Background">
      <ColorSwatch value={value} defaultColor="rgb(var(--tr-panel))" minLight={WIDGET_L_MIN} allowNeutral
        onPreview={(col) => preview({ background: col })} onPick={(col) => commit({ background: col })} onClose={clearPreview} />
    </Row>
  );
}
