import { useEffect, useRef, useState } from "react";
import { SettingsModal } from "./SettingsModal";
import { PromptBuilderModal } from "./PromptBuilder/PromptBuilderModal";
import { NotesModal } from "./Notes/NotesModal";
import { BoardModal } from "./Board/BoardModal";
import { TimeSheetModal } from "./Time/TimeSheetModal";
import { HelpModal } from "./HelpModal";
import { FileBrowserModal } from "./FileBrowser/FileBrowserModal";
import { SecretModal } from "./Secret/SecretModal";
import { AccessLinksModal } from "./AccessLinks/AccessLinksModal";
import { CalendarModal } from "./Calendar/CalendarModal";
import { QuickTimerModal } from "./QuickTimer/QuickTimerModal";
import { TimerCountdown } from "./QuickTimer/TimerCountdown";
import { BreakModal } from "./Break/BreakModal";
import { NotificationCenter } from "./NotificationCenter/NotificationCenter";
import { LinksMenu } from "./Links/LinksMenu";
import { SpacesMenu } from "./Spaces/SpacesMenu";
import { AppLauncher, type LauncherItem } from "./Launcher/AppLauncher";
import { WidgetMenu } from "./Widgets/WidgetMenu";
import { useUi, rectOf } from "../store/ui";
import { usePresence } from "../store/presence";
import type { WinRect } from "../store/ui";
import type { WindowHandle } from "../hooks/useDraggableWindow";

