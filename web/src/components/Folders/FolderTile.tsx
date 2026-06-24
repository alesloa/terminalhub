import type { Folder, Workspace } from "../../api/types";

const ACCENT = "rgb(var(--tr-accent))";
const memberAccent = (w: Workspace) => w.cardColor ?? w.color ?? ACCENT;

/**
 * The collapsed folder — set apart from a plain WorkspaceCard by a lighter panel face, a blue folder
 * glyph, and a STACK of cards peeking out behind it (the iPhone "folder is a pile of cards" look) that
 * deepens as the folder fills. Shows a 2×2 peek of its members + a count. Purely presentational and
 * fully INERT: no element on the tile swallows pointer/click events, so the whole tile is one uniform
 * surface to grab (drag) or click (open) — the absolute positioning, drag, drop, and click-to-open all
 * live in SpaceCanvas's DraggableFolder wrapper. Renaming is NOT done here; it lives in the expanded
 * folder overlay. `overActive` lights it up while a card is dragged over it ("release to drop in").
 */
export function FolderTile({ folder, members, overActive }: {
  folder: Folder; members: Workspace[]; overActive: boolean;
}) {
  // Show up to four peek cells: the first three members, then a "+N more" tally when there are extra
  // (or a fourth member when it fits exactly).
  const peek = members.length > 4 ? members.slice(0, 3) : members.slice(0, 4);
  const overflow = members.length - peek.length;
  // The pile deepens as the folder fills: one card behind for a small folder, two for a fuller one.
  const backLayers = members.length >= 4 ? 2 : 1;
  return (
    <div className="relative w-72 select-none" style={overActive ? { transform: "scale(1.03)" } : undefined}>
      {/* Cards peeking out behind the face — decorative only (pointer-events-none) so they never eat a
          drag. The deeper layer only shows on a fuller folder, so a small folder reads as a "double". */}
      {backLayers >= 2 && (
        <div aria-hidden className="pointer-events-none absolute inset-0 translate-x-[11px] translate-y-[11px] rounded-lg border border-edge bg-surface" />
      )}
      <div aria-hidden className="pointer-events-none absolute inset-0 translate-x-[6px] translate-y-[6px] rounded-lg border border-edge bg-elevated" />
      {/* No hover animation (no transition / no lift) — the only emphasis is an instant border highlight
          on hover and the scale-up while a card is dragged over it (overActive). */}
      <div
        className={`relative rounded-lg border bg-panel p-3 shadow-lg ${overActive ? "border-info" : "border-edge hover:border-edge-strong"}`}
        style={overActive ? { outline: "2px solid rgb(var(--tr-info))", outlineOffset: "2px" } : undefined}>
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-1.5">
            <FolderIcon />
            <span className="max-w-[160px] truncate font-semibold text-bright">{folder.name || "Folder"}</span>
          </div>
          <span className="ml-2 shrink-0 rounded-full bg-elevated px-2 py-0.5 text-[11px] font-medium text-muted tabular-nums">{members.length}</span>
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          {peek.map((w) => (
            <div key={w.id} className="flex items-center rounded-md bg-canvas/80 px-2 py-1.5 ring-1 ring-edge/60"
              style={{ borderLeft: `3px solid ${memberAccent(w)}` }}>
              <span className="truncate text-[11px] text-fg">{w.name}</span>
            </div>
          ))}
          {overflow > 0 && (
            <div className="flex items-center justify-center rounded-md bg-elevated/60 px-2 py-1.5 ring-1 ring-edge/60">
              <span className="text-[11px] font-medium text-muted">+{overflow} more</span>
            </div>
          )}
          {members.length === 0 && (
            <div className="col-span-2 py-1.5 text-center text-[11px] text-dim">empty folder</div>
          )}
        </div>
      </div>
    </div>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-info" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}
