import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useUi } from "../store/ui";

/** Returns a function that jumps to a workspace's room and (optionally) focuses one terminal in it —
 *  the deep-link a toast or a notification-center row performs when clicked. Crosses virtual desktops
 *  (slides the room's space in first), then opens/brings-forward the room without touching its window
 *  mode. Shared by the Toaster and the NotificationCenter so the navigation stays identical. */
export function useGoToTerminal() {
  const openRoom = useUi((s) => s.openRoom);
  const focusRoom = useUi((s) => s.focusRoom);
  const setActiveSpace = useUi((s) => s.setActiveSpace);
  const requestTerminalFocus = useUi((s) => s.requestTerminalFocus);
  // Cached app-wide (App polls it; react-query dedups) — lets us find which space the room lives on.
  const { data: wsData } = useQuery({ queryKey: ["workspaces"], queryFn: api.listWorkspaces });

  return (workspaceId?: string, terminalId?: string) => {
    if (!workspaceId) return;
    const ws = wsData?.workspaces.find((w) => w.id === workspaceId);
    // If the room is on another space, slide that space in first — otherwise the room stays off-screen.
    if (ws?.spaceId) setActiveSpace(ws.spaceId);
    if (terminalId) requestTerminalFocus(workspaceId, terminalId);
    openRoom(workspaceId);   // open it, or bring it to the front if already open — never change its mode
    focusRoom(workspaceId);  // make sure it's the top (undimmed) room
  };
}
