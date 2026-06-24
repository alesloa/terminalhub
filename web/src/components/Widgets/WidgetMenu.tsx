import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState,
  type ReactNode, type PointerEvent as ReactPointerEvent, type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { WindowHandle } from "../../hooks/useDraggableWindow";
import { useUi, spacesBarBottom } from "../../store/ui";
import { useSpaceWidgets } from "./useSpaceWidgets";
import { useStickyNotes } from "../StickyNotes/useStickyNotes";
import { NOTE_W, NOTE_H, STICKY_BODY } from "../StickyNotes/StickyNote";
import { WIDGET_DEFS, renderWidgetBody } from "./registry";

const TILE_W = 176;   // live-preview width inside a gallery tile
const GHOST_W = 150;  // the card that follows the cursor while dragging
const DRAG_THRESHOLD = 6;

// One gallery tile. Most tiles are real space-widgets (from WIDGET_DEFS); the sticky-note tile drops a
// canvas post-it instead — both share the same drag-to-place / click-to-place UX via `place`.
interface MenuTile {
  key: string;
  label: string;
  description: string;
  w: number;
  h: number;
  icon: ReactNode;
  body: ReactNode; // rendered full-size (w×h) then scaled into the tile/ghost
  bg?: string;     // body background for the preview, mirroring the card's defaultBackground
  place: (x: number, y: number, spaceId: string | undefined) => void;
}

/** A live, scaled-down render of a tile — the same title bar + body it gets on the canvas, shrunk to
 *  fit `width`. Pointer-events off so it never eats the drag. This is the macOS-style gallery preview
 *  (and the drag ghost). */
function TilePreview({ tile, width }: { tile: MenuTile; width: number }) {
  const scale = width / tile.w;
  return (
    <div className="relative overflow-hidden rounded-md border border-edge bg-panel shadow-sm" style={{ width, height: tile.h * scale }}>
      <div className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ width: tile.w, height: tile.h, transform: `scale(${scale})` }}>
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-1.5 px-2 h-7 shrink-0 border-b border-edge bg-elevated/60">
            <span className="text-dim">{tile.icon}</span>
            <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted">{tile.label}</span>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden p-2.5" style={tile.bg ? { background: tile.bg } : undefined}>{tile.body}</div>
        </div>
      </div>
    </div>
  );
}

/** The Widgets gallery — a start-menu sibling of the App Launcher (same grow/minimize animation,
 *  click-away + Escape, WindowHandle close). Each tile shows the LIVE widget; drag one onto the
 *  canvas to drop it where you release (it persists on the active space), or just click to place it.
 *  Release back over the gallery to cancel. The sticky-note post-it lives here too. */
