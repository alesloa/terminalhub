import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Item, Sep } from "../TerminalContextMenu";

export type FavMenuTarget =
  | { kind: "favorite"; id: string; label: string }
  | { kind: "group"; id: string; name: string };

/** Right-click menu for a favorite or a group. Portals to <body> so position:fixed is
 *  viewport-relative (the dock has no transform, but rooms/modals do — keep it consistent). */
export function FavoriteContextMenu({ x, y, target, onOpen, onRename, onRemove, onNewSubgroup, dismiss }: {
  x: number; y: number; target: FavMenuTarget;
  onOpen: () => void; onRename: () => void; onRemove: () => void; onNewSubgroup: () => void; dismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) dismiss(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    const raf = requestAnimationFrame(() => window.addEventListener("mousedown", onDown));
    window.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [dismiss]);

  const run = (fn: () => void) => { fn(); dismiss(); };
  const MENU_W = 192;
  const left = Math.min(x, window.innerWidth - MENU_W - 8);
  const top = Math.min(y, window.innerHeight - 180);

  return createPortal(
    <div ref={ref} style={{ position: "fixed", left, top, zIndex: 80 }}
      className="w-48 py-1 rounded-lg border border-edge bg-panel shadow-2xl text-sm text-fg select-none">
      {target.kind === "favorite" ? (
        <>
          <Item label="Open" onClick={() => run(onOpen)} />
          <Item label="Rename" onClick={() => run(onRename)} />
          <Sep />
          <Item label="Remove" danger onClick={() => run(onRemove)} />
        </>
      ) : confirmDel ? (
        <div className="px-3 py-2">
          <div className="text-xs text-fg">Delete “{target.name}” and everything inside it?</div>
          <div className="flex gap-2 mt-2">
            <button onClick={() => run(onRemove)}
              className="px-2 py-1 text-xs rounded bg-[#3a1d2a] text-red-300 hover:bg-[#4a2535]">Delete</button>
            <button onClick={() => setConfirmDel(false)}
              className="px-2 py-1 text-xs rounded text-muted hover:text-fg hover:bg-elevated">Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <Item label="New Subgroup" onClick={() => run(onNewSubgroup)} />
          <Item label="Rename" onClick={() => run(onRename)} />
          <Sep />
          <Item label="Delete Group" danger onClick={() => setConfirmDel(true)} />
        </>
      )}
    </div>,
    document.body,
  );
}
