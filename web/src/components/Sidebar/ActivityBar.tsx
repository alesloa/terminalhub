import type { ReactNode } from "react";
import type { SidebarView } from "../../store/ui";
import { useRoom } from "../../store/room";
import { PEACOCK_BAR, PEACOCK_SEAM } from "../../lib/peacock";

// The view toggles shared by the (legacy) vertical rail and the bottom status bar.
export const ACTIVITY_ITEMS: { id: SidebarView; label: string; icon: ReactNode }[] = [
  { id: "explorer", label: "Explorer", icon: <ExplorerIcon /> },
  { id: "scm", label: "Source Control", icon: <ScmIcon /> },
  { id: "bookmarks", label: "Bookmarks", icon: <BookmarkIcon /> },
  { id: "todos", label: "TODOs", icon: <TodosIcon /> },
  { id: "claude", label: "Sessions", icon: <SessionsIcon /> },
  { id: "skills", label: "Skills", icon: <SkillsIcon /> },
];

/**
 * VS Code-style activity bar. Renders as a vertical icon strip on the left, or a
 * horizontal strip across the top, driven by ui.sidebarPosition. The position toggle
 * lives at the far end (bottom when left, right when top), mirroring VS Code's
 * "Move Primary Side Bar" affordance.
 */
export function ActivityBar({ orientation }: { orientation: "left" | "top" }) {
  const activeView = useRoom(s => s.activeView);
  const leftOpen = useRoom(s => s.leftOpen);
  const selectView = useRoom(s => s.selectView);
  const toggleLeft = useRoom(s => s.toggleLeft);
  const vertical = orientation === "left";

  return (
    <div style={{ background: PEACOCK_BAR, borderColor: PEACOCK_SEAM }} className={vertical
      ? "w-12 shrink-0 border-r border-edge bg-canvas flex flex-col items-center py-1"
      : "h-10 shrink-0 border-b border-edge bg-canvas flex flex-row items-center px-1"}>
      {ACTIVITY_ITEMS.map(it => {
        const active = leftOpen && activeView === it.id;
        return (
          <button key={it.id} title={it.label} onClick={() => selectView(it.id)}
            className={`relative flex items-center justify-center text-[20px] leading-none
              ${vertical ? "w-12 h-12" : "w-12 h-10"}
              ${active ? "text-bright" : "text-dim hover:text-fg"}`}>
            {/* active accent: a bar on the inner edge, like VS Code */}
            {active && <span className={vertical
              ? "absolute left-0 top-2 bottom-2 w-0.5 bg-blue-500"
              : "absolute bottom-0 left-2 right-2 h-0.5 bg-blue-500"} />}
            {it.icon}
          </button>
        );
      })}
      {/* Collapse/expand the whole side bar — pinned to the far end (bottom when left,
          right when top). Hides the panel so only the editor + terminal remain. */}
      <button title={leftOpen ? "Hide Side Bar" : "Show Side Bar"} onClick={toggleLeft}
        className={`relative flex items-center justify-center text-[20px] leading-none
          ${vertical ? "w-12 h-12 mt-auto" : "w-12 h-10 ml-auto"}
          ${leftOpen ? "text-fg hover:text-bright" : "text-dim hover:text-fg"}`}>
        <PanelToggleIcon />
      </button>
    </div>
  );
}

// Divided rectangle — the VS Code "Toggle Primary Side Bar" glyph. Tints brighter when open.
function PanelToggleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <rect x="2" y="3" width="12" height="10" rx="1.4" />
      <path d="M6 3v10" strokeLinecap="round" />
    </svg>
  );
}

// --- icons (16px, stroke = currentColor) so they tint with the active/hover state ---

// File-tree / list-tree glyph (lucide "list-tree") — reads as a hierarchical explorer.
function ExplorerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12h-8" />
      <path d="M21 6H8" />
      <path d="M21 18h-8" />
      <path d="M3 6v4c0 1.1.9 2 2 2h3" />
      <path d="M3 10v6c0 1.1.9 2 2 2h3" />
    </svg>
  );
}
// Bookmark ribbon, matching the VS Code Bookmarks extension's activity-bar glyph.
function BookmarkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <path d="M4 2.5h8a.5.5 0 0 1 .5.5v10.5L8 11l-4.5 3V3a.5.5 0 0 1 .5-.5z" />
    </svg>
  );
}
function ScmIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <circle cx="4.5" cy="3.5" r="1.6" />
      <circle cx="4.5" cy="12.5" r="1.6" />
      <circle cx="11.5" cy="6" r="1.6" />
      <path d="M4.5 5.1v5.8M11.5 7.6c0 2.2-2.5 2.4-4 2.9" strokeLinecap="round" />
    </svg>
  );
}
// Session list: a transcript with rows + a leading status dot, echoing the extension's icon.
function SessionsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <rect x="2" y="2.5" width="12" height="11" rx="1.6" />
      <circle cx="4.7" cy="5.6" r="0.9" fill="currentColor" stroke="none" />
      <path d="M7 5.6h4.5" strokeLinecap="round" />
      <path d="M4.4 8.4h7.2M4.4 11.1h7.2" strokeLinecap="round" />
    </svg>
  );
}
// Books on a shelf (library) — the "skills" glyph: three upright spines of varying height plus one
// leaning book, sitting on a baseline. Reads as a knowledge library.
function SkillsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.4" y="7" width="3.4" height="13.5" rx="0.7" />
      <rect x="7.4" y="4.6" width="3.4" height="15.9" rx="0.7" />
      <rect x="11.4" y="8.6" width="3.4" height="11.9" rx="0.7" />
      <rect x="15.8" y="7.4" width="3.2" height="13.1" rx="0.7" transform="rotate(14 17.4 20.5)" />
      <path d="M2.6 20.6h18.8" />
    </svg>
  );
}
// Checklist with a tick (lucide "list-todo") — a checkbox, a check mark, and task lines. The TODOs view.
function TodosIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="6" height="6" rx="1" />
      <path d="m3 17 2 2 4-4" />
      <path d="M13 6h8" />
      <path d="M13 12h8" />
      <path d="M13 18h8" />
    </svg>
  );
}
function GithubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
