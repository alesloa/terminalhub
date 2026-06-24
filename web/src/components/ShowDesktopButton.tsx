import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useUi } from "../store/ui";

/** Bottom-right "Show Desktop" toggle, pinned to the home stats bar next to the system readout.
 *  Press it to hide every open room on the CURRENT space — the rooms stay open (tmux alive, the WS
 *  just detaches, exactly like a spotlight off-canvas room), so the bare card canvas (the "desktop")
 *  shows through without closing anything. Press again to bring them all back. Individual rooms come
 *  back one at a time from the Stage Manager dock or their taskbar pill (both call showRoom/openRoom).
 *  Scoped to the active space, mirroring the taskbar/dock so it only ever hides what's on-screen. */
export function ShowDesktopButton() {
  const openRooms = useUi(s => s.openRooms);
  const activeSpaceId = useUi(s => s.activeSpaceId);
  const hiddenRoomIds = useUi(s => s.hiddenRoomIds);
  const toggleShowDesktop = useUi(s => s.toggleShowDesktop);

  // Shared, already-cached polls (react-query dedups) — resolve each room's space exactly like the
  // taskbar/dock do: a room with a real spaceId belongs only to that space; a null/unknown one resolves
  // to the active column and follows you across spaces (the same `?? activeIndex` fallback App uses).
  const { data: wsData } = useQuery({ queryKey: ["workspaces"], queryFn: api.listWorkspaces });
  const { data: spacesData } = useQuery({ queryKey: ["spaces"], queryFn: api.listSpaces });
  const spaceIndex = new Map<string, number>();
  (spacesData?.spaces ?? []).forEach((s, i) => spaceIndex.set(s.id, i));
  const activeIndex = spaceIndex.get(activeSpaceId) ?? 0;
  const wsOf = (id: string) => wsData?.workspaces.find(w => w.id === id);
  const roomsHere = openRooms.filter(r => (spaceIndex.get(wsOf(r.workspaceId)?.spaceId ?? "") ?? activeIndex) === activeIndex);

  const ids = roomsHere.map(r => r.workspaceId);
  const hasRooms = ids.length > 0;
  // Desktop is "shown" (button engaged) whenever any room on this space is hidden — pressing then restores
  // them all. With none hidden a press clears the canvas to the desktop.
  const active = hasRooms && ids.some(id => hiddenRoomIds.has(id));

  return (
    <button
      onClick={() => toggleShowDesktop(ids)}
      disabled={!hasRooms}
      title={!hasRooms ? "No open rooms to hide" : active ? "Show open rooms" : "Show Desktop — hide all open rooms"}
      aria-pressed={active}
      className={`flex items-center px-2.5 h-full transition-colors ${
        !hasRooms ? "text-dim opacity-40 cursor-default" : active ? "text-blue-400" : "text-muted hover:text-fg cursor-pointer"
      }`}
    >
      <ShowDesktopIcon />
    </button>
  );
}

/** A framed desktop with arrows pushing out to all four corners — the "clear the windows to reveal
 *  the desktop" gesture. */
function ShowDesktopIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M10 10 7 7M7 7v2.6M7 7h2.6" />
      <path d="M14 10 17 7M17 7v2.6M17 7h-2.6" />
      <path d="M10 14 7 17M7 17v-2.6M7 17h2.6" />
      <path d="M14 14 17 17M17 17v-2.6M17 17h-2.6" />
    </svg>
  );
}
