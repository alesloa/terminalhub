import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BoardCard as Card, BoardColumn as Col } from "../../api/types";
import { ColorPicker, WS_L_MIN, Item, Sep } from "../TerminalContextMenu";

const MENU_W = 200;
const MOVE: { column: Col; label: string }[] = [
  { column: "todo", label: "To Do" },
  { column: "doing", label: "In Progress" },
  { column: "done", label: "Done" },
];

/** Right-click menu for a board card: edit, recolor (the workspace shade picker), move it to another
 *  column, or delete. Portal'd to <body> at the cursor so the board window's open/close transform
 *  can't become the containing block and shove a position:fixed menu off-screen (same reason the
 *  terminal-tab menu portals). Color/Move are flyout submenus that open on whichever side has room. */
export function BoardCardMenu({ anchor, card, onEdit, onColor, onMove, onRemove, dismiss }: {
  anchor: { x: number; y: number };
  card: Card;
  onEdit: () => void;
  onColor: (color: string | null) => void;
  onMove: (column: Col) => void;
  onRemove: () => void;
  dismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<"color" | "move" | null>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) dismiss(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    // Defer the outside-click listener a frame so the right-click that opened the menu can't close it.
    const raf = requestAnimationFrame(() => window.addEventListener("mousedown", onDown));
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [dismiss]);

  const openLeft = anchor.x > window.innerWidth / 2;
  const left = openLeft ? Math.max(8, anchor.x - MENU_W) : Math.min(anchor.x, window.innerWidth - MENU_W - 8);
  const top = Math.max(8, Math.min(anchor.y, window.innerHeight - 240));
  const flyoutSide = openLeft ? "right-full mr-1" : "left-full ml-1";
  const run = (fn: () => void) => { fn(); dismiss(); };

  return createPortal(
    <div ref={ref} style={{ position: "fixed", left, top, zIndex: 70, width: MENU_W }}
      className="py-1 rounded-lg border border-edge bg-panel shadow-2xl text-sm text-fg select-none">
      <Item label="Edit" onClick={() => run(onEdit)} />

      <div className="relative">
        <Item label="Color" submenu active={open === "color"} onClick={() => setOpen((o) => (o === "color" ? null : "color"))} />
        {open === "color" && (
          <div className={`absolute ${flyoutSide} top-0`}>
            <ColorPicker current={card.color} minLight={WS_L_MIN} onPick={onColor} />
          </div>
        )}
      </div>

      <div className="relative">
        <Item label="Move to" submenu active={open === "move"} onClick={() => setOpen((o) => (o === "move" ? null : "move"))} />
        {open === "move" && (
          <div className={`absolute ${flyoutSide} top-0 w-40 py-1 rounded-lg border border-edge bg-panel shadow-2xl`}>
            {MOVE.map((m) => (
              <Item key={m.column} label={m.label} disabled={m.column === card.column} onClick={() => run(() => onMove(m.column))} />
            ))}
          </div>
        )}
      </div>

      <Sep />
      <Item label="Delete" danger onClick={() => run(onRemove)} />
    </div>,
    document.body,
  );
}
