import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Popover } from "./parts";

const GAP = 2;       // matches gap-0.5 between tabs
const MORE_W = 34;   // space reserved for the ⋯ button when tabs overflow

/**
 * A horizontal tab strip that stays responsive: it shows as many tabs as fit and folds the
 * rest into a ⋯ dropdown. Tab widths are measured once from a hidden full-width row (labels
 * are static), then re-fit on every container resize. The ⋯ button highlights when the active
 * tab has been folded away, so the current tab is always discoverable.
 */
export function TabStrip<T extends string>({ tabs, active, onSelect, onResizeStart }:
  { tabs: { id: T; label: string }[]; active: T; onSelect: (id: T) => void;
    onResizeStart?: (e: ReactPointerEvent) => void }) {
  const stripRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const widths = useRef<number[]>([]);
  const [visibleCount, setVisibleCount] = useState(tabs.length);
  const [menuOpen, setMenuOpen] = useState(false);

  const recompute = () => {
    const cw = stripRef.current?.clientWidth ?? 0;
    const w = widths.current;
    if (!cw || w.length !== tabs.length) return;
    const totalAll = w.reduce((s, x) => s + x + GAP, 0);
    if (totalAll <= cw) { setVisibleCount(tabs.length); return; }
    const budget = cw - MORE_W;
    let used = 0, n = 0;
    for (let i = 0; i < w.length; i++) {
      used += w[i] + GAP;
      if (used <= budget) n++; else break;
    }
    setVisibleCount(n);
  };

  // Measure natural tab widths from the hidden row, then fit.
  useLayoutEffect(() => {
    const row = measureRef.current;
    if (row) widths.current = Array.from(row.children).map(c => (c as HTMLElement).offsetWidth);
    recompute();
  }, [tabs]);

  // Re-fit whenever the strip's available width changes (panel/sidebar resize).
  useLayoutEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => recompute());
    ro.observe(el);
    return () => ro.disconnect();
  }, [tabs]);

  const visible = tabs.slice(0, visibleCount);
  const overflow = tabs.slice(visibleCount);
  const activeHidden = overflow.some(t => t.id === active);

  // The strip doubles as a drag-to-resize handle for the bottom block (GitPanel owns the math).
  // Skip the tab/⋯ buttons so a press on them still switches tabs instead of starting a resize.
  const onBarPointerDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    onResizeStart?.(e);
  };

  return (
    <div onPointerDown={onResizeStart ? onBarPointerDown : undefined} title={onResizeStart ? "Drag to resize" : undefined}
      className={`px-1.5 h-8 shrink-0 border-b border-edge text-xs ${onResizeStart ? "cursor-row-resize" : "cursor-pointer"}`}>
      <div ref={stripRef} className="relative flex items-center gap-0.5 h-full overflow-hidden">
        {/* hidden measuring row: every tab at its natural width */}
        <div ref={measureRef} aria-hidden className="absolute invisible pointer-events-none flex gap-0.5">
          {tabs.map(t => <span key={t.id} className="px-2 h-6 inline-flex items-center whitespace-nowrap">{t.label}</span>)}
        </div>

        {visible.map(t => (
          <button key={t.id} onClick={() => onSelect(t.id)}
            className={`px-2 h-6 rounded whitespace-nowrap shrink-0 cursor-pointer ${active === t.id ? "bg-elevated text-bright" : "text-dim hover:text-fg"}`}>
            {t.label}
          </button>
        ))}

        {overflow.length > 0 && (
          <div className="relative shrink-0 ml-auto">
            <button title="More tabs" onClick={() => setMenuOpen(v => !v)}
              className={`px-2 h-6 rounded leading-none cursor-pointer ${activeHidden ? "bg-elevated text-bright" : "text-dim hover:text-fg"}`}>⋯</button>
            <Popover open={menuOpen} onClose={() => setMenuOpen(false)} className="right-0 top-7 w-36">
              {overflow.map(t => (
                <button key={t.id} onClick={() => { setMenuOpen(false); onSelect(t.id); }}
                  className={`w-full text-left px-3 py-1.5 hover:bg-elevated ${active === t.id ? "text-bright" : "text-fg"}`}>
                  {t.label}
                </button>
              ))}
            </Popover>
          </div>
        )}
      </div>
    </div>
  );
}