export function TopBar({ onNewWorkspace }: { onNewWorkspace: () => void }) {
  // Modal open-state lives in the shared store (useUi.panels), NOT local React state — so the owner's
  // open panels are observable and a mirror viewer can be driven to open the SAME ones (see useMirror).
  // Origins (grow-from rect) + the close-animation WindowHandle refs stay local: per-browser animation
  // plumbing the viewer doesn't need. `xOpen` is now derived from the store; `openX` writes to it.
  const panels = useUi(s => s.panels);
  const openPanel = useUi(s => s.openPanel);
  const closePanel = useUi(s => s.closePanel);
  const settingsOpen = !!panels.settings;
  const [settingsOrigin, setSettingsOrigin] = useState<WinRect | null>(null);
  const gearBtnRef = useRef<HTMLButtonElement>(null);
  const openSettings = (rect: WinRect) => { setSettingsOrigin(rect); openPanel("settings"); };
  // Another panel (e.g. the File Browser's Places bar) can ask Settings to open via the store. When a
  // request lands, open Settings if it isn't already (growing it out of the gear icon). The modal reads
  // the requested tab from the store and clears the signal itself.
  const settingsRequest = useUi(s => s.settingsRequest);
  useEffect(() => {
    if (!settingsRequest || settingsOpen) return;
    const r = gearBtnRef.current?.getBoundingClientRect();
    openSettings(r ? { x: r.left, y: r.top, w: r.width, h: r.height } : { x: 0, y: 0, w: 0, h: 0 });
  }, [settingsRequest, settingsOpen]);
  const builderOpen = !!panels.prompt;
  const notesOpen = !!panels.notes;
  const [notesOrigin, setNotesOrigin] = useState<WinRect | null>(null);
  const openNotes = () => { setNotesOrigin(launcherOrigin()); openPanel("notes"); };
  const browserOpen = !!panels.files;
  const [browserOrigin, setBrowserOrigin] = useState<WinRect | null>(null);
  const openBrowser = () => { setBrowserOrigin(launcherOrigin()); openPanel("files"); };
  const boardOpen = !!panels.board;
  const [boardOrigin, setBoardOrigin] = useState<WinRect | null>(null);
  const openBoard = () => { setBoardOrigin(launcherOrigin()); openPanel("board"); };
  const timesheetOpen = !!panels.timesheet;
  const [timesheetOrigin, setTimesheetOrigin] = useState<WinRect | null>(null);
  const openTimesheet = () => { setTimesheetOrigin(launcherOrigin()); openPanel("timesheet"); };
  const helpOpen = !!panels.help;
  const [helpOrigin, setHelpOrigin] = useState<WinRect | null>(null);
  const openHelp = (origin: WinRect | null) => { setHelpOrigin(origin); openPanel("help"); };
  const secretOpen = !!panels.secret;
  const [secretOrigin, setSecretOrigin] = useState<WinRect | null>(null);
  const openSecret = () => { setSecretOrigin(launcherOrigin()); openPanel("secret"); };
  const accessOpen = !!panels.access;
  const [accessOrigin, setAccessOrigin] = useState<WinRect | null>(null);
  const openAccess = () => { setAccessOrigin(launcherOrigin()); openPanel("access"); };
  const calendarOpen = !!panels.calendar;
  const [calendarOrigin, setCalendarOrigin] = useState<WinRect | null>(null);
  const openCalendar = () => { setCalendarOrigin(launcherOrigin()); openPanel("calendar"); };
  const timerOpen = !!panels.timer;
  const [timerOrigin, setTimerOrigin] = useState<WinRect | null>(null);
  const openTimer = () => { setTimerOrigin(launcherOrigin()); openPanel("timer"); };
  const breaksOpen = !!panels.breaks;
  const [breaksOrigin, setBreaksOrigin] = useState<WinRect | null>(null);
  const openBreaks = () => { setBreaksOrigin(launcherOrigin()); openPanel("breaks"); };
  // Handles to the live windows — a second open call (from the launcher tile) runs close() so the
  // panel minimizes back into the launcher, instead of an instant unmount. Null while the panel is shut.
  const notesWin = useRef<WindowHandle>(null);
  const browserWin = useRef<WindowHandle>(null);
  const boardWin = useRef<WindowHandle>(null);
  const timesheetWin = useRef<WindowHandle>(null);
  const helpWin = useRef<WindowHandle>(null);
  const secretWin = useRef<WindowHandle>(null);
  const accessWin = useRef<WindowHandle>(null);
  const calendarWin = useRef<WindowHandle>(null);
  const timerWin = useRef<WindowHandle>(null);
  const breaksWin = useRef<WindowHandle>(null);
  const settingsWin = useRef<WindowHandle>(null);
  const favoritesOpen = useUi(s => s.favoritesOpen);
  const toggleFavorites = useUi(s => s.toggleFavorites);
  const stageEnabled = useUi(s => s.stageManagerEnabled);
  const stageOpen = useUi(s => s.stageOpen);
  const toggleStage = useUi(s => s.toggleStage);
  const snapToGrid = useUi(s => s.snapToGrid);
  const setSnapToGrid = useUi(s => s.setSnapToGrid);
  const requestArrange = useUi(s => s.requestArrange);
  // System Monitor is shared with the stats bars now — drive it from the store. It's rendered in App,
  // so a re-press asks it to minimize-close through the store rather than via a local window handle.
  const monitorOpen = useUi(s => s.monitorOpen);
  const setMonitorOpen = useUi(s => s.setMonitorOpen);
  const requestMonitorClose = useUi(s => s.requestMonitorClose);
  // Copilot — store-signalled like the monitor (also opened from the always-on canvas orb).
  const copilotOpen = useUi(s => s.copilotOpen);
  const setCopilotOpen = useUi(s => s.setCopilotOpen);
  const requestCopilotClose = useUi(s => s.requestCopilotClose);
  // Localhost preview browser — store-signalled (rendered in App), same as the monitor, so a terminal
  // link click can open it without an icon press.
  const localhostOpen = useUi(s => s.localhostOpen);
  const openLocalhost = useUi(s => s.openLocalhost);
  const requestLocalhostClose = useUi(s => s.requestLocalhostClose);
  const showSpacesBar = useUi(s => s.showSpacesBar);
  // A teammate (joined via a temp link) is a "key" principal — the owner-only access-links manager
  // would just 403 for them, so the Share tile is hidden from their launcher.
  const presenceRole = usePresence(s => s.role);

  // The launcher: a start-menu of every tool except Settings + New workspace (which stay standalone).
  // Every tool now opens from this one button, so its rect is the grow-from/minimize-back origin for
  // all the floating windows.
  const [launcherOpen, setLauncherOpen] = useState(false);
  const launcherBtnRef = useRef<HTMLButtonElement>(null);
  const launcherWin = useRef<WindowHandle>(null);
  // Widgets: a second start-menu dropdown (live widget cards) right beside the launcher button.
  const [widgetsOpen, setWidgetsOpen] = useState(false);
  const widgetsBtnRef = useRef<HTMLButtonElement>(null);
  const widgetsWin = useRef<WindowHandle>(null);
  const launcherOrigin = (): WinRect | null => {
    const r = launcherBtnRef.current?.getBoundingClientRect();
    return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
  };

  const launcherItems: LauncherItem[] = [
    { id: "copilot", label: "Copilot", description: "Your in-app AI assistant — knows every feature and can act for you (notes, board, reminders, email, and more).", section: "tools", icon: <CopilotTileIcon />, active: copilotOpen, onSelect: () => copilotOpen ? requestCopilotClose() : setCopilotOpen(true, launcherOrigin()) },
    { id: "favorites", label: "Favorites", description: "Your pinned projects — jump straight to a workspace.", section: "workspace", icon: <StarIcon filled={favoritesOpen} />, active: favoritesOpen, onSelect: toggleFavorites },
    ...(stageEnabled ? [{ id: "stage", label: "Stage Manager", description: "Slide through every open room and jump to one. All-open switcher or spotlight.", section: "workspace", icon: <StageIcon active={stageOpen} />, active: stageOpen, onSelect: toggleStage }] as LauncherItem[] : []),
    { id: "files", label: "Files", description: "Browse the files and folders on your machine.", section: "workspace", icon: <FolderIcon />, active: browserOpen, onSelect: () => browserOpen ? browserWin.current?.close() : openBrowser() },
    { id: "calendar", label: "Calendar", description: "Track events and deadlines in month, week, or day view.", section: "tools", icon: <CalendarIcon />, active: calendarOpen, onSelect: () => calendarOpen ? calendarWin.current?.close() : openCalendar() },
    { id: "timer", label: "Timer", description: "Set a one-off reminder that pings you after a countdown.", section: "tools", icon: <TimerIcon />, active: timerOpen, onSelect: () => timerOpen ? timerWin.current?.close() : openTimer() },
    { id: "breaks", label: "Breaks", description: "Recurring break reminders that nudge you to step away.", section: "tools", icon: <CoffeeIcon />, active: breaksOpen, onSelect: () => breaksOpen ? breaksWin.current?.close() : openBreaks() },
    { id: "notes", label: "Notes", description: "A quick scratchpad for notes that stick around.", section: "tools", icon: <NoteIcon />, active: notesOpen, onSelect: () => notesOpen ? notesWin.current?.close() : openNotes() },
    { id: "board", label: "Board", description: "A kanban board to track tasks across columns.", section: "tools", icon: <BoardIcon />, active: boardOpen, onSelect: () => boardOpen ? boardWin.current?.close() : openBoard() },
    { id: "timesheet", label: "Timesheet", description: "Track work time by client, project, and task — start/stop timers (or let an agent do it) and review day, week, or month totals.", section: "tools", icon: <TimesheetIcon />, active: timesheetOpen, onSelect: () => timesheetOpen ? timesheetWin.current?.close() : openTimesheet() },
    { id: "prompt", label: "Prompt", description: "Turn a rough idea into a polished prompt for your agent.", section: "tools", icon: <PromptBubbleIcon />, active: builderOpen, onSelect: () => builderOpen ? closePanel("prompt") : openPanel("prompt") },
    { id: "secret", label: "Secret", description: "Share a password or key as a one-time, self-destructing link.", section: "tools", icon: <BurnIcon />, active: secretOpen, onSelect: () => secretOpen ? secretWin.current?.close() : openSecret() },
    { id: "access", label: "Share", description: "Share a temporary link so a friend can join your session. Accept them, set a time limit, revoke anytime.", section: "system", icon: <LinkIcon />, active: accessOpen, onSelect: () => accessOpen ? accessWin.current?.close() : openAccess() },
    { id: "localhost", label: "Localhost", description: "A local browser for the web apps you run on this host — viewable from anywhere.", section: "system", icon: <LocalBrowserIcon />, active: localhostOpen, onSelect: () => localhostOpen ? requestLocalhostClose() : openLocalhost(launcherOrigin()) },
    { id: "monitor", label: "Monitor", description: "Live CPU, memory, and network usage for your machine.", section: "system", icon: <ActivityIcon />, active: monitorOpen, onSelect: () => monitorOpen ? requestMonitorClose() : setMonitorOpen(true, launcherOrigin()) },
  ];

  const iconBtn = (active: boolean) =>
    `w-8 h-8 flex items-center justify-center rounded ${active ? "bg-edge text-bright" : "bg-elevated hover:bg-edge text-fg hover:text-bright"}`;

  return (
    <>
      {/* data-spaces-strip: the bottom of this bar is the floor maximized rooms / floating windows
          never cross (measured by spacesBarBottom()). The spaces switcher lives in it now. */}
      <div data-spaces-strip className="h-14 flex items-center justify-between gap-4 px-4 border-b border-edge">
        <div className="flex-1 min-w-0 flex items-center gap-4">
          <div className="font-bold tracking-wide">Terminal Hub</div>
          <label title="Snap workspace cards to the grid"
            className="flex items-center gap-1.5 text-xs text-dim hover:text-fg cursor-pointer select-none">
            <input type="checkbox" checked={snapToGrid} onChange={e => setSnapToGrid(e.target.checked)}
              className="w-3.5 h-3.5 accent-blue-600 cursor-pointer" />
            Snap to grid
          </label>
          <button onClick={requestArrange} title="Arrange cards into a grid — also pulls any off-screen card back into view"
            className="flex items-center gap-1.5 text-xs text-dim hover:text-fg cursor-pointer select-none">
            <ArrangeIcon />
            Arrange
          </button>
        </div>
        {showSpacesBar && <SpacesMenu />}
        <div className="flex-1 min-w-0 flex justify-end items-center gap-2">
          <TimerCountdown />
          <div className="relative">
            <button ref={launcherBtnRef} onClick={() => launcherOpen ? launcherWin.current?.close() : setLauncherOpen(true)} title="Apps & tools"
              className={iconBtn(launcherOpen)}>
              <GridIcon />
            </button>
            {launcherOpen && (
              <AppLauncher ref={launcherWin}
                items={presenceRole === "key" ? launcherItems.filter(it => it.id !== "access") : launcherItems}
                anchorRef={launcherBtnRef} onClose={() => setLauncherOpen(false)} />
            )}
          </div>
          <NotificationCenter />
          <LinksMenu />
          <div className="relative">
            <button ref={widgetsBtnRef} onClick={() => widgetsOpen ? widgetsWin.current?.close() : setWidgetsOpen(true)} title="Widgets"
              className={iconBtn(widgetsOpen)}>
              <WidgetsIcon />
            </button>
            {widgetsOpen && (
              <WidgetMenu ref={widgetsWin} anchorRef={widgetsBtnRef} onClose={() => setWidgetsOpen(false)} />
            )}
          </div>
          <button onClick={(e) => helpOpen ? helpWin.current?.close() : openHelp(rectOf(e.currentTarget))} title="Help"
            className={iconBtn(helpOpen)}>
            <HelpIcon />
          </button>
          <button ref={gearBtnRef} onClick={(e) => settingsOpen ? settingsWin.current?.close() : openSettings(rectOf(e.currentTarget))} title="Settings"
            className={iconBtn(settingsOpen)}>
            <GearIcon />
          </button>
          <button onClick={onNewWorkspace} className="px-3 py-1.5 bg-blue-600 rounded text-sm">+ New workspace</button>
        </div>
      </div>
      {settingsOpen && <SettingsModal ref={settingsWin} origin={settingsOrigin} onClose={() => closePanel("settings")} />}
      {builderOpen && <PromptBuilderModal onClose={() => closePanel("prompt")} />}
      {browserOpen && <FileBrowserModal ref={browserWin} origin={browserOrigin} onClose={() => closePanel("files")} />}
      {notesOpen && <NotesModal ref={notesWin} origin={notesOrigin} onClose={() => closePanel("notes")} />}
      {boardOpen && <BoardModal ref={boardWin} origin={boardOrigin} onClose={() => closePanel("board")} />}
      {timesheetOpen && <TimeSheetModal ref={timesheetWin} origin={timesheetOrigin} onClose={() => closePanel("timesheet")} />}
      {helpOpen && <HelpModal ref={helpWin} origin={helpOrigin} onClose={() => closePanel("help")} />}
      {secretOpen && <SecretModal ref={secretWin} origin={secretOrigin} onClose={() => closePanel("secret")} />}
      {accessOpen && <AccessLinksModal ref={accessWin} origin={accessOrigin} onClose={() => closePanel("access")} />}
      {calendarOpen && <CalendarModal ref={calendarWin} origin={calendarOrigin} onClose={() => closePanel("calendar")} />}
      {timerOpen && <QuickTimerModal ref={timerWin} origin={timerOrigin} onClose={() => closePanel("timer")} />}
      {breaksOpen && <BreakModal ref={breaksWin} origin={breaksOrigin} onClose={() => closePanel("breaks")} />}
    </>
  );
}

