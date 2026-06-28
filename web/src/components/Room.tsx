import { useEffect, useReducer, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type TransitionEventHandler } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Workspace } from "../api/types";
import { useUi, rectOf, type OpenRoom, type RoomOrigin, type WinRect } from "../store/ui";
import { createRoomStore, parseRoomLayout, RoomContext, useRoom } from "../store/room";
import { useWindowDrag } from "../hooks/useWindowDrag";
import { usePersistRoomLayout } from "../hooks/useRoomLayout";
import { Sidebar } from "./Sidebar/Sidebar";
import { PanelActivityBar } from "./Sidebar/PanelActivityBar";
import { BranchSwitcher } from "./Scm/BranchSwitcher";
import { EditorArea } from "./Center/EditorArea";
import { TerminalDock } from "./Center/TerminalDock";
import { AgentPicker } from "./AgentPicker";
import { WorkspacePromptWindow } from "./WorkspacePromptWindow";
import type { WindowHandle } from "../hooks/useDraggableWindow";
import { ResizeHandles } from "./ResizeHandles";
import { BottomBar } from "./BottomBar";
import { STATS_BAR_HEIGHT } from "./SystemStatsBar";
import { MicButton } from "./MicButton";
import { PEACOCK_BAR, PEACOCK_SEAM } from "../lib/peacock";
import { hexToChannels } from "../theme/applyTheme";
import { lockCursor } from "../lib/dragCursor";

const DURATION = 320; // ms — expand/collapse animation. Tune to taste.
// Breathing room below a maximized room so it never sits flush against the bottom system-stats
// strip. (A fullscreen room is now flush to the very top, covering the top + spaces bars.)
const MAXIMIZED_GAP = 8; // px

/** Owns a per-room store and provides it to the room's subtree. One per open workspace. */
export function Room({ room }: { room: OpenRoom }) {
  const qc = useQueryClient();
  // Hydrate the per-room store from the workspace's persisted layout. The card we opened from
  // came out of the cached ["workspaces"] list, so the layout blob is already in cache here.
  const [store] = useState(() => {
    const cached = qc.getQueryData<{ workspaces: Workspace[] }>(["workspaces"]);
    const layout = parseRoomLayout(cached?.workspaces.find(w => w.id === room.workspaceId)?.layout);
    return createRoomStore({
      workspaceId: room.workspaceId, windowed: room.windowed, windowRect: room.rect, layout,
    });
  });
  return (
    <RoomContext.Provider value={store}>
      <RoomBody room={room} />
    </RoomContext.Provider>
  );
}

