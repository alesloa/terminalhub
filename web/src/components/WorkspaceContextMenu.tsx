import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Workspace, Space } from "../api/types";
import { api } from "../api/client";
import { useUi } from "../store/ui";
import { ColorPicker, Item, Sep, WS_L_MIN } from "./TerminalContextMenu";
import { useFavorites, flattenGroups } from "./Favorites/useFavorites";
import { FolderLibraryIcon } from "./Favorites/FavoritesTree";

interface Props {
  anchor: { x: number; y: number };
  workspace: Workspace;
  spaces: Space[];
  isDesktop: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onColor: (id: string, color: string | null) => void;
  onMove: (spaceId: string) => void;
  onBeginRename: () => void;
  // Present only when the card lives inside a folder — adds a "Remove from folder" item (pops the card
  // back onto the canvas). Non-destructive: the workspace and its terminals are untouched.
  onRemoveFromFolder?: () => void;
  dismiss: () => void;
}

// Default accent a workspace falls back to when it has no custom color (mirrors
// WorkspaceCard's `ws.color ?? "rgb(var(--tr-accent))"`), shown as the picker's "Default" swatch.
const DEFAULT_ACCENT = "rgb(var(--tr-accent))";
const MENU_W = 224, MENU_H = 296, PICKER_W = 176, GAP = 6;

export function WorkspaceContextMenu({ anchor, workspace, spaces, isDesktop, onOpen, onDelete, onColor, onMove, onBeginRename, onRemoveFromFolder, dismiss }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [colorOpen, setColorOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [favOpen, setFavOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const fav = useFavorites();
  const favGroups = flattenGroups(fav);
  const setPreviewColor = useUi((s) => s.setPreviewColor);
  const clearPreviewColor = useUi((s) => s.clearPreviewColor);
  // Drop any live preview if the menu unmounts mid-drag (commit normally clears it on release).
  useEffect(() => () => clearPreviewColor(workspace.id), [clearPreviewColor, workspace.id]);

  useEffect(() => {
    // pointerdown (capture, on window), NOT mousedown — the canvas's capture-phase pointerdown calls
    // preventDefault() to start a marquee, which suppresses the compatibility mousedown, so a
    // mousedown dismiss never fires for blank-canvas clicks and this menu would linger. See MultiMenu.
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
  const openLeft = left + MENU_W + GAP + PICKER_W > window.innerWidth;
  const flyoutSide = openLeft ? "right-full mr-1" : "left-full ml-1";

  const run = (fn: () => void) => { fn(); dismiss(); };
  const copyPath = () => {
    navigator.clipboard?.writeText(workspace.folder).catch(() => {});
    setCopied(true);
  };

  return createPortal(
    // The menu portals to <body>, but React synthetic events still bubble up the React
    // tree — through the DraggableCard whose dnd-kit drag listeners live on it.
    // Without this, dragging the lightness slider moves the pointer >8px and trips the
    // card's (mouse) drag activation, so the card slides along with the slider. Swallow pointer
    // events here so they never reach the draggable.
    <div ref={ref} onPointerDown={(e) => e.stopPropagation()}
      style={{ position: "fixed", left, top, zIndex: 70 }}
      className="w-56 py-1 rounded-lg border border-edge bg-panel shadow-2xl text-sm text-fg select-none">
      <Item label="Open" onClick={() => run(onOpen)} />
      <Sep />
      <Item label="Rename…" onClick={() => run(onBeginRename)} />
      <Item label={copied ? "Copied!" : "Copy Path"} onClick={copyPath} />
      <Item label="Reveal in Finder" onClick={() => run(() => api.revealPath(workspace.folder).catch(() => {}))} />
      <div className="relative">
        <Item label="Card Color" submenu active={colorOpen} onClick={() => setColorOpen((o) => !o)} />
        {colorOpen && (
          <div className={`absolute ${flyoutSide} top-0`}>
            <ColorPicker current={workspace.cardColor ?? workspace.color ?? null} defaultColor={DEFAULT_ACCENT} minLight={WS_L_MIN}
              onPreview={(c) => setPreviewColor(workspace.id, c)} onPick={(c) => onColor(workspace.id, c)} />
          </div>
        )}
      </div>
      {!isDesktop && spaces.length > 1 && (
        <div className="relative">
          <Item label="Move to space" submenu active={moveOpen} onClick={() => setMoveOpen((o) => !o)} />
          {moveOpen && (
            <div className={`absolute ${flyoutSide} top-0 w-48 py-1 rounded-lg border border-edge bg-panel shadow-2xl`}>
              {spaces.map((s) => (
                <Item key={s.id} label={s.name} disabled={s.id === workspace.spaceId}
                  onClick={() => run(() => onMove(s.id))} />
              ))}
            </div>
          )}
        </div>
      )}
      {/* Add this card's folder to Favorites — flyout picks the destination: the root, or any
          favorites group (flattened with indentation). Server-side create is idempotent, so
          re-adding the same folder to a bucket is a no-op rather than a duplicate. */}
      <div className="relative">
        <Item label="Add to Favorites" submenu active={favOpen} onClick={() => setFavOpen((o) => !o)} />
        {favOpen && (
          <div className={`absolute ${flyoutSide} top-0 w-52 py-1 rounded-lg border border-edge bg-panel shadow-2xl`}>
            <button onClick={() => run(() => fav.addFavorite(workspace.folder, null, workspace.name))}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-elevated">
              <FolderLibraryIcon /><span>Top level</span>
            </button>
            {favGroups.length > 0 && (
              <div className="max-h-64 overflow-auto mt-1 pt-1 border-t border-edge">
                {favGroups.map((g) => (
                  <button key={g.id} style={{ paddingLeft: 12 + g.depth * 12 }}
                    onClick={() => run(() => fav.addFavorite(workspace.folder, g.id, workspace.name))}
                    className="w-full flex items-center gap-2 pr-3 py-1.5 text-left hover:bg-elevated">
                    <FolderLibraryIcon /><span className="truncate">{g.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {onRemoveFromFolder && <>
        <Sep />
        <Item label="Remove from folder" onClick={() => run(onRemoveFromFolder)} />
      </>}
      {!isDesktop && <>
        <Sep />
        <Item label="Remove" danger onClick={() => run(onDelete)} />
      </>}
    </div>,
    document.body,
  );
}
