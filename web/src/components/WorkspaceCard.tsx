import { useRef, useState, type CSSProperties } from "react";
import type { Workspace, Space } from "../api/types";
import { useUi } from "../store/ui";
import { WorkspaceContextMenu } from "./WorkspaceContextMenu";

export function WorkspaceCard({ ws, spaces, isDesktop, onOpen, onDelete, onColor, onMove, onRename, attentionIds, workingIds }: {
  ws: Workspace; spaces: Space[]; isDesktop: boolean; onOpen: () => void; onDelete: () => void;
  attentionIds: Set<string>; workingIds: Set<string>;
  onColor: (id: string, color: string | null) => void; onMove: (spaceId: string) => void;
  onRename: (id: string, name: string) => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  // Set on Escape so the blur that follows (the input unmounting) cancels instead of committing.
  const cancelRename = useRef(false);
  const terms = ws.terminals ?? [];
  const cardAttn = terms.some(t => attentionIds.has(t.id));
  // An agent in this card is actively working (thinking/streaming) — distinct from attention.
  const cardWorking = terms.some(t => !attentionIds.has(t.id) && workingIds.has(t.id));
  // Card accent/shade. A live preview (while dragging the picker's slider) wins over the persisted
  // cardColor so the border tracks the slider in real time; absent preview falls back to the saved
  // cardColor, then the legacy room `color`, then the default accent.
  const preview = useUi((s) => s.previewColors[ws.id]);
  const color = (preview !== undefined ? preview : (ws.cardColor ?? ws.color)) ?? "rgb(var(--tr-accent))";
  // When a terminal in this card wants attention, breathe a subtle halo in the
  // card's own accent color (the CSS var feeds the .tr-glow keyframe).
  const style = { borderColor: color, borderLeft: `4px solid ${color}`, "--tr-glow-color": color } as CSSProperties;
  return (
    <div className={`group relative w-72 rounded-lg border border-edge bg-canvas p-3 shadow-lg select-none ${cardAttn ? "tr-glow" : ""}`}
         onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY }); }}
         style={style}>
      {/* Remove sits inside the top-right corner — far from Open, can't be fat-fingered. Hidden on the
          permanent Desktop catch-all. Removal is non-destructive: terminals rehome, sessions live on. */}
      {!isDesktop && (
        <button
          aria-label="Remove workspace" title="Remove workspace"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          onPointerDown={(e) => e.stopPropagation()}
          className={`absolute top-[5px] right-[5px] z-10 grid h-[18px] w-[18px] place-items-center rounded-full bg-red-600 text-white opacity-60 shadow-sm ring-1 ring-black/20 transition hover:scale-110 hover:bg-red-500 hover:opacity-100 focus:opacity-100 focus:outline-none active:scale-95`}>
          <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      )}
      <div className="flex items-center justify-between pr-5">
        {renaming ? (
          // Inline Finder-style rename. stopPropagation on pointer/click so selecting text inside the
          // input doesn't arm the card's dnd-kit drag. Enter (or blur) commits; Escape cancels.
          <input autoFocus defaultValue={ws.name}
            onFocus={(e) => e.target.select()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") e.currentTarget.blur();
              else if (e.key === "Escape") { cancelRename.current = true; e.currentTarget.blur(); }
            }}
            onBlur={(e) => {
              const v = e.target.value;
              if (!cancelRename.current && v.trim() && v.trim() !== ws.name) onRename(ws.id, v);
              cancelRename.current = false;
              setRenaming(false);
            }}
            className="font-semibold min-w-0 flex-1 mr-2 rounded px-1 py-0 bg-elevated text-bright outline-none ring-1 ring-blue-500" />
        ) : (
          <div className="font-semibold truncate">{ws.name}</div>
        )}
        <div className="flex gap-1">
          {terms.map(t => {
            // Attention (it wants you) outranks working (it's busy) outranks alive/dead. A working
            // dot keeps its normal green — working is shown by a same-color pulsing glow, not a
            // recolor — while attention stays amber.
            const attn = attentionIds.has(t.id);
            const working = !attn && workingIds.has(t.id);
            const bg = attn ? "#fbbf24" : (t.alive || working) ? "rgb(var(--tr-success))" : "rgb(var(--tr-text-dim))";
            const title = attn ? `${t.title} — needs attention` : working ? `${t.title} — working…` : t.title;
            return <span key={t.id} title={title}
              className={`inline-block w-2 h-2 rounded-full ${attn ? "tr-blink" : working ? "tr-working-dot" : ""}`}
              style={{ background: bg }} />;
          })}
        </div>
      </div>
      <div className="text-xs text-muted truncate mt-1">{ws.folder}</div>
      <div className="text-xs text-dim mt-1">launch: <code>{ws.launchCommand || "(shell)"}</code></div>
      <div className="mt-3 text-sm">
        <button onClick={onOpen} className="w-full py-1.5 bg-[#1c1c1c] rounded cursor-pointer hover:bg-edge text-center font-medium">Open</button>
      </div>
      {/* Working indicator: a KITT-style light sweeping back and forth along the card's bottom edge
          while an agent here is busy thinking/streaming. Blue (--tr-info) to match the working dots. */}
      {cardWorking && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] overflow-hidden rounded-b-lg">
          <div className="tr-kitt absolute inset-y-0 left-0 w-1/3 rounded-full" />
        </div>
      )}
      {menu && <WorkspaceContextMenu anchor={menu} workspace={ws} spaces={spaces} isDesktop={isDesktop} onOpen={onOpen} onDelete={onDelete} onColor={onColor} onMove={onMove} onBeginRename={() => setRenaming(true)} dismiss={() => setMenu(null)} />}
    </div>
  );
}