export const WidgetMenu = forwardRef<WindowHandle, {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}>(function WidgetMenu({ anchorRef, onClose }, ref) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { widgets, create } = useSpaceWidgets();
  const { create: createSticky } = useStickyNotes();
  const activeSpaceId = useUi((s) => s.activeSpaceId);
  const [ghost, setGhost] = useState<{ tile: MenuTile; x: number; y: number } | null>(null);

  // Real widgets + the sticky-note tile, unified so they share one drag/place path.
  const tiles: MenuTile[] = [
    ...WIDGET_DEFS.map((def): MenuTile => ({
      key: def.kind, label: def.label, description: def.description, w: def.w, h: def.h, icon: def.icon,
      body: renderWidgetBody(def.kind), bg: def.defaultBackground,
      place: (x, y, sid) => create({ spaceId: sid, kind: def.kind, x, y, w: def.w, h: def.h }),
    })),
    {
      key: "sticky-note",
      label: "Sticky Note",
      description: "A quick post-it pinned to this space's canvas.",
      w: NOTE_W, h: NOTE_H, icon: <NoteGlyph />, body: <StickyFace />,
      place: (x, y, sid) => createSticky({ spaceId: sid, color: null, x, y, w: NOTE_W, h: NOTE_H }),
    },
  ];

  // Rendered in a body portal so no ancestor stacking context can trap it under a window/modal.
  // Positioned `fixed`, anchored under the widgets button's right edge; re-placed on resize.
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 8, right: Math.max(0, window.innerWidth - r.right) });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchorRef]);

  const reduce = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [open, setOpen] = useState(reduce);
  useEffect(() => {
    if (reduce) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true)));
    return () => cancelAnimationFrame(id);
  }, [reduce]);
  const beginClose = useCallback(() => { if (reduce) onClose(); else setOpen(false); }, [reduce, onClose]);
  useImperativeHandle(ref, () => ({ close: beginClose }), [beginClose]);
  const onTransitionEnd: React.TransitionEventHandler = (e) => {
    if (e.target === e.currentTarget && e.propertyName === "transform" && !open) onClose();
  };

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      beginClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") beginClose(); };
    const raf = requestAnimationFrame(() => window.addEventListener("pointerdown", onDown));
    window.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("pointerdown", onDown); window.removeEventListener("keydown", onKey); };
  }, [anchorRef, beginClose]);

  // Drop a tile onto the active space. Cascade the spawn point so consecutive plain-clicks don't
  // stack exactly on top of each other.
  const placeCascaded = (tile: MenuTile, floor: number) => {
    const n = widgets.length % 6;
    const x = Math.max(16, window.innerWidth - tile.w - 40 - n * 28);
    const y = floor + 64 + n * 28;
    tile.place(x, y, activeSpaceId || undefined);
    beginClose();
  };

  // Press a tile → maybe drag. Below the threshold it's a click (cascade place); past it we show a
  // ghost and, on release over the canvas, drop the tile where the cursor is. Release over the
  // gallery cancels.
  const beginDrag = (e: ReactPointerEvent, tile: MenuTile) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    let active = false;
    const onMove = (ev: PointerEvent) => {
      if (!active && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > DRAG_THRESHOLD) active = true;
      if (active) setGhost({ tile, x: ev.clientX, y: ev.clientY });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setGhost(null);
      const floor = spacesBarBottom();
      if (!active) { placeCascaded(tile, floor); return; }
      const r = panelRef.current?.getBoundingClientRect();
      const overGallery = !!r && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      if (overGallery) return; // dropped back onto the gallery → cancel, stay open
      const x = Math.min(window.innerWidth - 40, Math.max(0, ev.clientX - 30));
      const y = Math.min(window.innerHeight - 40, Math.max(floor, ev.clientY - 14));
      tile.place(x, y, activeSpaceId || undefined);
      beginClose();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  if (!pos) return null;
  return createPortal(
    <>
      <div ref={panelRef} role="menu" aria-label="Widgets" onTransitionEnd={onTransitionEnd}
        style={{ position: "fixed", top: pos.top, right: pos.right, transformOrigin: "top right" }}
        className={`z-[150] w-[384px] max-w-[calc(100vw-1rem)] max-h-[72vh] overflow-y-auto
          rounded-xl border border-edge bg-panel/95 backdrop-blur shadow-2xl p-2.5
          ${reduce ? "" : "transition-[opacity,transform] duration-150 ease-out"}
          ${open ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}>
        <div className="px-1 pb-2 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-dim">Drag a widget onto the canvas</div>
        <div className="grid grid-cols-2 gap-2">
          {tiles.map((tile) => (
            <button key={tile.key} role="menuitem" onPointerDown={(e) => beginDrag(e, tile)}
              className="group flex select-none flex-col items-stretch gap-1.5 rounded-lg border border-edge bg-elevated p-2 text-left transition hover:border-edge-strong active:cursor-grabbing">
              <TilePreview tile={tile} width={TILE_W} />
              <div className="px-0.5">
                <div className="text-xs font-medium leading-tight text-bright">{tile.label}</div>
                <div className="mt-0.5 text-[10px] leading-snug text-dim">{tile.description}</div>
              </div>
            </button>
          ))}
        </div>
        <div className="px-1 pt-2.5 text-[10px] leading-snug text-dim">Drop where you want it; drag the card by its title bar to move it, resize from the corner, remove with the ✕. Widgets persist per space.</div>
      </div>
      {ghost && (
        <div className="pointer-events-none fixed z-[200] opacity-90 drop-shadow-xl"
          style={{ left: ghost.x - GHOST_W / 2, top: ghost.y - 12, transform: "rotate(-2deg)" }}>
          <TilePreview tile={ghost.tile} width={GHOST_W} />
        </div>
      )}
    </>,
    document.body,
  );
});

/** Paper-with-fold glyph — the sticky-note tile (matches the old canvas "Note" button). */
function NoteGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15.5 3.5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-4.5-4.5z" />
      <path d="M15 3.5V8h4.5" /><path d="M9 13h4M11 11v4" />
    </svg>
  );
}

/** A static face of the default (dark) post-it — a few faint text lines — for the gallery tile/ghost. */
function StickyFace() {
  return (
    <div className="h-full w-full rounded-md p-3" style={{ background: STICKY_BODY }}>
      <div className="space-y-2">
        <div className="h-2 w-3/4 rounded-full" style={{ background: "rgba(255,255,255,0.20)" }} />
        <div className="h-2 w-full rounded-full" style={{ background: "rgba(255,255,255,0.10)" }} />
        <div className="h-2 w-5/6 rounded-full" style={{ background: "rgba(255,255,255,0.10)" }} />
        <div className="h-2 w-2/3 rounded-full" style={{ background: "rgba(255,255,255,0.10)" }} />
      </div>
    </div>
  );
}
