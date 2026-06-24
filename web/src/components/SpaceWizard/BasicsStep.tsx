import { useState } from "react";
import { IconPicker } from "../IconPicker";
import { ColorPicker, WS_L_MIN } from "../TerminalContextMenu";

const DEFAULT_ACCENT = "rgb(var(--tr-accent))";

export interface Basics { name: string; icon: string | null; color: string | null }

/** Wizard step 1: the space's identity — name, codicon, accent color. Reuses the same IconPicker +
 *  ColorPicker the canvas uses elsewhere so a space looks consistent. */
export function BasicsStep({ basics, onChange }: { basics: Basics; onChange: (b: Basics) => void }) {
  const [iconOpen, setIconOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const accent = basics.color ?? DEFAULT_ACCENT;

  return (
    <div className="flex flex-col gap-5 max-w-md">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-muted">Space name</span>
        <input autoFocus value={basics.name} onChange={(e) => onChange({ ...basics, name: e.target.value })}
          placeholder="e.g. React projects" spellCheck={false}
          className="px-3 py-2 bg-[#1c1c1c] border border-edge rounded text-sm outline-none focus:border-accent" />
      </label>

      <div className="flex items-center gap-6">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-muted">Icon</span>
          <button onClick={() => setIconOpen(true)}
            className="grid place-items-center w-11 h-11 rounded-lg border border-edge bg-[#1c1c1c] hover:border-accent">
            <span className={`codicon codicon-${basics.icon ?? "layout"} text-lg`} style={{ color: accent }} aria-hidden />
          </button>
        </div>

        <div className="relative flex flex-col gap-1.5">
          <span className="text-sm text-muted">Color</span>
          <button onClick={() => setColorOpen((o) => !o)}
            className="w-11 h-11 rounded-lg border border-edge" style={{ background: accent }} title="Accent color" />
          {colorOpen && (
            <div className="absolute z-[85] top-full left-0 mt-1">
              <ColorPicker current={basics.color} defaultColor={DEFAULT_ACCENT} minLight={WS_L_MIN}
                onPreview={() => {}} onPick={(c) => { onChange({ ...basics, color: c }); setColorOpen(false); }} />
            </div>
          )}
        </div>
      </div>

      {iconOpen && (
        <IconPicker current={basics.icon}
          onPick={(name) => { onChange({ ...basics, icon: name }); setIconOpen(false); }}
          onClose={() => setIconOpen(false)} />
      )}
    </div>
  );
}
