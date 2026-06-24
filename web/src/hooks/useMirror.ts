import { useEffect, useState } from "react";
import { usePresence, type ViewState } from "../store/presence";
import { useUi, type WinRect, type OpenFile, type RoomViewState } from "../store/ui";

// Presentation mirroring. Two halves, both mounted once at the app root:
//   • useMirrorBroadcast — OWNER side. Whenever my nav changes (active space, open rooms, a room's
//     fullscreen mode, which TopBar panels are open + their geometry, the Monitor / Localhost windows)
//     — or a new viewer joins — broadcast my view. The server relays it only to the viewers whose link
//     has "mirror" on, so this is a cheap no-op when nobody's mirroring.
//   • useMirrorApply — VIEWER side. When the host is presenting to me, apply their view: switch to
//     their space, open/close the same rooms (opening a room attaches me to the same tmux, so I watch
//     their live terminal), converge each room's fullscreen mode, and open the SAME panels/windows at
//     the SAME geometry the host has.
// Only a "main" broadcasts and only a mirrored "key" applies, so the two never feed back into each other.
// (Workspace-card positions are NOT mirrored here — they're shared canvas state synced both ways over a
// separate `cards` frame, see usePresenceSocket + SpaceCanvas.)

// The owner-only Share panel is never pushed to a viewer (it would 403 for a key principal anyway).
const PANEL_DENY = "access";

export function useMirrorBroadcast(): void {
  const role = usePresence((s) => s.role);
  const sendView = usePresence((s) => s.sendView);
  const peerCount = usePresence((s) => Object.keys(s.peers).length); // a new viewer joining → resend so they sync now
  const activeSpaceId = useUi((s) => s.activeSpaceId);
  const openRooms = useUi((s) => s.openRooms);
  const roomMaximized = useUi((s) => s.roomMaximized);
  const activeByRoom = useUi((s) => s.activeTerminalByWorkspace);
  const roomRects = useUi((s) => s.roomRectByWorkspace); // each room's live floating geometry, published up from Room
  const roomEditors = useUi((s) => s.roomEditorByWorkspace); // each room's open editor tabs + active tab, published up from Room
  const roomViews = useUi((s) => s.roomViewByWorkspace); // each room's sidebar/panel chrome, published up from Room
  const panels = useUi((s) => s.panels);
  const monitor = useUi((s) => s.monitorOpen);
  const localhost = useUi((s) => s.localhostOpen);
  // My CSS viewport, re-read on resize. Sent with the view so a viewer on a smaller/larger screen can
  // render at MY size and scale-to-fit (MirrorStage) — and narrowing my window re-fits their screen live.
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (role !== "main" || !sendView) return;
    const rooms = openRooms
      .filter((r) => !r.closing)
      .map((r) => {
        const ed = roomEditors[r.workspaceId];
        return {
          workspaceId: r.workspaceId,
          maximized: !!roomMaximized[r.workspaceId],
          activeTerminalId: activeByRoom[r.workspaceId] ?? null,
          rect: roomRects[r.workspaceId] ?? null,
          openFiles: ed?.openFiles ?? [],
          activeFile: ed?.activeFile ?? "",
          view: roomViews[r.workspaceId],
        };
      });
    const panelList = Object.entries(panels)
      .filter(([id]) => id !== PANEL_DENY)
      .map(([id, p]) => ({ id, rect: p.rect }));
    sendView({ activeSpaceId, rooms, panels: panelList, monitor, localhost, viewport: vp });
  }, [role, sendView, peerCount, activeSpaceId, openRooms, roomMaximized, activeByRoom, roomRects, roomEditors, roomViews, panels, monitor, localhost, vp]);
}

export function useMirrorApply(): void {
  const role = usePresence((s) => s.role);
  const mirrored = usePresence((s) => s.mirrored);
  const viewState = usePresence((s) => s.viewState);

  useEffect(() => {
    if (role !== "key" || !mirrored || !viewState) return;
    applyView(viewState);
  }, [role, mirrored, viewState]);
}

// Drive the local UI to match the host's view. Read the store imperatively (getState) so this runs only
// when a fresh `view` arrives, never on the local churn it causes — no loop.
function applyView(v: ViewState): void {
  const ui = useUi.getState();
  if (v.activeSpaceId && v.activeSpaceId !== ui.activeSpaceId) ui.setActiveSpace(v.activeSpaceId);

  const want = new Set(v.rooms.map((r) => r.workspaceId));
  for (const r of v.rooms) {
    if (!ui.openRooms.some((o) => o.workspaceId === r.workspaceId)) ui.openRoom(r.workspaceId);
  }
  for (const o of ui.openRooms) {
    if (!want.has(o.workspaceId) && !o.closing) ui.beginClose(o.workspaceId);
  }

  const map: Record<string, boolean> = {};
  for (const r of v.rooms) map[r.workspaceId] = r.maximized;
  ui.setMirrorMaximized(map);

  // Converge each open room's active terminal to the host's, so picking a different terminal on the
  // host switches it on the viewer too. Each Room watches its own entry (see RoomBody) and selects it.
  const activeMap: Record<string, string> = {};
  for (const r of v.rooms) if (r.activeTerminalId) activeMap[r.workspaceId] = r.activeTerminalId;
  ui.setMirrorActiveTerminals(activeMap);

  // Adopt the host's floating window geometry per room — each Room watches its entry and converges its
  // windowRect, so moving/resizing the window on the host moves it here too. A maximized room ignores
  // this (mirrorMaximized handles the fullscreen toggle).
  const rectMap: Record<string, WinRect> = {};
  for (const r of v.rooms) if (r.rect) rectMap[r.workspaceId] = r.rect;
  ui.setMirrorRects(rectMap);

  // Adopt the host's open editor tabs + active tab per room — each Room watches its entry and converges,
  // so opening or switching a file on the host opens it here too (the viewer's editor loads the content).
  const editorMap: Record<string, { openFiles: OpenFile[]; activeFile: string }> = {};
  for (const r of v.rooms) if (r.openFiles) editorMap[r.workspaceId] = { openFiles: r.openFiles, activeFile: r.activeFile ?? "" };
  ui.setMirrorEditors(editorMap);

  // Adopt the host's sidebar/panel chrome per room — each Room watches its entry and converges, so
  // switching the activity-bar view, collapsing a panel, or resizing one on the host follows here too.
  const viewMap: Record<string, RoomViewState> = {};
  for (const r of v.rooms) if (r.view) viewMap[r.workspaceId] = r.view;
  ui.setMirrorRoomViews(viewMap);

  // Open the same TopBar panels the host has open, at the host's geometry (Share is never sent, but
  // guard here too). TopBar renders its modals from this; the store-signalled Monitor/Localhost windows
  // read their geometry from here while their open-state converges below.
  const panels: Record<string, { rect: WinRect | null }> = {};
  for (const p of v.panels ?? []) if (p.id !== PANEL_DENY) panels[p.id] = { rect: p.rect };
  ui.setMirrorPanels(panels);

  // Monitor / Localhost live outside TopBar (rendered in App, store-signalled) — converge their open
  // state to the host's. Use the animated close-request paths so a closing window minimizes, not vanishes.
  if (v.monitor && !ui.monitorOpen) ui.setMonitorOpen(true);
  else if (!v.monitor && ui.monitorOpen) ui.requestMonitorClose();
  if (v.localhost && !ui.localhostOpen) ui.openLocalhost();
  else if (!v.localhost && ui.localhostOpen) ui.requestLocalhostClose();
}