/** Calendar grid with a header band — the Calendar launcher tile. */
function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="16" rx="2" />
      <path d="M3.5 9h17" />
      <path d="M8 3v3M16 3v3" />
      <path d="M7.5 13h2M11 13h2M14.5 13h2M7.5 16.5h2M11 16.5h2" />
    </svg>
  );
}

/** Stopwatch — the Quick Timer (a one-off "ping me in N minutes" notification). */
function TimerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 13.5V9.5" />
      <path d="M9.5 2.5h5" />
      <path d="M12 2.5v2.2" />
      <path d="M19.4 6.6l1.1-1.1" />
    </svg>
  );
}

/** Coffee cup — the Breaks / stand-up reminder tool. */
function CoffeeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Z" />
      <path d="M17 10h2a2.5 2.5 0 0 1 0 5h-2" />
      <path d="M8 2c-.5 1 .5 2 0 3M12 2c-.5 1 .5 2 0 3" />
    </svg>
  );
}

/** Dashboard panels — the Widgets menu button (sits beside the app launcher). */
function WidgetsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="5" rx="1.5" />
      <rect x="13" y="10" width="8" height="11" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
    </svg>
  );
}

/** 2×2 panes — the "Arrange cards into a grid" button. */
function ArrangeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

/** 3×3 dot grid — the app launcher / "all tools" button. */
function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="4" y="4" width="4" height="4" rx="1" /><rect x="10" y="4" width="4" height="4" rx="1" /><rect x="16" y="4" width="4" height="4" rx="1" />
      <rect x="4" y="10" width="4" height="4" rx="1" /><rect x="10" y="10" width="4" height="4" rx="1" /><rect x="16" y="10" width="4" height="4" rx="1" />
      <rect x="4" y="16" width="4" height="4" rx="1" /><rect x="10" y="16" width="4" height="4" rx="1" /><rect x="16" y="16" width="4" height="4" rx="1" />
    </svg>
  );
}

