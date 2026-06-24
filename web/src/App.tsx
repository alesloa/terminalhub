import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api/client";
import type { Workspace } from "./api/types";
import { nextFreeCell } from "./lib/grid";
import { SpacePager } from "./components/SpacePager";
import { FavoritesDock } from "./components/Favorites/FavoritesDock";
import { StageManager } from "./components/StageManager/StageManager";
import { NewWorkspaceModal } from "./components/NewWorkspaceModal";
import { Room } from "./components/Room";
import { RoomPanLayer } from "./components/RoomPanLayer";
import { TopBar } from "./components/TopBar";
import { SystemStatsBar } from "./components/SystemStatsBar";
import { StickyNotesLayer } from "./components/StickyNotes/StickyNotesLayer";
import { SpaceWidgetsLayer } from "./components/Widgets/SpaceWidgetsLayer";
import { CanvasSelection } from "./components/CanvasSelection";
import { SystemMonitor } from "./components/SystemMonitor";
import { CopilotOrb } from "./components/Copilot/CopilotOrb";
import { CopilotWindow } from "./components/Copilot/CopilotWindow";
import { ScrollbackViewer } from "./components/ScrollbackViewer";
import { LocalhostWindow } from "./components/Localhost/LocalhostWindow";
import { SpaceWizardModal } from "./components/SpaceWizard/SpaceWizardModal";
import { Toaster } from "./components/Toaster";
import { ConfirmHost } from "./components/ConfirmHost";
import { AdmissionPrompt } from "./components/AccessLinks/AdmissionPrompt";
import { BreakOverlay } from "./components/Break/BreakOverlay";
import { useNotificationSocket } from "./hooks/useNotificationSocket";
import { useClearViewedNotifications } from "./hooks/useClearViewedNotifications";
import { useBreakTimer } from "./hooks/useBreakTimer";
import { useThemeSync } from "./theme/useTheme";
import { useUi } from "./store/ui";

