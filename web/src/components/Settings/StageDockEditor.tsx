import type { StageDock } from "../../api/types";
import { Row, Toggle, ColorField, Slider, Range } from "./controls";

// Swatch fallbacks shown when a color is null (theme-tracking): the real default-theme tokens so the
// picker opens on the actual rendered color. Elevated = rgb(46 46 46) = #2e2e2e; edge-strong = #3a3a3a.
const FILL_FALLBACK = "#2e2e2e";
const BORDER_FALLBACK = "#3a3a3a";
// When the user picks a color on a fully-transparent element, restore opacity to this so the pick is
// actually visible (matches the server/store default fill opacity).
const RESTORE = 55;

// "Transparent" quick-set beside each color swatch — zeroes that element's opacity (no fill / no
// border). The opacity slider underneath does the same continuously; this is the one-tap version.
function TransparentBtn({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Transparent — no color"
      className={`rounded border px-2 py-1 text-xs ${active ? "border-blue-500 text-bright" : "border-edge-strong text-dim hover:text-fg"}`}
    >
      Transparent
    </button>
  );
}

// Editor for the Stage Manager dock's frosted-glass panel: fill color + opacity, border color +
// opacity (each independently transparent at 0%), and backdrop blur. Theme-tracking when a color is
// left at its default swatch — pinning a hex overrides it. Applies live (debounced PATCH by the caller).
export function StageDockEditor({ value, onChange }: { value: StageDock; onChange: (d: StageDock) => void }) {
  const set = (patch: Partial<StageDock>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3">
      <Toggle
        id="stage-dock-enabled"
        title="Frosted background"
        hint="A macOS-Dock-style frosted panel behind the room previews. Off = bare floating tiles, no panel."
        checked={value.enabled}
        onChange={(enabled) => set({ enabled })}
      />
      {value.enabled && (
        <>
          <Row id="stage-dock-fill" title="Background color" hint="The panel fill. Pick a color, or make it transparent for no background.">
            <div className="flex items-center gap-2">
              <ColorField value={value.color ?? FILL_FALLBACK} onChange={(color) => set({ color, opacity: value.opacity === 0 ? RESTORE : value.opacity })} />
              <TransparentBtn active={value.opacity === 0} onClick={() => set({ opacity: 0 })} />
            </div>
          </Row>
          <Row id="stage-dock-fill-opacity" title="Background opacity" hint="Lower is frostier; 0% is fully transparent (no background).">
            <Slider value={value.opacity} min={0} max={100} onChange={(opacity) => set({ opacity })} />
          </Row>
          <Row id="stage-dock-border" title="Border color" hint="The panel's edge. Pick a color, or make it transparent for no border.">
            <div className="flex items-center gap-2">
              <ColorField value={value.borderColor ?? BORDER_FALLBACK} onChange={(borderColor) => set({ borderColor, borderOpacity: value.borderOpacity === 0 ? RESTORE : value.borderOpacity })} />
              <TransparentBtn active={value.borderOpacity === 0} onClick={() => set({ borderOpacity: 0 })} />
            </div>
          </Row>
          <Row id="stage-dock-border-opacity" title="Border opacity" hint="0% is fully transparent (no border).">
            <Slider value={value.borderOpacity} min={0} max={100} onChange={(borderOpacity) => set({ borderOpacity })} />
          </Row>
          <Row id="stage-dock-blur" title="Blur" hint="Backdrop blur behind the panel — the frosted-glass strength.">
            <Range value={value.blur} min={0} max={40} format={(n) => `${n}px`} onChange={(blur) => set({ blur })} />
          </Row>
        </>
      )}
    </div>
  );
}