function RoomBody({ room }: { room: OpenRoom }) {
  const { workspaceId, origin } = room;
  const beginClose = useUi(s => s.beginClose);
  const closeRoom = useUi(s => s.closeRoom);
  const focusRoom = useUi(s => s.focusRoom);
  const hideRoom = useUi(s => s.hideRoom);
  const clearGrowFrom = useUi(s => s.clearGrowFrom);
  const stageOpen = useUi(s => s.stageOpen);
  const stageManagerEnabled = useUi(s => s.stageManagerEnabled);
  const toggleStage = useUi(s => s.toggleStage);
  const closeFavorites = useUi(s => s.closeFavorites);
  // A toast click can ask this room to select the terminal that fired it (routed through the
  // global store because the room's own store doesn't exist until it mounts).
  const pendingFocus = useUi(s => s.pendingTerminalFocus[workspaceId]);
  const clearTerminalFocus = useUi(s => s.clearTerminalFocus);
  const reportActiveTerminal = useUi(s => s.reportActiveTerminal);
  const setRoomMaximized = useUi(s => s.setRoomMaximized);
  // Activity-bar placement: left/right render a rail at the workspace's far edge (here), top renders
  // a bar inside the panel, bottom keeps the icons in the BottomBar.
  const pos = useUi(s => s.sidebarPosition);
  // Mic-button placement: "top" keeps it in the window controls here; "bottom" hands it to the
  // BottomBar (which reads the same pref). Default top.
  const micPos = useUi(s => s.micPosition);
  // Live peacock preview while dragging the card's color picker (read before any early return so
  // the hook order stays stable). Absent = use the persisted color.
  const previewColor = useUi(s => s.previewColors[workspaceId]);
  // Focused = top of the stack (highest z). Drives the active/inactive window look so
  // you can tell which room you're working in when several are open.
  const isFocused = useUi(s => {
    if (s.openRooms.length === 0) return false;
    const top = s.openRooms.reduce((m, r) => Math.max(m, r.z), 0);
    return s.openRooms.some(r => r.workspaceId === workspaceId && r.z === top);
  });
  const active = useRoom(s => s.activeTerminalId);
  const setActive = useRoom(s => s.setActiveTerminal);
  const terminalHistory = useRoom(s => s.terminalHistory);
  const openAgentPicker = useRoom(s => s.openAgentPicker);
  const agentPickerOpen = useRoom(s => s.agentPickerOpen);
  // Per-workspace system-prompt window — grows out of the header cog, minimizes back into it. Local
  // (per-browser) state: origin rect to fly from, and a WindowHandle to run the same close animation
  // when the cog is pressed a second time.
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptOrigin, setPromptOrigin] = useState<WinRect | null>(null);
  const promptWin = useRef<WindowHandle>(null);
  const togglePrompt = (btn: HTMLButtonElement) => {
    if (promptOpen) { promptWin.current?.close(); return; }
    setPromptOrigin(rectOf(btn));
    setPromptOpen(true);
  };
  // Save panel sizes / open-state / active view back to the DB (debounced) as they change.
  usePersistRoomLayout(workspaceId);
  const { data } = useQuery({ queryKey: ["workspaces"], queryFn: api.listWorkspaces, refetchInterval: 5000 });
  const ws = data?.workspaces.find(w => w.id === workspaceId);
  const terminals = ws?.terminals ?? [];

  const regionRef = useRef<HTMLDivElement>(null);
  const dockHeight = useRoom(s => s.dockHeight);
  const setDockHeight = useRoom(s => s.setDockHeight);

  // Expand-from-card animation. Mount collapsed onto the card's rect, then flip to
  // full-screen next frame so the CSS transition fires. "Back to map" reverses it;
  // closeRoom() runs only after the collapse transition ends (room stays mounted
  // through the shrink). Respects prefers-reduced-motion.
  const reduce = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [expanded, setExpanded] = useState(reduce);
  // Where this room flies when it collapses: "close" → back to its card (origin); "minimize" → down into
  // its Stage Manager dock thumbnail (a measured rect). The exit handler reads this to know whether to
  // unmount (close) or just hide it off-canvas (minimize). minimizeTarget is the measured tile rect.
  const exitMode = useRef<"close" | "minimize">("close");
  const [minimizeTarget, setMinimizeTarget] = useState<RoomOrigin | null>(null);
  useEffect(() => {
    if (reduce) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setExpanded(true)));
    return () => cancelAnimationFrame(id);
  }, [reduce]);
  const back = () => { exitMode.current = "close"; if (reduce) { closeRoom(workspaceId); return; } beginClose(workspaceId); setExpanded(false); };
  // Minimize: collapse the window into its dock thumbnail, then hide it off-canvas (it stays alive). If the
  // dock is open we fly into the exact tile; if it's closed/disabled we open it (so there's a tile to land
  // on / restore from) and just collapse in place — no guessed target rect.
  const minimize = () => {
    exitMode.current = "minimize";
    if (reduce) { hideRoom(workspaceId); return; }
    const tile = stageManagerEnabled && stageOpen
      ? document.querySelector<HTMLElement>(`[data-stage-id="${workspaceId}"]`)
      : null;
    if (tile) setMinimizeTarget(rectOf(tile));
    else { setMinimizeTarget(null); if (stageManagerEnabled && !stageOpen) toggleStage(); }
    setExpanded(false);
  };
  const onTransitionEnd: TransitionEventHandler = (e) => {
    if (e.target !== e.currentTarget || e.propertyName !== "transform") return;
    if (expanded) { clearGrowFrom(workspaceId); return; } // grow finished → drop the one-shot dock origin
    if (exitMode.current === "minimize") hideRoom(workspaceId);
    else closeRoom(workspaceId);
  };
  // Presentation mirroring (viewer side): when the host closes this room, applyView flips our global
  // `closing` flag — but the collapse animation is driven by local `expanded` (see back()). Drive it here
  // too so a mirror-closed room actually animates out and unmounts instead of staying open. A host-initiated
  // close already set expanded=false in back(), so this is a no-op for it.
  useEffect(() => {
    if (!room.closing) return;
    exitMode.current = "close";
    if (reduce) { closeRoom(workspaceId); return; }
    setExpanded(false);
  }, [room.closing, reduce, workspaceId, closeRoom]);

  // Window mode: fullscreen <-> floating draggable/resizable window.
  const windowed = useRoom(s => s.windowed);
  const windowRect = useRoom(s => s.windowRect);
  const setWindowRect = useRoom(s => s.setWindowRect);
  const toggleWindowed = useRoom(s => s.toggleWindowed);
  // True only while a live drag/resize is in flight — drops the window's transform transition so it
  // tracks the pointer 1:1 instead of easing behind it (see the transition string below).
  const [dragging, setDragging] = useState(false);
  const { beginDrag, beginResize } = useWindowDrag(setDragging);
  // Animate left/top/width/height only on a maximize/restore toggle — never during a
  // drag/resize (those must track the pointer instantly).
  const [animateBox, setAnimateBox] = useState(false);
  const maximizeToggle = () => { setAnimateBox(true); toggleWindowed(); window.setTimeout(() => setAnimateBox(false), 220); };
  // A fullscreen (maximized) room owns the whole canvas — slide the favorites dock shut when this
  // room goes (or opens) fullscreen. Keyed only on `windowed`, so reopening the dock over a
  // fullscreen room still works.
  useEffect(() => { if (!windowed) closeFavorites(); }, [windowed, closeFavorites]);
  // Mirror this room's live window mode into the global store so the spaces bar can drop behind a
  // fullscreen room (a maximized room covers the top bar + spaces bar). closeRoom prunes the entry.
  useEffect(() => { setRoomMaximized(workspaceId, !windowed); }, [windowed, workspaceId, setRoomMaximized]);
  // Presentation mirroring (viewer side): when the host is presenting to this browser, converge this
  // room's fullscreen mode to the host's. `undefined` = not being mirrored, so the room keeps its own
  // mode; otherwise toggle iff it differs (a no-op once matched, so no loop).
  const mirrorMax = useUi(s => s.mirrorMaximized[workspaceId]);
  useEffect(() => {
    if (mirrorMax === undefined) return;
    if (mirrorMax !== !windowed) toggleWindowed();
  }, [mirrorMax, windowed, toggleWindowed]);
  // Publish this room's live floating geometry up to the global store (parallel to roomMaximized) so the
  // owner can broadcast it to mirror viewers. closeRoom prunes the entry.
  const reportRoomRect = useUi(s => s.reportRoomRect);
  useEffect(() => { if (windowRect) reportRoomRect(workspaceId, windowRect); }, [windowRect, workspaceId, reportRoomRect]);
  // Presentation mirroring (viewer side): converge this room's floating geometry to the host's, so moving
  // or resizing the window on the host moves it here too. Absent = not mirrored (keep our own geometry);
  // otherwise adopt the host's rect when it differs (a no-op once matched, so no loop). Programmatic, so
  // it works even for a locked spectator who can't drag.
  const mirrorRect = useUi(s => s.mirrorRectByWorkspace[workspaceId]);
  useEffect(() => {
    if (!mirrorRect) return;
    if (!windowRect || windowRect.x !== mirrorRect.x || windowRect.y !== mirrorRect.y || windowRect.w !== mirrorRect.w || windowRect.h !== mirrorRect.h) {
      setWindowRect(mirrorRect);
    }
  }, [mirrorRect, windowRect, setWindowRect]);
  // Publish this room's open editor tabs + active tab up to the global store so the owner can broadcast
  // them (the tabs live in the per-room store, invisible to the app-level broadcaster otherwise).
  const openFiles = useRoom(s => s.openFiles);
  const activeFile = useRoom(s => s.activeFile);
  const setEditorMirror = useRoom(s => s.setEditorMirror);
  const reportRoomEditor = useUi(s => s.reportRoomEditor);
  useEffect(() => { reportRoomEditor(workspaceId, openFiles, activeFile); }, [openFiles, activeFile, workspaceId, reportRoomEditor]);
  // Presentation mirroring (viewer side): converge this room's editor tabs to the host's, so opening or
  // switching a file on the host opens it here too. Absent = not mirrored (keep our own tabs); otherwise
  // adopt the host's exact set when it differs (a no-op once matched, so no loop).
  const mirrorEditor = useUi(s => s.mirrorEditorByWorkspace[workspaceId]);
  useEffect(() => {
    if (!mirrorEditor) return;
    const sameActive = mirrorEditor.activeFile === activeFile;
    const sameTabs = JSON.stringify(mirrorEditor.openFiles) === JSON.stringify(openFiles);
    if (!sameActive || !sameTabs) setEditorMirror(mirrorEditor.openFiles, mirrorEditor.activeFile);
  }, [mirrorEditor, openFiles, activeFile, setEditorMirror]);
  // Publish this room's live sidebar/panel chrome up so the owner can broadcast it (it lives in the
  // per-room store, invisible to the app-level broadcaster otherwise).
  const activeView = useRoom(s => s.activeView);
  const scmTab = useRoom(s => s.scmTab);
  const leftOpen = useRoom(s => s.leftOpen);
  const rightOpen = useRoom(s => s.rightOpen);
  const sidebarWidth = useRoom(s => s.sidebarWidth);
  const terminalListWidth = useRoom(s => s.terminalListWidth);
  const setViewMirror = useRoom(s => s.setViewMirror);
  const reportRoomView = useUi(s => s.reportRoomView);
  useEffect(() => {
    reportRoomView(workspaceId, { activeView, scmTab, leftOpen, rightOpen, sidebarWidth, terminalListWidth, dockHeight });
  }, [activeView, scmTab, leftOpen, rightOpen, sidebarWidth, terminalListWidth, dockHeight, workspaceId, reportRoomView]);
  // Presentation mirroring (viewer side): converge this room's chrome to the host's, so switching the
  // activity-bar view, collapsing a panel, or resizing one on the host follows here too. Absent = not
  // mirrored (keep our own); otherwise adopt the host's when it differs (a no-op once matched, so no loop).
  const mirrorView = useUi(s => s.mirrorViewByWorkspace[workspaceId]);
  useEffect(() => {
    const m = mirrorView;
    if (!m) return;
    if (m.activeView !== activeView || m.scmTab !== scmTab || m.leftOpen !== leftOpen || m.rightOpen !== rightOpen
      || m.sidebarWidth !== sidebarWidth || m.terminalListWidth !== terminalListWidth || m.dockHeight !== dockHeight) {
      setViewMirror(m);
    }
  }, [mirrorView, activeView, scmTab, leftOpen, rightOpen, sidebarWidth, terminalListWidth, dockHeight, setViewMirror]);
  // Re-render on viewport resize so a maximized room keeps filling the screen.
  const [, force] = useReducer((c: number) => c + 1, 0);
  useEffect(() => {
    const onR = () => force();
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, []);

  // keep the active terminal valid: when it vanishes (closed), fall back to the last terminal you
  // were actually on that still exists (recency stack) rather than always jumping to the first;
  // clear if none remain — and honor a toast click that asked for a specific terminal once it exists.
  useEffect(() => {
    if (terminals.length === 0) { if (active) setActive(null); return; }
    if (pendingFocus && terminals.some(t => t.id === pendingFocus)) {
      if (active !== pendingFocus) setActive(pendingFocus);
      clearTerminalFocus(workspaceId);
      return;
    }
    if (!active || !terminals.some(t => t.id === active)) {
      const recent = terminalHistory.find(id => terminals.some(t => t.id === id));
      setActive(recent ?? terminals[0].id);
    }
  }, [active, terminals, setActive, pendingFocus, clearTerminalFocus, workspaceId, terminalHistory]);

  // Publish this room's active terminal globally so attention toasts know what's on screen (the
  // focused room's active terminal = the terminal you're looking at). closeRoom prunes the entry.
  useEffect(() => { reportActiveTerminal(workspaceId, active); }, [active, workspaceId, reportActiveTerminal]);

  // Presentation mirroring (viewer side): converge this room's active terminal to the host's, so picking
  // a different terminal on the host switches it here too. Absent = not mirrored (keep our own pick);
  // otherwise select the host's terminal once it exists locally (a no-op once matched, so no loop).
  const mirrorActive = useUi(s => s.mirrorActiveByWorkspace[workspaceId]);
  useEffect(() => {
    if (!mirrorActive || mirrorActive === active) return;
    if (terminals.some(t => t.id === mirrorActive)) setActive(mirrorActive);
  }, [mirrorActive, active, terminals, setActive]);

  const startDrag = (e: ReactPointerEvent) => {
    e.preventDefault();
    const release = lockCursor("row-resize");
    const onMove = (ev: PointerEvent) => {
      const rect = regionRef.current?.getBoundingClientRect();
      if (!rect) return;
      setDockHeight(Math.max(120, Math.min(rect.height - 120, rect.bottom - ev.clientY)));
    };
    const onUp = () => { release(); window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  if (!ws) return null;
  const activeTerminal = terminals.find(t => t.id === active) ?? null;

  const vw = window.innerWidth, vh = window.innerHeight;
  // A maximized room is true fullscreen: it fills from the very top (y 0), covering the Terminal Hub
  // top bar (which now carries the spaces switcher) — it drops behind the z-40 rooms layer. It still
  // stops short of the home-canvas system-stats strip pinned at the very bottom, leaving that one
  // strip visible. Floating windows keep their own rect.
  const box = (windowed && windowRect) ? windowRect : { x: 0, y: 0, w: vw, h: vh - STATS_BAR_HEIGHT - MAXIMIZED_GAP };
  // Position the window with a transform (GPU-composited) rather than left/top. Moving via left/top
  // reflows + repaints the whole window subtree every frame — fine for a terminal, but a big Markdown
  // document made dragging jank. A translate just slides the already-painted layer. left/top stay 0;
  // box.x/box.y live in the transform, so the drag (which only changes the rect) never triggers
  // layout. The open/expand animation composes into the same transform.
  const restPos = `translate(${box.x}px, ${box.y}px)`;
  // The collapsed (small) state of the shrink/grow transition. On the entry grow it's `growFrom` (the dock
  // tile a restored room flies out of), else the card `origin`. On exit it's `minimizeTarget` (down into the
  // dock tile) for a minimize, else `origin` (back to the card) for a close. growFrom is only set during a
  // dock restore and cleared once the grow ends, so it never leaks into a later close.
  const collapseTo = (room.growFrom ?? (exitMode.current === "minimize" ? minimizeTarget : origin));
  const collapsed = collapseTo
    ? `translate(${collapseTo.x}px, ${collapseTo.y}px) scale(${collapseTo.w / box.w}, ${collapseTo.h / box.h})`
    : `${restPos} scale(0.94)`;
  // Rooms are screen-space overlays now, independent of the per-space canvas camera: a floating window
  // keeps its own viewport rect and does NOT scale/pan with the card board behind it (kept at 1 so the
  // open/close grow-from-card animation, which works in screen px, stays correct). Maximized = fullscreen.
  const zoomScale = 1;
  // transform animates at 200ms on a maximize/restore toggle, 320ms on open/close, and not at all
  // during a live drag (so it tracks the pointer instantly).
  const transformDur = animateBox ? "200ms ease" : `${DURATION}ms cubic-bezier(.22,.61,.36,1)`;
  const style: CSSProperties = {
    left: 0, top: 0, width: box.w, height: box.h,
    // Dim/desaturate the whole window while it's not the active one (macOS-style).
    filter: isFocused ? undefined : "brightness(.72) saturate(.9)",
    ...(reduce ? { transform: `${restPos} scale(${zoomScale})` } : {
      transformOrigin: collapseTo ? "0 0" : "50% 50%",
      transform: expanded ? `${restPos} scale(${zoomScale})` : collapsed,
      opacity: expanded ? 1 : 0,
      transition: `${dragging ? "" : `transform ${transformDur}, `}opacity ${DURATION}ms ease, filter 160ms ease${animateBox ? ", width 200ms ease, height 200ms ease" : ""}`,
      willChange: "transform, opacity",
    }),
  };
  // pointer-events-auto: the rooms stage (App) is pointer-events-none so its slide layer never
  // blocks the canvas behind a floating window — the frame re-enables events for itself.
  const frame = windowed
    ? `fixed z-40 pointer-events-auto bg-canvas flex flex-col rounded-lg overflow-hidden border ${isFocused ? "shadow-2xl border-edge-strong" : "shadow-lg border-elevated"}`
    : "fixed z-40 pointer-events-auto bg-canvas flex flex-col shadow-2xl";

  // Peacock: tint the whole window chrome from the card color you pick on the canvas.
  // `--peacock` cascades to every chrome surface (top/activity/bottom bars, side bar) via
  // lib/peacock; the frame itself takes a solid colored outline. The right-click picker writes
  // `cardColor`, so read that first (falling back to the legacy `color`). A live preview wins so
  // the chrome tracks the slider in real time. No color → no var → chrome stays dark.
  const peacock = previewColor !== undefined ? previewColor : (ws.cardColor ?? ws.color);
  const frameStyle: CSSProperties = { ...style };
  if (peacock) {
    const fs = frameStyle as Record<string, string | number>;
    fs["--peacock"] = peacock;
    frameStyle.borderColor = peacock;
    frameStyle.borderWidth = 2;
    frameStyle.borderStyle = "solid";
    // Peacock wins over the active theme INSIDE this room: rebind the accent tokens (channels) to
    // the card color on the frame, so every accent surface below — buttons, focus rings, links —
    // uses peacock instead of whatever the theme set on <html>. Only for real hex colors (the
    // pickers always emit hex); the rgb(var()) fallback means "no custom color", leave theme as-is.
    if (peacock.startsWith("#")) {
      const ch = hexToChannels(peacock);
      fs["--tr-accent"] = ch;
      fs["--tr-accent-hover"] = ch;
      fs["--tr-link"] = ch;
    }
  }

  return (
    <div onTransitionEnd={onTransitionEnd} onPointerDownCapture={() => focusRoom(workspaceId)}
      // Suppress the browser's native right-click menu anywhere in the room (empty panels, the SCM
      // list, headers, …) so it never leaks Chrome's "Back / Reload / Inspect" menu. Editable text
      // fields are exempted so right-click paste/copy still works (commit box etc.); custom menus
      // (file rows, cards) preventDefault + show their own first, so re-preventing here is a no-op.
      onContextMenu={(e) => {
        const t = e.target as HTMLElement;
        if (!t.closest("input, textarea") && !t.isContentEditable) e.preventDefault();
      }}
      style={frameStyle} className={frame}>
      <div onPointerDown={windowed ? beginDrag : undefined}
        style={{ background: PEACOCK_BAR, borderColor: PEACOCK_SEAM }}
        className={`h-8 shrink-0 flex items-center gap-3 px-4 border-b border-edge ${windowed ? "cursor-move" : ""}`}>
        {/* left: workspace name + clickable branch switcher */}
        <div className="flex items-center gap-2 shrink-0 min-w-0">
          <span className="font-semibold truncate max-w-[14rem]">{ws.name}</span>
          <BranchSwitcher rootPath={ws.folder} />
        </div>
        {/* center: full folder path, responsive — truncates from the left so the tail stays visible */}
        <div className="flex-1 min-w-0 flex justify-center px-2">
          <span dir="rtl" title={ws.folder} className="truncate text-xs text-dim max-w-full">{ws.folder}</span>
        </div>
        {/* right: window controls. (Editor Back / Forward now live at the left of the editor tab
            strip — see EditorArea.) */}
        <div className="flex items-center gap-2 shrink-0" onPointerDown={(e) => e.stopPropagation()}>
          {micPos === "top" && <MicButton />}
          <button onClick={(e) => togglePrompt(e.currentTarget)} title="Workspace system message" aria-label="Workspace system message"
            className="px-2 h-6 inline-flex items-center peacock-btn rounded text-sm leading-none">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
            </svg>
          </button>
          <button onClick={minimize} title="Minimize to dock" aria-label="Minimize to dock"
            className="px-2 h-6 inline-flex items-center peacock-btn rounded text-sm leading-none">—</button>
          <button onClick={maximizeToggle} title={windowed ? "Maximize" : "Restore to window"}
            className="px-2 h-6 inline-flex items-center peacock-btn rounded text-sm leading-none">{windowed ? "▢" : "❐"}</button>
          <button onClick={back} className="px-3 h-6 inline-flex items-center peacock-btn rounded text-sm">{windowed ? "Close" : "Back to map"}</button>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 flex min-h-0">
          {/* The view switcher is a room-edge rail in left/right mode (far left / far right of the
              whole workspace, like VS Code), a bar at the top of the panel in top mode, or icons in
              the BottomBar in bottom mode. Sidebar animates its own width to 0 when collapsed. */}
          {pos === "left" && <PanelActivityBar orientation="left" />}
          <Sidebar rootPath={ws.folder} />

          <div ref={regionRef} className="flex-1 min-w-0 flex flex-col">
            <EditorArea rootPath={ws.folder} />
            <div onPointerDown={startDrag}
              className="h-1.5 shrink-0 cursor-row-resize bg-panel hover:bg-accent/40" />
            <div className="shrink min-h-[120px]" style={{ height: dockHeight }}>
              <TerminalDock
                workspaceId={ws.id}
                terminals={terminals}
                activeTerminal={activeTerminal}
                onStartTerminal={openAgentPicker}
                starting={false}
              />
            </div>
          </div>
          {pos === "right" && <PanelActivityBar orientation="right" />}
        </div>
      </div>

      <BottomBar workspace={ws} />

      {agentPickerOpen && <AgentPicker workspaceId={ws.id} />}

      {promptOpen && (
        <WorkspacePromptWindow ref={promptWin} workspaceId={ws.id} workspaceName={ws.name}
          origin={promptOrigin} onClose={() => setPromptOpen(false)} />
      )}

      {windowed && <ResizeHandles onStart={beginResize} active={isFocused} />}
    </div>
  );
}
