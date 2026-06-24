import { ColorSwatch } from "../../ColorSwatch";
import { WIDGET_L_MIN } from "../../TerminalContextMenu";
import type { WidgetSettingsCtx } from "../registry";
import { BackgroundRow } from "./settingsShared";
import { CLAUDE_RAMP, CODEX_RAMP, type MeterRamp } from "./meterShared";

// Settings body for the Claude / Codex usage meters: recolor the three usage tiers (the rings, the
// today bar, and the status dot). Each tier is a compact swatch that pops the picker OUT so the live
// gauge stays visible. Overrides persist per widget instance; "Reset" clears them back to the agent's
// brand colors. Editing the brand ramp default itself isn't offered — only this instance's override.

const TIERS: { key: keyof MeterRamp; label: string; hint: string }[] = [
  { key: "ok", label: "OK", hint: "under 70%" },
  { key: "warn", label: "Warning", hint: "70–90%" },
  { key: "over", label: "Over", hint: "90%+" },
];

export function MeterSettings(props: WidgetSettingsCtx & { agent: "claude" | "codex" }) {
  const { agent, config, preview, commit, clearPreview } = props;
  const base = agent === "codex" ? CODEX_RAMP : CLAUDE_RAMP;
  const c = (config ?? {}) as Partial<MeterRamp>;
  const overridden = TIERS.some((t) => typeof c[t.key] === "string");

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] leading-snug text-dim">Ring colors by how much of the budget is used.</p>

      {TIERS.map((t) => (
        <div key={t.key} className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="text-[11px] text-fg">{t.label}</span>
            <span className="text-[10px] text-dim">{t.hint}</span>
          </span>
          <ColorSwatch value={typeof c[t.key] === "string" ? (c[t.key] as string) : null} defaultColor={base[t.key]} minLight={WIDGET_L_MIN}
            onPreview={(col) => preview({ [t.key]: col })}
            onPick={(col) => commit({ [t.key]: col })}
            onClose={clearPreview} />
        </div>
      ))}

      <button type="button" disabled={!overridden}
        onClick={() => commit({ ok: null, warn: null, over: null })}
        className="self-start rounded border border-edge px-2 py-1 text-[11px] text-dim hover:bg-edge hover:text-fg disabled:opacity-40">
        Reset to brand colors
      </button>

      <div className="h-px bg-edge" />
      <BackgroundRow config={config} preview={preview} commit={commit} clearPreview={clearPreview} />
    </div>
  );
}
