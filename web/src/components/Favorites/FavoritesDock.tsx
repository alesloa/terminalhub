import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useUi } from "../../store/ui";
import { useFavorites } from "./useFavorites";
import { FavoritesTree, type FavEditing } from "./FavoritesTree";
import { BrowseSection } from "./BrowseSection";

// Filesystem root the Browse section opens at — matches the project-switcher extension's
// fileBrowserRoot default. The user navigates from here (or types a path).
const BROWSE_ROOT = "/";

/** Home-screen project switcher: saved favorites on top, a filesystem browser below. Docks to
 *  the left of the canvas of workspace cards; hidden by default, slid out by the TopBar star. */
export function FavoritesDock() {
  const open = useUi(s => s.favoritesOpen);
  const toggleFavorites = useUi(s => s.toggleFavorites);
  const browseOpen = useUi(s => s.browseOpen);
  const toggleBrowse = useUi(s => s.toggleBrowse);
  const fav = useFavorites();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(300);
  const [browseH, setBrowseH] = useState(300);
  const [editing, setEditing] = useState<FavEditing | null>(null);
  const [resizing, setResizing] = useState(false);

  const startResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    setResizing(true);
    const onMove = (ev: PointerEvent) => {
      const rect = ref.current?.getBoundingClientRect(); if (!rect) return;
      setWidth(Math.max(220, Math.min(window.innerWidth - 360, ev.clientX - rect.left)));
    };
    const onUp = () => { setResizing(false); window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Drag the divider above Browse to trade space between the favorites tree and the browser.
  const startVResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    const onMove = (ev: PointerEvent) => {
      const rect = ref.current?.getBoundingClientRect(); if (!rect) return;
      setBrowseH(Math.max(120, Math.min(rect.height - 140, rect.bottom - ev.clientY)));
    };
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Inline-create a root group: drop an editable row into the tree (no browser prompt).
  const newGroup = () => setEditing({ kind: "new-group", parentId: null });

  return (
    // Slide the whole dock in/out by animating its width (closed = 0, fully hidden). While
    // actively resizing we drop the transition so the drag stays 1:1 with the pointer.
    // z-[45] sits above the floating rooms (fixed z-40) but below modals/toasts (z-50+), so the
    // dock slides out over an open room instead of being painted under it.
    <div style={{ width: open ? width : 0 }}
      className={`relative z-[45] shrink-0 h-full min-h-0 overflow-hidden ${resizing ? "" : "transition-[width] duration-200 ease-out"}`}>
      <div ref={ref} style={{ width }} className="relative h-full border-r border-edge bg-canvas flex flex-col min-h-0">
        <div className="flex items-center h-9 px-2 border-b border-edge">
          <span className="flex-1 text-xs font-semibold tracking-wide text-fg">FAVORITES</span>
          <button onClick={newGroup} title="New group"
            className="w-6 h-6 flex items-center justify-center rounded text-muted hover:text-bright hover:bg-elevated">＋</button>
          <button onClick={() => toggleFavorites()} title="Close"
            className="w-6 h-6 flex items-center justify-center rounded text-muted hover:text-bright hover:bg-elevated">✕</button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          <FavoritesTree fav={fav} editing={editing} setEditing={setEditing} />
        </div>
        {browseOpen && (
          <div onPointerDown={startVResize} title="Drag to resize"
            className="h-1.5 shrink-0 cursor-row-resize border-t border-edge hover:bg-accent/40" />
        )}
        <div style={browseOpen ? { height: browseH } : undefined}
          className={`shrink-0 min-h-0 ${browseOpen ? "" : "border-t border-edge"}`}>
          <BrowseSection fav={fav} rootPath={BROWSE_ROOT} open={browseOpen} onToggle={toggleBrowse} />
        </div>
        <div onPointerDown={startResize} title="Drag to resize"
          className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-accent/40" />
      </div>
    </div>
  );
}
