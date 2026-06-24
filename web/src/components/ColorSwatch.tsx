import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ColorPicker } from "./TerminalContextMenu";

// A compact color control: a small swatch button showing the current color. Click it and the full
// hue-grid + lightness slider pops OUT in a portaled popover anchored to the swatch — never inside
// the host card, so the widget behind it stays fully visible for a live preview. The ColorPicker is
// only mounted while the popover is open, so it always re-seeds from the live `value` (this is what
// makes the slider darken the *current* color instead of a stale default hue).

const POP_W = 184; // ColorPicker is w-44 (176px) + border; reserve a touch more for flip math
const POP_H = 150;
const GAP = 6;

export function ColorSwatch({
  value, defaultColor, minLight, allowNeutral, onPreview, onPick, onClose, title,
}: {
  value: string | null;
  defaultColor?: string;
  minLight?: number;
  allowNeutral?: boolean;
  /** Live shade while dragging the slider (no persist). */
  onPreview?: (color: string | null) => void;
  /** Commit a color (or null = default/clear). Persists. */
  onPick: (color: string | null) => void;
  /** Popover closed without an outstanding commit — drop any dangling live preview. */
  onClose?: () => void;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  const place = () => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const left = Math.min(Math.max(8, b.left), window.innerWidth - POP_W - 8);
    let top = b.bottom + GAP;
    if (top + POP_H > window.innerHeight - 8) top = Math.max(8, b.top - POP_H - GAP); // flip above if no room below
    setPos({ left, top });
  };

  const doClose = () => { setOpen(false); onClose?.(); };
  const toggle = () => { if (open) { doClose(); return; } place(); setOpen(true); };

  // Outside-click / Esc closes. Defer the listener a frame so the opening click can't immediately
  // close it; ignore clicks inside the swatch or the (portaled) popover so a slider drag survives.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      doClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") doClose(); };
    const raf = requestAnimationFrame(() => window.addEventListener("mousedown", onDown));
    window.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <button ref={btnRef} type="button" data-no-drag title={title ?? "Change color"} onClick={toggle}
        className={`h-6 w-9 shrink-0 rounded border shadow-inner ${open ? "border-white" : "border-edge-strong"}`}
        style={{ background: value ?? defaultColor ?? "transparent" }} />
      {open && createPortal(
        <div ref={popRef} data-no-drag data-widget-popover onPointerDown={(e) => e.stopPropagation()}
          style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 80 }}>
          <ColorPicker current={value} defaultColor={defaultColor} minLight={minLight} allowNeutral={allowNeutral}
            onPreview={onPreview} onPick={onPick} />
        </div>,
        document.body,
      )}
    </>
  );
}