/** Question mark in a circle — the Help button (how agents message the dashboard). */
function HelpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" />
      <path d="M9.2 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.6 2.3-2.6 4" />
      <path d="M12 17.4h.01" />
    </svg>
  );
}

/** Folder — the file browser. */
function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h7A1.5 1.5 0 0 1 19 9v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 17z" />
    </svg>
  );
}

/** Lined page — the Notes scratchpad. */
function NoteIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="3" width="14" height="18" rx="1.6" />
      <path d="M8.5 8h7" />
      <path d="M8.5 12h7" />
      <path d="M8.5 16h4" />
    </svg>
  );
}

/** Stopwatch — the Timesheet time tracker. */
function TimesheetIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="13" r="8" />
      <path d="M12 13V9" />
      <path d="M9 2h6" />
      <path d="M19 6l1.5-1.5" />
    </svg>
  );
}

/** Three kanban columns with stacked cards — the task board. */
function BoardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18M15 3v18" />
      <path d="M5.5 7h1M11 7h1M16.5 7h1" />
      <path d="M5.5 10.5h1M11 10.5h1" />
    </svg>
  );
}

/** Chat bubble with a `>_` terminal prompt — the Prompt Builder. Reads as "a chat prompt". */
function PromptBubbleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: "translateY(3px)" }}>
      <path d="M4 1.5H20A2.5 2.5 0 0 1 22.5 4V14.5A2.5 2.5 0 0 1 20 17H14L12 21.5L10 17H4A2.5 2.5 0 0 1 1.5 14.5V4A2.5 2.5 0 0 1 4 1.5Z" />
      <path d="M7.8 5.9L11.1 8.8L7.8 11.7" />
      <path d="M12.8 11.7H16.1" />
    </svg>
  );
}

