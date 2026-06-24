import { useEffect, useLayoutEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useUi, rectOf } from "../../store/ui";
import { api } from "../../api/client";
import { useAttention } from "../../hooks/useAttention";
import { useWorking } from "../../hooks/useWorking";
import { useCenteredChild } from "../../hooks/useCenteredChild";
import { StageTile, TILE_W, TILE_H } from "./StageTile";
import { DEFAULT_STAGE_DOCK, dockFill, dockBorder } from "./dock";
import { STATS_BAR_HEIGHT } from "../SystemStatsBar";

const TOPBAR_H = 56; // the app shell reserves 56px for the TopBar (h-[calc(100vh-56px)])

// macOS-Stage-Manager-style edge dock: FLOATING thumbnails of the rooms open IN THE CURRENT SPACE —
// no opaque panel, the canvas shows through, so it never walls off the workspace cards. Slide/scroll
// to browse. All-open = a switcher (every room stays on the canvas; click raises one to the front).
// Spotlight = only the staged room renders on the canvas (the rest stay alive in tmux, off-canvas);
// clicking a tile stages that room AND grows it out of the thumbnail (its tile rect becomes the room's
// grow-from origin), the macOS swap. Scoped to the active space so a tile can never silently focus a
// room parked on another virtual space's canvas.
export function StageManager() {
  const enabled = useUi(s => s.stageManagerEnabled);
  const open = useUi(s => s.stageOpen);
  const pos = useUi(s => s.stageManagerPosition);
  const scale = useUi(s => s.stageManagerScale);
  const mode = useUi(s => s.stageMode);
  const closeStage = useUi(s => s.closeStage);
  const openRooms = useUi(s => s.openRooms);
  const focusRoom = useUi(s => s.focusRoom);
  const stagedWorkspaceId = useUi(s => s.stagedWorkspaceId);
  const setStagedRoom = useUi(s => s.setStagedRoom);
  const showRoom = useUi(s => s.showRoom);
  const activeTerminalByWorkspace = useUi(s => s.activeTerminalByWorkspace);
  const activeSpaceId = useUi(s => s.activeSpaceId);

  const { data } = useQuery({ queryKey: ["workspaces"], queryFn: api.listWorkspaces });
  const { data: spacesData } = useQuery({ queryKey: ["spaces"], queryFn: api.listSpaces });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const dock = settings?.stageDock ?? DEFAULT_STAGE_DOCK;
  const byId = new Map((data?.workspaces ?? []).map(w => [w.id, w]));
  // Match App's space membership exactly (App.tsx renders a room's column at idx === activeIndex):
  // resolve each room's space to an index, default unknown/null-space rooms to the active index (those
  // float on every space), and keep only the ones on the active column.
  const spaceIndex = new Map((spacesData?.spaces ?? []).map((s, i) => [s.id, i]));
  const activeIndex = spaceIndex.get(activeSpaceId) ?? 0;

  const attentionIds = new Set(useAttention().map(a => a.terminalId));
  const workingIds = new Set(useWorking().map(w => w.terminalId));

  const vertical = pos === "left" || pos === "right";
  // Dock size: one scale slider (Settings) shrinks every tile AND the gap between them uniformly, so the
  // whole strip just gets smaller while keeping the same proportions/spacing. Tiles render at full
  // TILE_W/TILE_H and are scaled down with a transform (text + dots scale too), but their layout slot is
  // the scaled size so neighbours pack in tighter and the floating band hugs the smaller row.
  const tileW = Math.round(TILE_W * scale);
  const tileH = Math.round(TILE_H * scale);
  const gap = Math.round(12 * scale); // base inter-tile gap is 12px (was the gap-3 class)
  // Rooms open in the CURRENT space. All-open keeps them in a STABLE order (openRooms insertion order) so
  // the strip behaves like the macOS Dock — clicking a tile never reshuffles the row, it just focuses
  // that room. Spotlight orders front-most-first (its motion is the canvas grow, not a strip reshuffle).
  const inSpace = [...openRooms].filter(r => {
    const ws = byId.get(r.workspaceId);
    return !!ws && (spaceIndex.get(ws.spaceId ?? "") ?? activeIndex) === activeIndex;
  });
  const rooms = mode === "spotlight" ? [...inSpace].sort((a, b) => b.z - a.z) : inSpace;
  const topZ = inSpace.reduce((m, r) => Math.max(m, r.z), 0); // highest z = the focused room (active ring)
  const roomKey = rooms.map(r => r.workspaceId).join(",");

  const { ref: stripRef, centeredId } = useCenteredChild(vertical ? "y" : "x", [pos, roomKey, activeSpaceId]);

  // Spotlight: keep a valid staged room for the CURRENT space — seed it on entry, and re-seed if the
  // staged room isn't in this space (e.g. you switched spaces) so the canvas never goes blank.
  useEffect(() => {
    if (mode !== "spotlight" || !open || rooms.length === 0) return;
    const ids = rooms.map(r => r.workspaceId);
    if (!stagedWorkspaceId || !ids.includes(stagedWorkspaceId)) setStagedRoom(rooms[0].workspaceId);
  }, [mode, open, stagedWorkspaceId, roomKey, rooms, setStagedRoom]);

  // FLIP animation for the strip itself: whenever a tile's slot changes, it SLIDES from its old position
  // to the new one instead of snapping. In All-open the row is stable, so a click never moves a tile —
  // this only fires when the set reflows (a room closes, or you switch spaces), keeping those transitions
  // fluid. Positions are read with offsetLeft/offsetTop (layout coords) so the strip's own scrolling
  // never triggers a spurious slide. Runs after every commit; only moved tiles animate. Skips reduced-motion.
  const tilePos = useRef<Map<string, { x: number; y: number }>>(new Map());
  const prevScale = useRef(scale);
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Resizing the dock (slider drag) reflows every slot at once — don't FLIP-slide on that, just record
    // the new positions so the next real reflow (a room opening/closing) still animates.
    const scaleChanged = prevScale.current !== scale;
    prevScale.current = scale;
    const prev = tilePos.current;
    const next = new Map<string, { x: number; y: number }>();
    strip.querySelectorAll<HTMLElement>("[data-stage-id]").forEach(node => {
      const id = node.dataset.stageId!;
      const x = node.offsetLeft, y = node.offsetTop;
      next.set(id, { x, y });
      const old = prev.get(id);
      if (old && !reduce && !scaleChanged) {
        const dx = old.x - x, dy = old.y - y;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          node.animate(
            [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0px, 0px)" }],
            { duration: 300, easing: "cubic-bezier(.2,.8,.2,1)" },
          );
        }
      }
    });
    tilePos.current = next;
  });

  if (!enabled) return null;

  // The slid-off transform (dock hidden). Animate transform/opacity only so it stays GPU-cheap.
  const hidden =
    pos === "left" ? "translateX(-112%)" :
    pos === "right" ? "translateX(112%)" :
    pos === "top" ? "translateY(-112%)" : "translateY(112%)";

  // Edge band: full-height column (left/right) or full-width row (top/bottom). pointer-events-none so
  // the canvas behind it stays clickable everywhere except where a tile/chip actually sits.
  const anchor: React.CSSProperties = vertical
    ? { top: TOPBAR_H, bottom: STATS_BAR_HEIGHT, [pos]: 0, width: tileW + 24 }
    : { left: 0, right: 0, height: tileH + 30, ...(pos === "top" ? { top: TOPBAR_H } : { bottom: STATS_BAR_HEIGHT }) };

  // Frosted-glass dock panel (macOS-Dock style) behind the tiles — fill + border tints, opacity, and
  // blur all come from the editable stageDock setting. enabled=false reverts to bare floating tiles.
  // Border is a real 1px border so borderOpacity 0 collapses it to nothing; fill opacity 0 = no bg.
  const panelStyle: React.CSSProperties = dock.enabled
    ? {
        background: dockFill(dock),
        border: `1px solid ${dockBorder(dock)}`,
        backdropFilter: `blur(${dock.blur}px)`,
        WebkitBackdropFilter: `blur(${dock.blur}px)`,
        boxShadow: "0 8px 30px rgba(0,0,0,.45)",
      }
    : {};

  const originOf = (workspaceId: string) => {
    const node = stripRef.current?.querySelector<HTMLElement>(`[data-stage-id="${workspaceId}"]`);
    return node ? rectOf(node) : null;
  };

  // Spotlight (focus mode): stage the clicked room so it mounts + grows out of its thumbnail; the rest
  // genuinely live off-canvas in tmux, so the grow-from-thumbnail metaphor fits.
  // All-open: a fixed macOS-Dock-style row — the tiles never move. Clicking a tile just focuses that
  // room on the canvas (no thumbnail reshuffle, no canvas grow). focusRoom no-ops if it's already front.
  const onTileClick = (workspaceId: string) => {
    // If this room is minimized / Show-Desktop-hidden, restore it growing OUT of its thumbnail (pass the
    // tile rect as the one-shot grow origin). No-op when the room is already on the canvas.
    showRoom(workspaceId, originOf(workspaceId));
    if (mode === "spotlight") {
      if (workspaceId === stagedWorkspaceId) return; // already the only room shown
      setStagedRoom(workspaceId, originOf(workspaceId));
      return;
    }
    focusRoom(workspaceId); // stable order → the row stays put; this only pops the room to the canvas front
  };

  return (
    <div className="fixed z-[45] pointer-events-none" style={anchor} aria-hidden={!open}>
      <div
        className={`w-full h-full flex items-center justify-center gap-2 ${vertical ? "flex-col py-2" : "flex-row px-2"}`}
        style={{
          transform: open ? "none" : hidden,
          opacity: open ? 1 : 0,
          transition: "transform 280ms cubic-bezier(.2,.8,.2,1), opacity 200ms ease",
        }}
      >
        {/* close affordance — a small floating button to hide the dock (it also toggles from the
            top-bar launcher icon). The all-open vs spotlight choice lives in Settings → Stage Manager,
            not here, so the dock stays uncluttered. */}
        <button
          onClick={closeStage}
          title="Hide Stage Manager"
          className="pointer-events-auto shrink-0 w-6 h-6 grid place-items-center rounded-full bg-canvas/85 backdrop-blur border border-edge shadow-lg text-muted hover:text-bright hover:bg-elevated"
        >
          ✕
        </button>

        {rooms.length === 0 ? (
          <div className="pointer-events-none text-[11px] text-dim px-3 text-center max-w-[12rem]">
            No open rooms in this space.
          </div>
        ) : (
          <div
            ref={stripRef}
            style={{ gap, ...panelStyle }}
            className={`pointer-events-auto min-h-0 min-w-0 flex items-center snap-mandatory no-scrollbar ${dock.enabled ? "rounded-2xl" : ""}
              ${vertical ? "flex-col overflow-y-auto overflow-x-hidden snap-y max-h-[calc(100%-2.75rem)] px-2 py-2" : "flex-row overflow-x-auto overflow-y-hidden snap-x max-w-[calc(100%-6rem)] py-2 px-2"}`}
          >
            {rooms.map(r => {
              const ws = byId.get(r.workspaceId)!;
              const terms = ws.terminals ?? [];
              const previewTerminalId = activeTerminalByWorkspace[r.workspaceId] ?? terms[0]?.id ?? null;
              const attnCount = terms.filter(t => attentionIds.has(t.id)).length;
              // One status dot per terminal: amber if it wants you, green if its agent is working, else
              // gray (alive-idle or dead) — so the row shows how many terminals there are and their state.
              const termDots = terms.map(t => {
                const attn = attentionIds.has(t.id);
                return { id: t.id, attn, working: !attn && workingIds.has(t.id), title: t.title };
              });
              const isStaged = mode === "spotlight" && r.workspaceId === stagedWorkspaceId;
              const active = mode === "spotlight" ? isStaged : r.z === topZ;
              const centered = centeredId === r.workspaceId;
              return (
                // Outer = the layout slot the FLIP effect animates (its transform is reserved for the
                // slide-to-new-position tween, so the centered scale lives on the inner element to avoid
                // fighting over `transform`). The slot is sized to the SCALED tile so gaps pack tighter
                // and the band hugs when the dock is shrunk.
                <div key={r.workspaceId} data-stage-id={r.workspaceId} className="snap-center shrink-0" style={{ width: tileW, height: tileH }}>
                  <div
                    className="transition-transform duration-200"
                    // Tiles stay fully opaque — never see-through (the canvas behind must not bleed through and
                    // confuse which window is which). Off-center tiles only scale down a touch for scroll focus.
                    style={{ width: tileW, height: tileH, transform: centered ? "scale(1)" : "scale(0.94)" }}
                  >
                    {/* Dock-size scale: render the tile at full TILE_W/TILE_H and shrink it to fill the
                        scaled slot, so every pixel inside (text, dots, previews) gets smaller uniformly. */}
                    <div style={{ width: TILE_W, height: TILE_H, transform: `scale(${scale})`, transformOrigin: "top left" }}>
                      <StageTile
                        ws={ws}
                        active={active}
                        previewTerminalId={previewTerminalId}
                        attnCount={attnCount}
                        termDots={termDots}
                        enabled={open}
                        onClick={() => onTileClick(r.workspaceId)}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
