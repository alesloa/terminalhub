import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Space } from "../../api/types";
import { ColorPicker, Item, Sep, WS_L_MIN } from "../TerminalContextMenu";

interface Props {
  anchor: { x: number; y: number };
  space: Space;
  // The home space can't be deleted (it's the fallback every orphaned card falls back to), so its
  // menu simply omits the Delete item rather than showing a disabled one.
  isHome: boolean;
  onOpen: () => void;
  onRename: () => void;
  onChangeIcon: () => void;
  onColor: (color: string | null) => void;
  onEditConfig: () => void;
  onDelete: () => void;
  dismiss: () => void;
}

// Mirrors SpacePreview's fallback accent (`space.color ?? "rgb(var(--tr-accent))"`), shown as the
// picker's "Default" swatch.
const DEFAULT_ACCENT = "rgb(var(--tr-accent))";
const MENU_W = 224, MENU_H = 208, PICKER_W = 176, GAP = 6;

/** Right-click menu for a space tile in the Mission-Control overview. Same actions as the tile's
 *  hover row, reachable without hunting for a 20px icon — and it's what makes right-click show app
 *  chrome instead of the browser's own page menu. Follows WorkspaceContextMenu: portalled to <body>,
 *  clamped to the viewport, dismissed by outside pointerdown or Escape. */
export function SpaceContextMenu({ anchor, space, isHome, onOpen, onRename, onChangeIcon, onColor, onEditConfig, onDelete, dismiss }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [colorOpen, setColorOpen] = useState(false);

  useEffect(() => {
    // pointerdown on window (capture) rather than mousedown — matches WorkspaceContextMenu, where a
    // capture-phase preventDefault() elsewhere can suppress the compatibility mousedown and leave
    // the menu stuck open.
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) dismiss(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    const raf = requestAnimationFrame(() => window.addEventListener("pointerdown", onDown, true));
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [dismiss]);

  const left = Math.max(8, Math.min(anchor.x, window.innerWidth - MENU_W - 8));
  const top = Math.max(8, Math.min(anchor.y, window.innerHeight - MENU_H - 8));
  const flyoutSide = left + MENU_W + GAP + PICKER_W > window.innerWidth ? "right-full mr-1" : "left-full ml-1";

  const run = (fn: () => void) => { fn(); dismiss(); };

  return createPortal(
    // data-app-menu: this menu portals outside the Spaces dropdown's DOM subtree, so the dropdown's
    // click-away handler must not treat a click in here as "clicked away" — that would unmount the
    // tile and take this menu with it before the item's onClick could run.
    <div ref={ref} data-app-menu onPointerDown={(e) => e.stopPropagation()}
      style={{ position: "fixed", left, top, zIndex: 85 }}
      className="w-56 py-1 rounded-lg border border-edge bg-panel shadow-2xl text-sm text-fg select-none">
      <Item label="Open" onClick={() => run(onOpen)} />
      <Sep />
      <Item label="Rename…" onClick={() => run(onRename)} />
      <Item label="Change Icon…" onClick={() => run(onChangeIcon)} />
      <div className="relative">
        <Item label="Space Color" submenu active={colorOpen} onClick={() => setColorOpen((o) => !o)} />
        {colorOpen && (
          <div className={`absolute ${flyoutSide} top-0`}>
            {/* Space tiles have no live preview channel (unlike workspace cards, which paint the
                canvas as you drag), so onPreview is a no-op and only the committed pick writes. */}
            <ColorPicker current={space.color} defaultColor={DEFAULT_ACCENT} minLight={WS_L_MIN}
              onPreview={() => {}} onPick={(c) => run(() => onColor(c))} />
          </div>
        )}
      </div>
      <Item label="Edit Config…" hint="skills, MCP, rules" onClick={() => run(onEditConfig)} />
      {!isHome && <>
        <Sep />
        <Item label="Delete Space" danger onClick={() => run(onDelete)} />
      </>}
    </div>,
    document.body,
  );
}
