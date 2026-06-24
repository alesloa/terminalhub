import { useMemo, useState, type CSSProperties } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { Space, Workspace } from "../../api/types";
import { useUi, rectOf } from "../../store/ui";
import { IconPicker } from "../IconPicker";
import { ColorPicker, WS_L_MIN } from "../TerminalContextMenu";

const DEFAULT_ACCENT = "rgb(var(--tr-accent))";
// Nominal card footprint on the real canvas, used to scale the mini-map (matches WorkspaceCard's
// w-72 ≈ 288px and its typical rendered height).
const CARD_W = 288, CARD_H = 132;

export function SpacePreview({ space, workspaces, active, attention, isHome, onOpen }: {
  space: Space; workspaces: Workspace[]; active: boolean; attention: boolean; isHome: boolean; onOpen: () => void;
}) {
  const qc = useQueryClient();
  const openWizard = useUi(s => s.openSpaceWizard);
  const [renaming, setRenaming] = useState(false);
  const [iconOpen, setIconOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["spaces"] });
  const rename = useMutation({ mutationFn: (name: string) => api.updateSpace(space.id, { name }), onSuccess: invalidate });
  const setIcon = useMutation({ mutationFn: (icon: string | null) => api.updateSpace(space.id, { icon }), onSuccess: invalidate });
  const setColor = useMutation({ mutationFn: (color: string | null) => api.updateSpace(space.id, { color }), onSuccess: invalidate });
  const del = useMutation({
    mutationFn: () => api.deleteSpace(space.id),
    onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ["workspaces"] }); },
  });

  const accent = space.color ?? DEFAULT_ACCENT;
  // Fit the cards into the tile: derive the content box from card coords + nominal size, then scale.
  const { rects } = useMemo(() => {
    const TILE_W = 168, TILE_H = 104, PAD = 6;
    const contentW = Math.max(CARD_W, ...workspaces.map(w => w.x + CARD_W));
    const contentH = Math.max(CARD_H, ...workspaces.map(w => w.y + CARD_H));
    const scale = Math.min((TILE_W - PAD * 2) / contentW, (TILE_H - PAD * 2) / contentH);
    const rects = workspaces.map(w => ({
      id: w.id,
      left: PAD + w.x * scale, top: PAD + w.y * scale,
      width: Math.max(6, CARD_W * scale), height: Math.max(4, CARD_H * scale),
      color: w.cardColor ?? w.color ?? DEFAULT_ACCENT,
    }));
    return { rects };
  }, [workspaces]);

  return (
    <div className="relative shrink-0">
      <button onClick={onOpen}
        className={`group relative w-[180px] h-[116px] rounded-lg border bg-elevated overflow-hidden transition
          ${active ? "ring-2 ring-accent" : "hover:border-accent"} ${attention ? "tr-blink" : ""}`}
        style={{ borderColor: accent, "--tr-glow-color": accent } as CSSProperties}
        title={space.name}>
        {/* live mini-map of this space's cards */}
        <div className="absolute inset-0 top-0 h-[104px]">
          {rects.map(r => (
            <span key={r.id} className="absolute rounded-[2px]"
              style={{ left: r.left, top: r.top, width: r.width, height: r.height, background: r.color, opacity: 0.85 }} />
          ))}
        </div>
        {/* centered name overlay */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="px-2 py-0.5 rounded bg-black/45 text-bright text-sm font-semibold truncate max-w-[150px] flex items-center gap-1">
            {space.icon && <span className={`codicon codicon-${space.icon}`} aria-hidden />}
            {space.name}
          </span>
        </div>
      </button>

      {/* hover controls */}
      <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition">
        <button title="Rename" onClick={(e) => { e.stopPropagation(); setRenaming(true); }}
          className="grid h-5 w-5 place-items-center rounded bg-panel/90 text-muted hover:text-bright text-[11px]">
          <span className="codicon codicon-edit" aria-hidden />
        </button>
        <button title="Edit space config (skills, MCP, rules…)"
          onClick={(e) => { e.stopPropagation(); openWizard({ mode: "edit", spaceId: space.id, origin: rectOf(e.currentTarget) }); }}
          className="grid h-5 w-5 place-items-center rounded bg-panel/90 text-muted hover:text-bright text-[11px]">
          <span className="codicon codicon-settings-gear" aria-hidden />
        </button>
        <button title="Change icon" onClick={(e) => { e.stopPropagation(); setIconOpen(true); }}
          className="grid h-5 w-5 place-items-center rounded bg-panel/90 text-muted hover:text-bright text-[11px]">
          <span className="codicon codicon-symbol-color" aria-hidden />
        </button>
        <button title="Recolor" onClick={(e) => { e.stopPropagation(); setColorOpen(o => !o); }}
          className="grid h-5 w-5 place-items-center rounded bg-panel/90 text-muted hover:text-bright text-[11px]">
          <span className="codicon codicon-paintcan" aria-hidden />
        </button>
        {!isHome && (
          <button title="Delete space" onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Delete the “${space.name}” space? Its cards move to the next space; no terminals are killed.`)) del.mutate();
          }}
            className="grid h-5 w-5 place-items-center rounded bg-red-600/90 text-white hover:bg-red-500 text-[11px]">
            <span className="codicon codicon-trash" aria-hidden />
          </button>
        )}
      </div>

      {renaming && (
        <input autoFocus defaultValue={space.name}
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== space.name) rename.mutate(v); setRenaming(false); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setRenaming(false);
          }}
          className="absolute bottom-1 left-1 right-1 px-2 py-1 text-sm bg-elevated border border-accent rounded outline-none" />
      )}

      {colorOpen && (
        <div className="absolute z-[75] top-8 right-1">
          <ColorPicker current={space.color} defaultColor={DEFAULT_ACCENT} minLight={WS_L_MIN}
            onPreview={() => {}} onPick={(c) => { setColor.mutate(c); setColorOpen(false); }} />
        </div>
      )}
      {iconOpen && (
        <IconPicker current={space.icon} onPick={(name) => { setIcon.mutate(name); setIconOpen(false); }} onClose={() => setIconOpen(false)} />
      )}
    </div>
  );
}
