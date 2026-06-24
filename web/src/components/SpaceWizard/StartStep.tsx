import type { SpacePreset } from "../../api/types";

/** Short "3 skills · 2 MCP · rules" summary of what a preset seeds, for its card. */
function presetSummary(p: SpacePreset): string {
  const c = p.config;
  const bits: string[] = [];
  if (c.skills.length) bits.push(`${c.skills.length} skill${c.skills.length > 1 ? "s" : ""}`);
  if (c.commands.length) bits.push(`${c.commands.length} command${c.commands.length > 1 ? "s" : ""}`);
  if (c.mcpServers.length) bits.push(`${c.mcpServers.length} MCP`);
  if (c.env.trim()) bits.push("env");
  if (c.claudeMd.content.trim()) bits.push("rules");
  return bits.length ? bits.join(" · ") : "empty";
}

/** Wizard step 0 (only shown when presets exist): start from a saved template or blank. Picking a
 *  preset COPIES its config into the new space — editing later never mutates the preset. */
export function StartStep({ presets, onPickPreset, onBlank, onDelete }: {
  presets: SpacePreset[];
  onPickPreset: (p: SpacePreset) => void;
  onBlank: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 min-h-0 flex-1">
      <p className="text-sm text-muted">Start from a preset (you can tweak every step before applying), or start blank.</p>
      <div className="flex-1 min-h-0 overflow-auto grid grid-cols-2 gap-2 pr-1 content-start">
        <button onClick={onBlank}
          className="rounded-lg border border-dashed border-edge p-3 text-left hover:border-accent flex items-center gap-2 min-h-[64px]">
          <span className="codicon codicon-add text-muted" aria-hidden />
          <span className="font-medium">Blank space</span>
        </button>
        {presets.map((p) => (
          <div key={p.id} onClick={() => onPickPreset(p)}
            className="group relative rounded-lg border border-edge bg-[#1c1c1c] p-3 cursor-pointer hover:border-accent">
            <div className="flex items-center gap-2">
              <span className={`codicon codicon-${p.icon ?? "layers"} text-muted`} aria-hidden />
              <span className="font-medium truncate">{p.name}</span>
            </div>
            <div className="text-xs text-dim mt-1 truncate">{presetSummary(p)}</div>
            <button title="Delete preset"
              onClick={(e) => { e.stopPropagation(); if (confirm(`Delete the "${p.name}" preset?`)) onDelete(p.id); }}
              className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 grid h-5 w-5 place-items-center rounded bg-red-600/90 text-white text-[11px]">
              <span className="codicon codicon-trash" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
