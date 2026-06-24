import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";

export interface FileMenuItem { label: string; hint?: string; disabled?: boolean; danger?: boolean; onClick?: () => void; children?: FileMenuEntry[] }
/** A clickable row, or "sep" for a divider. A row with `children` opens a hover flyout submenu. */
export type FileMenuEntry = FileMenuItem | "sep";

const MENU_W = 224, MENU_H = 320, SUB_W = 224, ROW_H = 34; // MENU_H = first-paint estimate; real height is measured
const PANEL = "w-56 py-1 rounded-lg border border-edge bg-panel shadow-2xl text-sm text-fg select-none";
const ROW = "w-full px-3 py-1.5 flex items-center justify-between gap-6 text-left hover:bg-elevated disabled:opacity-30 disabled:hover:bg-transparent";

/**
 * Right-click menu for a file row (source control, explorer, editor tabs). Generic: the caller
 * hands it a computed item list so the menu stays dumb. Items with `children` render a hover
 * flyout (e.g. "Add to .gitignore ▸ Local · .gitignore"). The flyout is a portaled sibling of
 * the menu — not a child of its scroll container — so a tall (scrolling) menu can't clip it.
 * Portals to <body> + clamps to the viewport; flyouts open left when a right one would overflow.
 */
export function FileContextMenu({ x, y, items, dismiss }:
  { x: number; y: number; items: FileMenuEntry[]; dismiss: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const [sub, setSub] = useState<{ i: number; top: number; left: number } | null>(null);
  const [menuH, setMenuH] = useState(MENU_H);
  const closeTimer = useRef<number | undefined>(undefined);

  // The menu's height varies with its item count (a folder menu runs ~530px; the background one is
  // short). Measure the real rendered height after layout and re-clamp the top from it, so a tall
  // menu opened low in the tree can't overflow the viewport and hide its bottom rows (Copy Path,
  // Rename, Delete). useLayoutEffect runs before paint, so the corrected position never flashes.
  useLayoutEffect(() => { if (ref.current) setMenuH(ref.current.offsetHeight); }, [items]);

  useEffect(() => {
    // A click is "inside" if it lands on the menu OR its open flyout (separate portal node).
    const inside = (t: Node) => !!ref.current?.contains(t) || !!subRef.current?.contains(t);
    const onDown = (e: MouseEvent) => { if (!inside(e.target as Node)) dismiss(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    // Defer the outside-click listener a frame so the opening right-click doesn't close it.
    const raf = requestAnimationFrame(() => window.addEventListener("mousedown", onDown));
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [dismiss]);

  const left = Math.max(8, Math.min(x, window.innerWidth - MENU_W - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - menuH - 8));
  // Open flyouts to the left when a right-side one would run off the viewport.
  const flipLeft = left + MENU_W + SUB_W + 8 > window.innerWidth;

  const cancelClose = () => { if (closeTimer.current) clearTimeout(closeTimer.current); };
  const scheduleClose = () => { cancelClose(); closeTimer.current = window.setTimeout(() => setSub(null), 140); };
  const openSub = (i: number, children: FileMenuEntry[], e: ReactMouseEvent) => {
    cancelClose();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const h = children.length * ROW_H + 8;
    setSub({
      i,
      top: Math.max(8, Math.min(r.top - 5, window.innerHeight - h - 8)),
      left: flipLeft ? Math.max(8, r.left - SUB_W) : r.right,
    });
  };

  const subItems = sub !== null && items[sub.i] !== "sep" ? (items[sub.i] as FileMenuItem).children : null;

  const renderRow = (it: FileMenuEntry, i: number) => {
    if (it === "sep") return <div key={i} className="my-1 h-px bg-edge" />;
    if (it.children) {
      const children = it.children;
      return (
        <button key={i} disabled={it.disabled} className={ROW}
          onMouseEnter={(e) => openSub(i, children, e)} onMouseLeave={scheduleClose}>
          <span>{it.label}</span>
          <span className="text-dim">▸</span>
        </button>
      );
    }
    return (
      <button key={i} disabled={it.disabled} className={`${ROW} ${it.danger ? "text-red-400" : ""}`}
        onMouseEnter={() => setSub(null)}
        onClick={() => { it.onClick?.(); dismiss(); }}>
        <span>{it.label}</span>
        {it.hint && <span className="text-xs text-dim">{it.hint}</span>}
      </button>
    );
  };

  return createPortal(
    <>
      <div ref={ref} style={{ position: "fixed", left, top, zIndex: 70, maxHeight: "80vh", overflowY: "auto" }} className={PANEL}>
        {items.map(renderRow)}
      </div>
      {subItems && sub && (
        <div ref={subRef} onMouseEnter={cancelClose} onMouseLeave={scheduleClose}
          style={{ position: "fixed", left: sub.left, top: sub.top, zIndex: 71 }} className={PANEL}>
          {subItems.map((c, j) => c === "sep"
            ? <div key={j} className="my-1 h-px bg-edge" />
            : (
              <button key={j} disabled={c.disabled} className={ROW} onClick={() => { c.onClick?.(); dismiss(); }}>
                <span>{c.label}</span>
                {c.hint && <span className="text-xs text-dim">{c.hint}</span>}
              </button>
            ))}
        </div>
      )}
    </>,
    document.body,
  );
}