export default function App() {
  useThemeSync(); // apply the active theme's CSS vars to <html> on boot + whenever it changes
  const [showNew, setShowNew] = useState(false);
  const qc = useQueryClient();
  const openRooms = useUi(s => s.openRooms);
  const stageMode = useUi(s => s.stageMode);
  const stagedWorkspaceId = useUi(s => s.stagedWorkspaceId);
  const stageManagerEnabled = useUi(s => s.stageManagerEnabled);
  const stageOpen = useUi(s => s.stageOpen);
  // Spotlight only filters the canvas when the feature is on, the dock is open, and a room is
  // actually staged — otherwise show every open room (never hide them all). The active-space guard is
  // applied below (once spaceOf/activeIndex are known) so spotlight can't blank a space it doesn't own.
  const spotlightOn = stageManagerEnabled && stageOpen && stageMode === "spotlight" && stagedWorkspaceId != null;
  // "Show Desktop": rooms in this set are not mounted on the canvas (tmux stays alive), so the bare card
  // canvas shows through. Restored from the bottom-bar button, the Stage Manager dock, or a taskbar pill.
  const hiddenRoomIds = useUi(s => s.hiddenRoomIds);
  const favoritesOpen = useUi(s => s.favoritesOpen);
  const toggleFavorites = useUi(s => s.toggleFavorites);
  const monitorOpen = useUi(s => s.monitorOpen);
  const setMonitorOpen = useUi(s => s.setMonitorOpen);
  const copilotOpen = useUi(s => s.copilotOpen);
  const setCopilotOpen = useUi(s => s.setCopilotOpen);
  const scrollbackTerminalId = useUi(s => s.scrollbackTerminalId);
  const closeScrollback = useUi(s => s.closeScrollback);
  const localhostOpen = useUi(s => s.localhostOpen);
  const applySettings = useUi(s => s.setSettings);
  const activeSpaceId = useUi(s => s.activeSpaceId);
  const spaceWizard = useUi(s => s.spaceWizard);
  const focusRoom = useUi(s => s.focusRoom);
  const canvasRef = useRef<HTMLDivElement>(null);
  // workspaceId → its owning spaceId, so each open room can be shown only on its own space's canvas.
  // Reads the same cached list SpacePager polls (react-query dedups), so this adds no extra request.
  const { data: wsData } = useQuery({ queryKey: ["workspaces"], queryFn: api.listWorkspaces });
  const spaceOf = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const w of wsData?.workspaces ?? []) m.set(w.id, w.spaceId);
    return m;
  }, [wsData]);
  // Ordered spaces → index, so an open room can be slid to its space's column (matching the card
  // filmstrip's translateX). Shares SpacePager's cached ["spaces"] poll (react-query dedups).
  const { data: spacesData } = useQuery({ queryKey: ["spaces"], queryFn: api.listSpaces });
  const spaceIndex = useMemo(() => {
    const m = new Map<string, number>();
    (spacesData?.spaces ?? []).forEach((s, i) => m.set(s.id, i));
    return m;
  }, [spacesData]);
  const activeIndex = spaceIndex.get(activeSpaceId) ?? 0;
  // Spotlight may hide the other rooms only when the staged room lives on the active space; otherwise a
  // space switch would leave the canvas blank (staged room parked off-screen) until the dock re-stages.
  const spotlightActive = spotlightOn && (spaceIndex.get(spaceOf.get(stagedWorkspaceId ?? "") ?? "") ?? activeIndex) === activeIndex;
  // Restored open rooms (from localStorage) may name a workspace that was deleted while closed. Once
  // the list has loaded, close those — the render below also hides unknown rooms, this prunes the
  // stored set so it doesn't keep a dead room around. Skips while wsData is still undefined (cold boot)
  // and trusts react-query to hold the last good list on a fetch error (never an empty replacement).
  useEffect(() => {
    if (!wsData) return;
    const ids = new Set(wsData.workspaces.map(w => w.id));
    const { openRooms: open, closeRoom } = useUi.getState();
    open.forEach(r => { if (!ids.has(r.workspaceId)) closeRoom(r.workspaceId); });
  }, [wsData]);
  // Temp access link: a teammate arriving via `?room=<ws>` lands straight in that room. Once the
  // workspaces list loads, open the stashed room a single time (if it's real) and clear the marker, so
  // it never reopens on a later refresh. Owner/manual visitors have no marker — this is a no-op for them.
  const pendingRoomDone = useRef(false);
  useEffect(() => {
    if (!wsData || pendingRoomDone.current) return;
    pendingRoomDone.current = true;
    let room: string | null = null;
    try { room = sessionStorage.getItem("tr.pendingRoom"); sessionStorage.removeItem("tr.pendingRoom"); } catch { /* private mode */ }
    if (room && wsData.workspaces.some(w => w.id === room)) {
      const ws = wsData.workspaces.find(w => w.id === room)!;
      if (ws.spaceId) useUi.getState().setActiveSpace(ws.spaceId);
      useUi.getState().openRoom(room);
    }
  }, [wsData]);
  // Switching to a space makes that space's top-most open room the focused (undimmed) one. Without
  // this a now-hidden room in another space could keep the global top z-order and dim every visible
  // room. Fires only on space change (the other values are read fresh from the closure each run).
  useEffect(() => {
    const here = useUi.getState().openRooms.filter(r => spaceOf.get(r.workspaceId) === activeSpaceId);
    if (here.length) focusRoom(here.reduce((m, r) => (r.z > m.z ? r : m)).workspaceId);
  }, [activeSpaceId]); // eslint-disable-line react-hooks/exhaustive-deps
  const create = useMutation({
    mutationFn: api.createWorkspace,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["workspaces"] }); setShowNew(false); setPendingPos(null); },
  });
  // A right-click "New workspace" on the canvas asks (via the store) to open the modal and drop the
  // card exactly where the cursor was, on that space. Consume the signal once: remember the spot,
  // open the modal, clear the request. The TopBar button leaves pendingPos null (grid placement).
  const newWorkspaceRequest = useUi(s => s.newWorkspaceRequest);
  const clearNewWorkspaceRequest = useUi(s => s.clearNewWorkspaceRequest);
  const [pendingPos, setPendingPos] = useState<{ spaceId: string | null; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!newWorkspaceRequest) return;
    setPendingPos({ spaceId: newWorkspaceRequest.spaceId, x: newWorkspaceRequest.x, y: newWorkspaceRequest.y });
    setShowNew(true);
    clearNewWorkspaceRequest();
  }, [newWorkspaceRequest, clearNewWorkspaceRequest]);
  // Drop a new card at the right-clicked spot when one was requested; otherwise into the first empty
  // grid cell (after the existing cards) instead of the top-left default, so it never overlaps.
  const handleCreate = (v: { name: string; folder: string }) => {
    if (pendingPos) {
      const { spaceId, x, y } = pendingPos;
      create.mutate({ ...v, x, y, ...(spaceId ? { spaceId } : {}) });
      return;
    }
    const all = qc.getQueryData<{ workspaces: Workspace[] }>(["workspaces"])?.workspaces ?? [];
    const cards = activeSpaceId ? all.filter(w => w.spaceId === activeSpaceId) : all;
    const width = canvasRef.current?.clientWidth ?? window.innerWidth;
    const { x, y } = nextFreeCell(cards, width);
    create.mutate({ ...v, x, y, ...(activeSpaceId ? { spaceId: activeSpaceId } : {}) });
  };

  useNotificationSocket(); // single renderer: agent / reminder / attention notifications → toast + chime + speak + OS notif
  useClearViewedNotifications(); // viewing a terminal clears its notification-center entries
  useBreakTimer(); // drive the recurring break enforcer (overlay mounted below)
  useEffect(() => {
    // ask once so background "needs attention" alerts can surface as OS notifications
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);
  useEffect(() => {
    let disposed = false;
    api.getSettings().then((s) => {
      if (!disposed) applySettings({
        autoSave: s.autoSave,
        autoSaveDelaySeconds: s.autoSaveDelaySeconds,
        minimap: s.minimap,
        wordWrap: s.wordWrap,
        lineNumbers: s.lineNumbers,
        diffSplit: s.diffSplit,
        sidebarPosition: s.sidebarPosition,
        theme: s.theme,
        focusBarColor: s.focusBarColor,
        stageManagerEnabled: s.stageManagerEnabled,
        stageManagerPosition: s.stageManagerPosition,
        betterComments: s.betterComments,
        breaks: s.breaks,
      });
    }).catch(() => {});
    return () => { disposed = true; };
  }, [applySettings]);

  return (
    // h-full (not h-screen / 100vh): under a mirror viewer the app is rendered inside MirrorStage's
    // host-sized box, so heights must be relative to that box, not the physical viewport. The
    // html/body/#root height:100% chain (theme.css) makes h-full == the viewport in the normal case.
    <div className="h-full">
      <TopBar onNewWorkspace={() => setShowNew(true)} />
      {/* Home screen: the Favorites dock (project switcher) sits left of the canvas of cards. */}
      <div className="flex h-[calc(100%-56px)]">
        <FavoritesDock />
        {/* Click anywhere on the canvas to slide the favorites dock closed (click-away). The
            system-monitor strip is pinned to the very bottom under the scrollable card canvas. */}
        <div ref={canvasRef} className="relative flex-1 min-w-0 flex flex-col" onClick={() => { if (favoritesOpen) toggleFavorites(); }}>
          <div className="relative flex-1 min-h-0"><SpacePager /></div>
          <SystemStatsBar />
          <StickyNotesLayer />
          <SpaceWidgetsLayer />
          {/* Desktop-style marquee select + group drag + bulk remove for cards/notes/widgets. */}
          <CanvasSelection />
        </div>
      </div>
      {showNew && <NewWorkspaceModal onCreate={handleCreate} onCancel={() => { setShowNew(false); setPendingPos(null); }} />}
      {/* Rooms stage: a viewport-fixed, clipped layer (z-40, below modals/toasts/spaces-bar). Every
          open room stays mounted (live WS + agent survive) inside its own space's column and slides
          horizontally in lockstep with the card filmstrip when you switch spaces, instead of just
          popping in/out. offset = (room's space index − active index) × 100% (of the stage = one
          viewport width — % not vw so it stays the STAGE's width when a mirror viewer renders the app
          inside MirrorStage's scaled host-sized box). The wrapper's transform makes it the fixed room's
          containing block, so left/top px still map 1:1 to the stage at rest (offset 0) and drag math
          stays correct. An OFF-SCREEN (non-active) column also clips itself (overflow-hidden) —
          load-bearing: a room dragged to an x past a later-shrunk viewport would otherwise reappear in
          the neighbouring space (the slide is one stage width, but x is
          absolute px). The active column stays unclipped (the outer stage already clips it to the
          viewport, and clipping the dragged column flashes a window on drop). Render in the stable openRooms
          order and stack with z-index (NOT DOM order): focusRoom on a space switch must not reorder
          the DOM, or React would move the focused room's node mid-slide and cancel its transform
          transition — making it pop in instead of slide (visible with a room open on two spaces).
          The stage/wrappers are pointer-events-none so they never block the canvas behind a floating
          window; the room frame re-enables pointer events. */}
      {/* Rooms are screen-space overlays. A maximized room is fullscreen (never panned); a floating window
          keeps its own viewport rect but PANS with its space's canvas camera so an open IDE stays glued to
          its spot on the board as you drag the canvas — handled by RoomPanLayer (imperative transform, so
          the heavy IDE subtree doesn't re-render mid-pan). Zoom is not applied (the IDE keeps a readable
          fixed size). The per-column translateX below still slides them when you switch spaces. */}
      <div className="fixed inset-0 z-40 overflow-hidden pointer-events-none">
        {/* Only render rooms whose workspace is loaded: prunes deleted ones AND guarantees the per-room
            store hydrates from the cached DB layout (Room reads it at mount) — load-bearing for a
            refresh-restore, where the rooms come back before/while the workspaces list is fetching. */}
        {openRooms
          .filter(r => spaceOf.has(r.workspaceId))
          // Spotlight mode: only the staged room is rendered on the canvas. The rest stay in
          // openRooms (tmux alive, previews still poll) but are not mounted here.
          .filter(r => !spotlightActive || r.workspaceId === stagedWorkspaceId)
          // Show Desktop: a hidden room is not mounted (its tmux session keeps running, exactly like a
          // spotlight off-canvas room) — clearing the canvas to the desktop without closing anything.
          .filter(r => !hiddenRoomIds.has(r.workspaceId))
          .map(r => {
          const sid = spaceOf.get(r.workspaceId) ?? "";
          const idx = spaceIndex.get(sid) ?? activeIndex;
          // The column owns the 300ms space-slide (translateX). Its transform makes it the fixed Room's
          // containing block, so the Room's left/top map 1:1 to the stage at rest (offset 0).
          return (
            <div key={r.workspaceId} className={`absolute inset-0 pointer-events-none ${idx === activeIndex ? "" : "overflow-hidden"}`}
              style={{ zIndex: r.z, transform: `translateX(${(idx - activeIndex) * 100}%)`, transition: "transform 300ms ease" }}>
              <RoomPanLayer spaceId={sid} workspaceId={r.workspaceId}>
                <Room room={r} />
              </RoomPanLayer>
            </div>
          );
        })}
      </div>
      {/* Stage Manager — edge-anchored dock of live room previews (own fixed overlay, z-[45]). */}
      <StageManager />
      {/* Shared System Monitor modal — opened from the TopBar button or either stats bar. */}
      {monitorOpen && <SystemMonitor onClose={() => setMonitorOpen(false)} />}
      {/* In-app Copilot — an always-on canvas orb + the assistant window (store-signalled, opened
          from the orb or the TopBar launcher tile). The orb self-hides when the feature is disabled. */}
      <CopilotOrb />
      {copilotOpen && <CopilotWindow onClose={() => setCopilotOpen(false)} />}
      {/* Terminal scrollback viewer — store-signalled from a terminal pane's "view buffer" button.
          Keyed by terminal so reopening for a different one remounts with a fresh capture + origin. */}
      {scrollbackTerminalId && <ScrollbackViewer key={scrollbackTerminalId} terminalId={scrollbackTerminalId} onClose={closeScrollback} />}
      {/* Localhost preview browser — store-signalled (TopBar tile or a terminal localhost-link click). */}
      {localhostOpen && <LocalhostWindow onClose={() => useUi.setState({ localhostOpen: false, localhostPending: null })} />}
      {/* Space Creation Wizard — store-driven (opened from "+ New space" or a space's "Edit config").
          Keyed by target so reopening for a different space remounts with fresh prefilled state. */}
      {spaceWizard && <SpaceWizardModal key={`${spaceWizard.mode}:${spaceWizard.spaceId ?? spaceWizard.workspaceId ?? "new"}`} state={spaceWizard} />}
      <Toaster />
      {/* Global confirm modal host (replaces native window.confirm). */}
      <ConfirmHost />
      {/* Center-screen Accept/Decline when a teammate opens an access link (owner only). */}
      <AdmissionPrompt />
      {/* Recurring break enforcer — a full-screen veil above everything (renders only when active). */}
      <BreakOverlay />
    </div>
  );
}
