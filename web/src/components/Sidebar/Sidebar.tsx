import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useRoom } from "../../store/room";
import { useUi } from "../../store/ui";
import { lockCursor } from "../../lib/dragCursor";
import { ExplorerPanel } from "../Explorer/ExplorerPanel";
import { GitPanel } from "../Scm/GitPanel";
import { GitHubPanel } from "../Scm/GitHubPanel";
import { ClaudeSessionsPanel } from "../ClaudeSessions/ClaudeSessionsPanel";
import { BookmarksPanel } from "../Bookmarks/BookmarksPanel";
import { TodosPanel } from "../Todos/TodosPanel";
import { SkillsPanel } from "../Skills/SkillsPanel";
import { PanelActivityBar } from "./PanelActivityBar";

/** The primary side bar. Shows whichever view the activity bar has selected. */
export function Sidebar({ rootPath }: { rootPath: string }) {
  const view = useRoom(s => s.activeView);
  const leftOpen = useRoom(s => s.leftOpen);
  // In "top" mode the view switcher is a bar at the top of the panel (it clips with the panel when
  // collapsed; the BottomBar then surfaces the icons so the panel can be reopened). left/right render
  // the rail at the workspace edge (in Room.tsx), and "bottom" keeps the icons in the BottomBar.
  const pos = useUi(s => s.sidebarPosition);
  const ref = useRef<HTMLDivElement>(null);
  // Width lives in the room store (hydrated from / persisted to the workspace's saved layout), so
  // it survives a hide/show AND a close/reopen — re-opening restores the last size, not the default.
  const width = useRoom(s => s.sidebarWidth);
  const setWidth = useRoom(s => s.setSidebarWidth);
  // True only while dragging the resize edge. The width transition is the open/close slide;
  // it must be OFF during a manual drag or every pointer move lags a frame behind.
  const [resizing, setResizing] = useState(false);

  // Drag the right edge to resize, whatever view is showing. Panel is left-docked, so
  // width = pointer distance from the panel's own (fixed) left edge. Clamped so it can't
  // swallow the editor. Mirrors the dock/terminals resize handles.
  const startResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    setResizing(true);
    const release = lockCursor("col-resize");
    const onMove = (ev: PointerEvent) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      setWidth(Math.max(220, Math.min(window.innerWidth - 300, ev.clientX - rect.left)));
    };
    const onUp = () => { setResizing(false); release(); window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    // Positioning wrapper: lays out as the left flex item and anchors the resize handle. It is NOT
    // overflow-hidden, so the handle can sit just RIGHT of the seam (over the editor's left edge),
    // clearing the panel's vertical scrollbar (e.g. the git graph's) that lives at the panel's right edge.
    <div className="shrink-0 relative min-h-0 flex">
      {/* Inner clip animates its width 0 <-> width to slide the panel in/out. overflow-hidden clips
          the fixed-width inner so the content stays put and is revealed, rather than reflowing. */}
      <div ref={ref} style={{ width: leftOpen ? width : 0 }}
        className={`shrink-0 flex bg-canvas min-h-0 relative overflow-hidden ${resizing ? "" : "transition-[width] duration-300 ease-in-out"} ${leftOpen ? "border-r border-edge" : ""}`}>
        <div style={{ width }} className="shrink-0 h-full flex flex-col min-h-0">
          {pos === "top" && <PanelActivityBar orientation="top" />}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col">
            {view === "explorer" && <ExplorerPanel rootPath={rootPath} />}
            {view === "scm" && <GitPanel rootPath={rootPath} />}
            {view === "bookmarks" && <BookmarksPanel rootPath={rootPath} />}
            {view === "todos" && <TodosPanel rootPath={rootPath} />}
            {view === "github" && <GitHubPanel rootPath={rootPath} />}
            {view === "claude" && <ClaudeSessionsPanel rootPath={rootPath} />}
            {view === "skills" && <SkillsPanel rootPath={rootPath} />}
          </div>
        </div>
      </div>
      {/* Resize splitter. The wide invisible grab strip sits entirely to the RIGHT of the seam (in
          the editor), so it never covers the panel's vertical scrollbar (10px, just left of the seam)
          — the cursor only flips to col-resize from the seam line rightward. The thin visible line
          sits on the seam and lights on hover/drag. Rendered only when open — a collapsed panel has
          nothing to resize. */}
      {leftOpen && (
        <div onPointerDown={startResize} title="Drag to resize"
          className="group absolute inset-y-0 -right-2.5 z-10 w-2.5 cursor-col-resize">
          <div className={`absolute inset-y-0 left-0 w-0.5 ${resizing ? "bg-accent/60" : "bg-transparent group-hover:bg-accent/40"}`} />
        </div>
      )}
    </div>
  );
}
