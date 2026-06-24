import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRoom } from "../../store/room";
import { PEACOCK_BAR, PEACOCK_SEAM } from "../../lib/peacock";
import { ACTIVITY_ITEMS } from "./ActivityBar";

const ITEM_PX = 36; // width budget per icon button in the responsive top bar

/** The view-switcher when it lives inside the side panel (not the bottom strip). Left/right render a
 *  vertical icon rail on that edge; top renders a horizontal bar that overflows into a ⋯ menu when
 *  the panel is too narrow. Split into two components so swapping orientation re-mounts cleanly
 *  (stable hook order). Persists across every view — it's mounted by Sidebar, outside the view body. */
export function PanelActivityBar({ orientation }: { orientation: "left" | "right" | "top" }) {
  return orientation === "top" ? <TopActivityBar /> : <VerticalActivityRail side={orientation} />;
}

function VerticalActivityRail({ side }: { side: "left" | "right" }) {
  const activeView = useRoom(s => s.activeView);
  const leftOpen = useRoom(s => s.leftOpen);
  const selectView = useRoom(s => s.selectView);
  return (
    <div style={{ background: PEACOCK_BAR, borderColor: PEACOCK_SEAM }}
      className={`w-10 shrink-0 ${side === "left" ? "border-r" : "border-l"} border-edge flex flex-col items-center py-1`}>
      {ACTIVITY_ITEMS.map(it => {
        const active = leftOpen && activeView === it.id;
        return (
          <button key={it.id} title={it.label} onClick={() => selectView(it.id)}
            className={`relative flex h-10 w-10 items-center justify-center [&_svg]:h-[18px] [&_svg]:w-[18px] ${active ? "text-bright" : "text-dim hover:text-fg"}`}>
            {active && <span className={`absolute ${side === "left" ? "left-0" : "right-0"} top-2 bottom-2 w-0.5 bg-blue-500`} />}
            {it.icon}
          </button>
        );
      })}
    </div>
  );
}

function TopActivityBar() {
  const activeView = useRoom(s => s.activeView);
  const leftOpen = useRoom(s => s.leftOpen);
  const selectView = useRoom(s => s.selectView);

  // Measure the bar's width so we can collapse overflowing icons into a ⋯ menu.
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const fit = Math.max(1, Math.floor((width || 1) / ITEM_PX));
  const overflow = ACTIVITY_ITEMS.length > fit;
  const visibleCount = overflow ? Math.max(1, fit - 1) : ACTIVITY_ITEMS.length; // keep a slot for ⋯
  const visible = ACTIVITY_ITEMS.slice(0, visibleCount);
  const hidden = ACTIVITY_ITEMS.slice(visibleCount);
  const activeHidden = leftOpen && hidden.some(it => it.id === activeView);

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    const raf = requestAnimationFrame(() => window.addEventListener("mousedown", close));
    window.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("mousedown", close); window.removeEventListener("keydown", onKey); };
  }, [menu]);
  // Re-measure can shrink `hidden` to empty — close a stale menu so it doesn't dangle.
  useEffect(() => { if (menu && !overflow) setMenu(null); }, [menu, overflow]);

  return (
    <div ref={ref} style={{ background: PEACOCK_BAR, borderColor: PEACOCK_SEAM }}
      className="flex h-9 shrink-0 items-center border-b border-edge overflow-hidden">
      {visible.map(it => {
        const active = leftOpen && activeView === it.id;
        return (
          <button key={it.id} title={it.label} onClick={() => selectView(it.id)}
            className={`relative flex h-9 w-9 shrink-0 items-center justify-center [&_svg]:h-[18px] [&_svg]:w-[18px] ${active ? "text-bright" : "text-dim hover:text-fg"}`}>
            {active && <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-blue-500" />}
            {it.icon}
          </button>
        );
      })}
      {overflow && (
        <button title="More views" onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setMenu(menu ? null : { x: r.left, y: r.bottom });
        }}
          className={`relative flex h-9 w-9 shrink-0 items-center justify-center text-lg leading-none ${activeHidden ? "text-bright" : "text-dim hover:text-fg"}`}>
          {activeHidden && <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-blue-500" />}
          ⋯
        </button>
      )}

      {menu && createPortal(
        <div style={{ position: "fixed", left: Math.min(menu.x, window.innerWidth - 200), top: menu.y + 2, zIndex: 70 }}
          onMouseDown={(e) => e.stopPropagation()}
          className="w-48 rounded-lg border border-edge bg-panel py-1 text-sm text-fg shadow-2xl select-none">
          {hidden.map(it => {
            const active = leftOpen && activeView === it.id;
            return (
              <button key={it.id} onClick={() => { selectView(it.id); setMenu(null); }}
                className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-elevated ${active ? "text-bright" : "text-fg"}`}>
                <span className={`flex h-[18px] w-[18px] items-center justify-center ${active ? "text-blue-400" : "text-dim"} [&_svg]:h-[18px] [&_svg]:w-[18px]`}>{it.icon}</span>
                {it.label}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