/** Two chain links — share a temporary access link with a teammate. */
function LinkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a4 4 0 0 0 5.66 0l3-3a4 4 0 1 0-5.66-5.66l-1.5 1.5" />
      <path d="M14 11a4 4 0 0 0-5.66 0l-3 3a4 4 0 1 0 5.66 5.66l1.5-1.5" />
    </svg>
  );
}

/** Flame — the one-time burnable secret link ("burn after reading"). */
function BurnIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2.5c.8 3-1.5 4.2-2.8 5.8C7.7 10 7 11.7 7 13.6a5 5 0 0 0 10 0c0-2-1-3.8-2.4-5.1.3 1.2-.2 2.3-1.1 2.6.6-2.2-.2-4.6-1.5-8.6Z" />
      <path d="M10 15.5a2 2 0 0 0 4 0c0-1-.7-1.8-1.4-2.5-.5.7-1.4 1-1.4 2 0 .2 0 .4.2.5Z" />
    </svg>
  );
}

/** Star — the Favorites (project switcher) toggle. Fills when the dock is open. */
function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2.6l2.9 5.88 6.49.94-4.7 4.58 1.11 6.46L12 17.9l-5.8 3.05 1.11-6.46-4.7-4.58 6.49-.94z" />
    </svg>
  );
}

