import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState,
  type ReactNode, type RefObject, type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { useUi } from "../../store/ui";
import type { WindowHandle } from "../../hooks/useDraggableWindow";
import { FileContextMenu } from "../Scm/FileContextMenu";

export type LauncherSection = "workspace" | "tools" | "system";

/** One tool the launcher can open. `id` is the stable key used for pinning; `active` reflects whether
 *  the tool's window/dock is currently open (the tile lights up); `onSelect` runs its open/toggle. */
export interface LauncherItem {
  id: string;
  label: string;
  /** One-line "what this does", shown under the name in the hover tooltip. */
  description: string;
  section: LauncherSection;
  icon: ReactNode;
  active: boolean;
  onSelect: () => void;
}

// Section order + headings. Add a new section here (and tag items with its key) when a new family of
// tools shows up — the grid stays ≤4 columns regardless of how many land in a section.
const SECTIONS: { key: LauncherSection; label: string }[] = [
  { key: "workspace", label: "Workspace" },
  { key: "tools", label: "Tools" },
  { key: "system", label: "System" },
];

/** Start-menu launcher: a dropdown of square tiles grouped into labeled sections, with type-to-filter
 *  search on top and a user-pinned row. Right-click a tile to pin/unpin it. Tiles theme off the brand
 *  tokens (accent for active/pinned), so they follow whatever theme is active.
 *
 *  Animates open (grows + fades from the launcher button's top-right) and closed. Like the app's other
 *  panels, it exposes a `close()` handle (WindowHandle) so a second button press runs the SAME close
 *  animation; click-away and Escape run it too. It only tells the parent to unmount (`onClose`) once
 *  the close transition ends — so the out-animation is always seen. Respects prefers-reduced-motion. */