/** Stacked cards — the Stage Manager dock toggle. The front card fills when the dock is open. */
function StageIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="6" width="10" height="12" rx="1.5" fill={active ? "currentColor" : "none"} />
      <path d="M16 8h3a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 19 16h-3" />
    </svg>
  );
}

/** Globe inside a browser window — the Localhost preview browser (local, not the open web). */
function LocalBrowserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 8h18" />
      <circle cx="12" cy="14" r="3.2" />
      <path d="M8.8 14h6.4M12 10.8a6 6 0 0 1 0 6.4a6 6 0 0 1 0-6.4Z" />
    </svg>
  );
}

/** Pulse/activity line — reads as a live process/CPU monitor (à la Activity Monitor). */
function ActivityIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

function CopilotTileIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2z" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
      <path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.05.05a2.1 2.1 0 1 1-2.97 2.97l-.05-.05a1.8 1.8 0 0 0-1.98-.36 1.8 1.8 0 0 0-1.09 1.65V21.4a2.1 2.1 0 1 1-4.2 0v-.08a1.8 1.8 0 0 0-1.17-1.68 1.8 1.8 0 0 0-1.98.36l-.05.05a2.1 2.1 0 1 1-2.97-2.97l.05-.05A1.8 1.8 0 0 0 3.6 15a1.8 1.8 0 0 0-1.65-1.09H1.8a2.1 2.1 0 1 1 0-4.2h.08A1.8 1.8 0 0 0 3.56 8.6a1.8 1.8 0 0 0-.36-1.98l-.05-.05A2.1 2.1 0 1 1 6.12 3.6l.05.05a1.8 1.8 0 0 0 1.98.36A1.8 1.8 0 0 0 9.24 2.4V2.2a2.1 2.1 0 1 1 4.2 0v.08a1.8 1.8 0 0 0 1.09 1.65 1.8 1.8 0 0 0 1.98-.36l.05-.05a2.1 2.1 0 1 1 2.97 2.97l-.05.05a1.8 1.8 0 0 0-.36 1.98 1.8 1.8 0 0 0 1.65 1.09h.12a2.1 2.1 0 1 1 0 4.2h-.08A1.8 1.8 0 0 0 19.4 15Z" />
    </svg>
  );
}