export const AppLauncher = forwardRef<WindowHandle, {
  items: LauncherItem[];
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}>(function AppLauncher({ items, anchorRef, onClose }, ref) {
  const pins = useUi((s) => s.launcherPins);
  const togglePin = useUi((s) => s.toggleLauncherPin);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Rendered in a body portal so no ancestor stacking context can trap it under a window/modal — it
  // must sit above everything. Positioned `fixed`, anchored under the launcher button's right edge
  // (mirrors the old absolute right-0 top-full mt-2); re-placed on resize so it stays glued there.
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

  // Hover tooltip (name + description). Shown after a short dwell so a quick sweep across tiles
  // doesn't flicker; rendered in a body portal so the panel's overflow/scroll can't clip it.
  const [tip, setTip] = useState<{ item: LauncherItem; rect: DOMRect } | null>(null);
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTip = useCallback(() => { if (tipTimer.current) { clearTimeout(tipTimer.current); tipTimer.current = null; } setTip(null); }, []);
  const showTip = useCallback((item: LauncherItem, rect: DOMRect) => {
    if (tipTimer.current) clearTimeout(tipTimer.current);
    tipTimer.current = setTimeout(() => setTip({ item, rect }), 130);
  }, []);
  useEffect(() => () => { if (tipTimer.current) clearTimeout(tipTimer.current); }, []);

  // Open/close animation. Mount collapsed, flip to open one frame later so the CSS transition fires;
  // closing reverses it and the parent unmount runs only on transitionend (see onTransitionEnd).
  const reduce = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [open, setOpen] = useState(reduce);
  useEffect(() => {
    if (reduce) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true)));
    return () => cancelAnimationFrame(id);
  }, [reduce]);
  const beginClose = useCallback(() => { hideTip(); if (reduce) onClose(); else setOpen(false); }, [reduce, onClose, hideTip]);
  // A second launcher-button press runs this same close animation instead of an instant unmount.
  useImperativeHandle(ref, () => ({ close: beginClose }), [beginClose]);
  const onTransitionEnd: React.TransitionEventHandler = (e) => {
    if (e.target === e.currentTarget && e.propertyName === "transform" && !open) onClose();
  };

  // Click-away (outside both the launcher button and this panel) and Escape close the dropdown — by
  // playing the close animation. While the right-click menu is up, Escape closes that first. Deferred
  // a frame so the opening click that mounted us doesn't immediately count as "away".
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      beginClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { if (menu) setMenu(null); else beginClose(); } };
    const raf = requestAnimationFrame(() => window.addEventListener("pointerdown", onDown));
    window.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("pointerdown", onDown); window.removeEventListener("keydown", onKey); };
  }, [anchorRef, beginClose, menu]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => (q ? items.filter((it) => it.label.toLowerCase().includes(q)) : items), [items, q]);
  const byId = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);
  // Pinned tiles in saved order, dropping ids no longer present and honoring the active filter.
  const pinnedTiles = useMemo(
    () => pins.map((id) => byId.get(id)).filter((it): it is LauncherItem => !!it && filtered.includes(it)),
    [pins, byId, filtered],
  );

  const select = (it: LauncherItem) => { it.onSelect(); beginClose(); };
  const openMenu = (e: ReactMouseEvent, id: string) => { e.preventDefault(); hideTip(); setMenu({ x: e.clientX, y: e.clientY, id }); };

  const menuItem = menu ? byId.get(menu.id) : null;
  const menuPinned = menu ? pins.includes(menu.id) : false;

  if (!pos) return null;
  return createPortal(
    <div ref={panelRef} role="menu" aria-label="App launcher" onTransitionEnd={onTransitionEnd} onScroll={hideTip}
      style={{ position: "fixed", top: pos.top, right: pos.right, transformOrigin: "top right" }}
      className={`z-[150] w-[300px] max-w-[calc(100vw-1rem)] max-h-[75vh] overflow-y-auto
        rounded-xl border border-edge bg-panel/95 backdrop-blur shadow-2xl p-2.5
        ${reduce ? "" : "transition-[opacity,transform] duration-150 ease-out"}
        ${open ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}>
      <div className="flex items-center gap-2 rounded-lg border border-edge bg-canvas px-2.5 py-1.5">
        <SearchGlyph />
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} placeholder="Search tools…"
          className="flex-1 min-w-0 bg-transparent text-sm text-fg outline-none placeholder:text-dim" />
      </div>

      {filtered.length === 0 && (
        <div className="px-2 py-7 text-center text-xs text-dim">No tools match “{query}”.</div>
      )}

      {pinnedTiles.length > 0 && (
        <Section label="Pinned">
          {pinnedTiles.map((it) => <Tile key={"pin-" + it.id} item={it} pinned onSelect={select} onContext={openMenu} onEnter={showTip} onLeave={hideTip} />)}
        </Section>
      )}

      {SECTIONS.map((sec) => {
        const tiles = filtered.filter((it) => it.section === sec.key);
        if (!tiles.length) return null;
        return (
          <Section key={sec.key} label={sec.label}>
            {tiles.map((it) => <Tile key={it.id} item={it} pinned={pins.includes(it.id)} onSelect={select} onContext={openMenu} onEnter={showTip} onLeave={hideTip} />)}
          </Section>
        );
      })}

      {menu && (
        <FileContextMenu x={menu.x} y={menu.y} dismiss={() => setMenu(null)}
          items={[
            { label: menuPinned ? "Remove from pinned" : "Pin to top", onClick: () => { togglePin(menu.id); setMenu(null); } },
            { label: "Open", onClick: () => { if (menuItem) select(menuItem); } },
          ]} />
      )}

      {tip && !menu && <LauncherTooltip item={tip.item} rect={tip.rect} reduce={reduce} />}
    </div>,
    document.body,
  );
});

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <div className="px-1 pt-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-dim">{label}</div>
      <div className="grid grid-cols-4 gap-2">{children}</div>
    </>
  );
}

function Tile({ item, pinned, onSelect, onContext, onEnter, onLeave }: {
  item: LauncherItem; pinned: boolean;
  onSelect: (it: LauncherItem) => void; onContext: (e: ReactMouseEvent, id: string) => void;
  onEnter: (it: LauncherItem, rect: DOMRect) => void; onLeave: () => void;
}) {
  return (
    <button role="menuitem"
      onClick={() => onSelect(item)} onContextMenu={(e) => onContext(e, item.id)}
      onMouseEnter={(e) => onEnter(item, e.currentTarget.getBoundingClientRect())} onMouseLeave={onLeave}
      className={`relative aspect-square rounded-lg border flex flex-col items-center justify-center gap-1.5 transition ${
        item.active
          ? "border-accent bg-accent/15 text-bright"
          : "border-edge bg-elevated text-fg hover:bg-edge hover:text-bright hover:border-edge-strong"
      }`}>
      {pinned && (
        <svg className="absolute top-1 right-1 w-2.5 h-2.5 text-accent" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M14.4 2.6a2 2 0 0 1 2.8 0l4.2 4.2a2 2 0 0 1 0 2.8l-1.4 1.4-2.1-2.1-7 7V21H9.7l-2.8-2.8H4v-2.2l7-7-2.1-2.1z" />
        </svg>
      )}
      <span className="grid place-items-center">{item.icon}</span>
      <span className="w-full px-1 text-[10px] leading-tight text-center truncate">{item.label}</span>
    </button>
  );
}

/** The hover card: the tool's name on top, a one-line description below. Fixed-positioned in a body
 *  portal (anchored to the hovered tile), so the panel's scroll/overflow can't clip it. Sits below the
 *  tile by default and flips above only when it'd run off the bottom. Fades in; pointer-transparent. */
function LauncherTooltip({ item, rect, reduce }: { item: LauncherItem; rect: DOMRect; reduce: boolean }) {
  const [shown, setShown] = useState(reduce);
  useEffect(() => {
    if (reduce) return;
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [reduce]);

  const W = 224, GAP = 8, EST_H = 64; // EST_H: enough headroom to decide below-vs-above before measuring
  const below = rect.bottom + GAP + EST_H <= window.innerHeight;
  const left = Math.min(Math.max(8, rect.left + rect.width / 2 - W / 2), window.innerWidth - W - 8);
  const top = below ? rect.bottom + GAP : rect.top - GAP;

  return createPortal(
    <div role="tooltip"
      style={{ position: "fixed", left, top, width: W, transform: below ? undefined : "translateY(-100%)" }}
      className={`z-[151] pointer-events-none select-none rounded-lg border border-edge-strong bg-elevated/95 backdrop-blur shadow-2xl px-3 py-2
        ${reduce ? "" : "transition-opacity duration-100 ease-out"} ${shown ? "opacity-100" : "opacity-0"}`}>
      <div className="text-sm font-semibold leading-tight text-bright">{item.label}</div>
      <div className="mt-1 text-xs leading-snug text-muted">{item.description}</div>
    </div>,
    document.body,
  );
}

function SearchGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-dim shrink-0" aria-hidden>
      <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
    </svg>
  );
}
