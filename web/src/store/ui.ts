import { create } from "zustand";
import type { BetterCommentsConfig, BreakSettings } from "../api/types";
import { DEFAULT_BETTER_COMMENTS } from "../lib/betterComments";
import { DEFAULT_BREAK_SETTINGS } from "../lib/breaks";
import { DEFAULT_THEME_ID } from "../theme/themes";
import { DEFAULT_DICTATION_HOTKEY, asHotkey, type Hotkey } from "../lib/hotkey";
import { DEFAULT_TERM_FONT, TERM_FONT_WEIGHTS, TERM_SCROLLBACKS } from "../lib/terminalFonts";
import { type Camera, clampZoom, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX } from "../canvas/camera";

export type LeftTab = "explorer" | "filter" | "search";
/** VS Code-style activity-bar views the sidebar can show. */
export type SidebarView = "explorer" | "scm" | "github" | "claude" | "bookmarks" | "todos" | "skills";
/** Tabs inside the unified Source Control panel (the graph is now a tab here). */
export type ScmTab = "graph" | "branches" | "worktrees" | "stash" | "prs";
/** Where the workspace activity bar (view switcher) lives: the room's bottom strip (default), a
 *  vertical rail on the side panel's left or right edge, or a responsive bar across the top of the
 *  side panel. Anything but "bottom" pulls the view icons out of the BottomBar and into the panel. */
export type SidebarPosition = "bottom" | "left" | "right" | "top";
/** Where the dictation mic button sits in an open room: the window top bar (default) or the
 *  BottomBar strip. Personal display choice — persisted per-browser, not synced. */
export type MicPosition = "top" | "bottom";
/** How the dictation keyboard shortcut behaves: "toggle" = press to start, press again to stop;
 *  "hold" = record while the combo is held, transcribe on release (push-to-talk). Per-browser. */
export type DictationHotkeyMode = "toggle" | "hold";
/** Where dashboard toasts pop up — any anchor in a 3×3 grid. Top anchors slide down, bottom anchors
 *  rise up, the middle row pops in place (see web/src/components/Toaster.tsx). */
export type ToastPosition =
  | "top-left" | "top-center" | "top-right"
  | "center-left" | "center" | "center-right"
  | "bottom-left" | "bottom-center" | "bottom-right";
export interface OpenFile {
  path: string;            // unique tab key (diff tabs use a synthetic key, see openDiff)
  name: string;
  kind?: "file" | "diff" | "markdown-preview" | "csv-preview" | "docx-preview" | "image-preview" | "html-preview" | "pdf-preview" | "video-preview" | "audio-preview"; // undefined = file
  root?: string;           // repo root, for diff tabs
  sourcePath?: string;     // source file for synthetic preview tabs
  readOnly?: boolean;      // opened read-only (e.g. a go-to-def jump into a node_modules/library file)
  // A working-tree/staged/untracked file diff (file set), a whole-commit diff (commit set), or a
  // stash diff (stash set = the stash ref, e.g. "stash@{0}").
  diff?: { file?: string; staged?: boolean; untracked?: boolean; commit?: string; stash?: string };
}
/** Viewport rect of the card a room was opened from — drives the expand/collapse animation. */
export interface RoomOrigin { x: number; y: number; w: number; h: number }
/** Floating-window geometry (viewport px) when the room isn't maximized. */
export interface WinRect { x: number; y: number; w: number; h: number }

/** A room's live sidebar/panel chrome — the bits a mirror viewer follows when the host switches the
 *  activity-bar view, collapses a panel, or resizes one. (Window mode/geometry and the open editor tabs
 *  mirror through their own maps; this is everything else in the room's frame.) */
export interface RoomViewState {
  activeView: SidebarView;     // which activity-bar view the sidebar shows (the bottom-bar switcher)
  scmTab: ScmTab;              // active tab inside the Source Control panel
  leftOpen: boolean;           // sidebar shown vs collapsed
  rightOpen: boolean;          // terminal-list panel shown vs hidden
  sidebarWidth: number;        // sidebar width (px)
  terminalListWidth: number;   // terminal-list width (px)
  dockHeight: number;          // terminal dock height (px)
  dockFull: boolean;           // dock covering the whole centre column (editor hidden)
}

/** A selectable thing on the canvas. Selection is keyed `${kind}:${id}` so cards, sticky notes, and
 *  widgets share ONE set — marquee-select, group-drag, and bulk-delete treat all three uniformly. */
export type CanvasItemKind = "card" | "note" | "widget";
export const itemKey = (kind: CanvasItemKind, id: string) => `${kind}:${id}`;

/** Open state for the Space/Workspace setup wizard. `mode` "create" makes a new space; "edit"
 *  re-opens the wizard pre-filled for `spaceId`; "workspace" scopes it to a single workspace
 *  (`workspaceId`) — its own additive config. `origin` is the opener rect to grow from / minimize to. */
export interface SpaceWizardState {
  mode: "create" | "edit" | "workspace";
  spaceId: string | null;
  workspaceId?: string | null;
  origin: WinRect | null;
}

/** One open workspace room. Many can be open at once; each gets its own per-room store. */
export interface OpenRoom {
  workspaceId: string;
  origin: RoomOrigin | null;   // card rect the room animates from (and "Back to map" collapses to)
  z: number;                   // stacking order — higher renders on top
  closing: boolean;            // mid-collapse — the card cross-fades back in
  windowed: boolean;           // initial window mode (false = maximized/fullscreen)
  rect: WinRect | null;        // initial floating geometry (null => maximized)
  // One-shot grow origin for the NEXT mount only: set to the Stage Manager dock thumbnail rect when a
  // minimized room is restored from the dock, so it grows OUT of its thumbnail. Cleared once the grow
  // finishes, so a later "Back to map"/close still collapses to `origin` (the card), not the dock.
  growFrom?: RoomOrigin | null;
}

interface UiState {
  openRooms: OpenRoom[];                 // every workspace currently open as a room
  zTop: number;                          // last assigned z (monotonic)
  // Live "is this room fullscreen" per open workspace. OpenRoom.windowed is only the *initial*
  // mode (it seeds the per-room store and is never updated); the room's live window mode lives in
  // its own store. Each Room mirrors it here so the spaces bar can drop behind a fullscreen room.
  roomMaximized: Record<string, boolean>;
  // Presentation mirroring: a mirror viewer's *desired* fullscreen mode per open workspace, pushed from
  // the owner's view. Each Room watches its own entry and converges (toggles to match). Empty = not
  // mirroring (the owner isn't presenting to this browser), so a room keeps whatever mode it opened in.
  mirrorMaximized: Record<string, boolean>;
  // Presentation mirroring: a mirror viewer's *desired* active terminal per open workspace, pushed from
  // the owner's view. Each Room watches its own entry and selects that terminal (so picking a different
  // terminal on the host switches it on the viewer too). Empty = not mirroring this browser.
  mirrorActiveByWorkspace: Record<string, string>;
  // Each open Room publishes its live floating-window geometry here (parallel to roomMaximized) so the
  // owner can broadcast it to viewers. closeRoom prunes the entry. Only the floating rect matters — a
  // maximized room fills the screen regardless.
  roomRectByWorkspace: Record<string, WinRect>;
  // Presentation mirroring: a mirror viewer's *desired* floating geometry per open workspace, pushed from
  // the owner's view. Each Room watches its own entry and converges its windowRect (so moving/resizing the
  // window on the host moves it on the viewer too). Empty = not mirroring this browser.
  mirrorRectByWorkspace: Record<string, WinRect>;
  // Each open Room publishes its open editor tabs + active tab here so the owner can broadcast them (the
  // tabs/active file live in the per-room store, invisible to the app-level broadcaster otherwise).
  // closeRoom prunes the entry.
  roomEditorByWorkspace: Record<string, { openFiles: OpenFile[]; activeFile: string }>;
  // Presentation mirroring: a mirror viewer's *desired* open editor tabs + active tab per open workspace,
  // pushed from the owner's view. Each Room watches its own entry and converges (so opening/switching a
  // file on the host opens it on the viewer too). Empty = not mirroring this browser.
  mirrorEditorByWorkspace: Record<string, { openFiles: OpenFile[]; activeFile: string }>;
  // Each open Room publishes its live sidebar/panel chrome here so the owner can broadcast it (this state
  // lives in the per-room store). closeRoom prunes the entry.
  roomViewByWorkspace: Record<string, RoomViewState>;
  // Presentation mirroring: a mirror viewer's *desired* sidebar/panel chrome per open workspace, pushed
  // from the owner's view. Each Room watches its own entry and converges (so switching the activity-bar
  // view, collapsing a panel, or resizing one on the host follows here too). Empty = not mirroring.
  mirrorViewByWorkspace: Record<string, RoomViewState>;
  // Open TopBar panels/modals, keyed by a stable panel id (present = open, absent = closed). `rect` is
  // the panel's live floating geometry (reported by useDraggableWindow), null until first reported. This
  // is the single source of truth for which modals are open — so the owner's open panels are observable
  // and a mirror viewer can be driven to open the SAME panels at the SAME geometry. The Share (access)
  // panel is owner-only and never mirrored; see MIRRORED_PANELS in useMirror.
  panels: Record<string, { rect: WinRect | null }>;
  pendingTerminalFocus: Record<string, string>; // toast→room: terminal to select, keyed by workspace
  // Each open room reports its active terminal here. Combined with openRooms' z-order this tells us
  // which terminal the user is actually looking at (the focused room's active terminal) — used to
  // suppress/auto-dismiss "needs attention" toasts for a terminal you're already watching.
  activeTerminalByWorkspace: Record<string, string | null>;
  // The terminal whose xterm pane currently has DOM focus (the green :focus-within bar) in THIS
  // browser — at most one at a time. The real "am I in this terminal" signal: a finishing agent only
  // skips its notification when its own pane is focused here AND the tab is on-screen. null = none.
  focusedTerminalId: string | null;
  sidebarPosition: SidebarPosition;      // activity bar on the left edge or across the top
  theme: string;                         // active theme id (see web/src/theme) — applied to <html>

  // Editor/diff display preferences — global, so one toggle applies to every editor and diff
  // (regular files AND side-by-side diffs) and survives switching rooms.
  minimap: boolean;                      // show the code minimap
  wordWrap: boolean;                     // soft-wrap long lines
  lineNumbers: boolean;                  // show the line-number gutter
  diffSplit: boolean;                    // diff layout: true = side-by-side (split), false = inline (unified)
  autoSave: boolean;                     // save dirty editor buffers after a quiet period
  autoSaveDelaySeconds: number;          // debounce window for auto-save after edits
  betterComments: BetterCommentsConfig;  // comment-tag colorizing config (editor + diff)
  // Markdown reader comfort tint — scales the Markdown editor's letter and surface brightness so a
  // bright document is easier on the eyes. 100 = theme default (no change). Persisted per-browser
  // (localStorage), unlike the server-synced editor prefs above.
  mdTextLevel: number;                   // letter brightness, 40–100 (% of theme text color)
  mdBgLevel: number;                     // background brightness, 60–180 (% of theme surface colors)

  favoritesOpen: boolean;                // Favorites dock visible on the canvas home screen
  // Stage Manager — a macOS-style edge dock of live room previews. enabled/position are server-synced
  // (hydrated from settings); open/mode persist per-browser; stagedWorkspaceId is ephemeral.
  stageManagerEnabled: boolean;          // master on/off for the whole feature (hydrated from server)
  stageManagerPosition: SidebarPosition; // which edge the dock anchors to (hydrated from server)
  stageManagerScale: number;             // 0.5–1 multiplier shrinking every dock tile + gap (per-browser)
  stageOpen: boolean;                    // dock visible (persisted per-browser)
  stageMode: "all" | "spotlight";        // all rooms live (switcher) vs only the staged one on canvas (per-browser)
  stagedWorkspaceId: string | null;      // the single on-stage room in spotlight mode (ephemeral)
  showSpacesBar: boolean;                // spaces switcher (Home pill + dots) shown in the top bar (persisted per-browser)
  showSystemStats: boolean;              // CPU/RAM/network readout shown in the bottom stats bar (per-browser; off unmounts it so its 2s poll stops)
  showRoomTaskbar: boolean;              // open-rooms taskbar (the "active windows" pills) shown in the bottom stats bar (persisted per-browser)
  launcherPins: string[];                // launcher tool ids the user pinned to the top row (persisted per-browser)
  activeSpaceId: string;                 // which space's canvas is showing (persisted per-browser)
  spacesOverviewOpen: boolean;           // the Mission-Control switcher is expanded
  spaceWizard: SpaceWizardState | null;  // the Space Creation Wizard window (null = closed); lives above the canvas
  snapToGrid: boolean;                   // canvas cards snap to the grid on drop (persisted per-browser)
  // Per-space camera {x,y,zoom} — the single view transform for a space's canvas (cards + folders + notes +
  // widgets render at raw world coords; one layer is translated/scaled by this). Replaces the old global
  // canvasZoom + scroll + cardPanBySpace + roomPanBySpace hybrid. Each space remembers its own pan AND zoom;
  // persisted per-browser (tr.cameraBySpace). Missing entry = DEFAULT_CAMERA ({0,0,1}). Pan is unbounded
  // (Reset/Fit is the way back); zoom is clamped to [CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX].
  cameraBySpace: Record<string, Camera>;
  terminalFontSize: number;              // default xterm font size (px) for newly opened terminals (persisted per-browser)
  // Terminal color comfort — dims the terminal's foreground + ANSI palette, and lifts the near-black
  // background toward a lighter gray. 100 = theme default (no change). Persisted per-browser; applied
  // live to every open terminal via the xterm theme (see theme/applyTheme.ts adjustXtermTheme).
  terminalTextLevel: number;             // text + ANSI brightness, 40–100 (% of theme color; lower = dimmer)
  terminalBgLevel: number;               // background brightness, 100–180 (100 = theme black; higher = lighter)
  // Terminal typography + layout — per-browser, applied live to every open terminal (xterm options +
  // CSS vars, refit on geometry change). Defaults below MATCH today's hardcoded look exactly, so the
  // terminal is unchanged until the user touches Settings → Appearance → Terminal. See lib/terminalFonts.
  terminalFontFamily: string;            // full CSS font-family string (a TERM_FONT_OPTIONS value)
  terminalFontWeight: number;            // normal-text weight: 300–700 (400 = default)
  terminalLineHeight: number;            // row height multiplier, 1.0–1.8 (1.0 = xterm default, tight)
  terminalLetterSpacing: number;         // whole-pixel gap between glyphs, 0–4 (0 = default)
  terminalPadding: number;               // horizontal pane padding in px, 0–32 (12 = default; --tr-term-pad)
  terminalScrollback: number;            // xterm in-pane scrollback lines (1000 = default; tmux holds full history)
  terminalLigatures: boolean;            // fuse code ligatures (→ != =>) when the font supports them
  focusBarColor: string;                 // hex color of the focused-terminal bar (server-synced; CSS var --tr-focus-bar)
  voiceAlerts: boolean;                  // speak a short announcement (Web Speech API) when a terminal needs attention
  voiceName: string;                     // chosen system voice name for announcements; "" = browser default
  voiceRate: number;                     // speaking speed for announcements (1 = normal); persisted per-browser
  voiceVolume: number;                   // playback volume for spoken announcements (0–1, 1 = full); persisted per-browser
  toastPosition: ToastPosition;          // where toasts pop up (persisted per-browser)
  micPosition: MicPosition;              // where the room dictation mic sits — top bar or BottomBar (persisted per-browser)
  dictationHotkey: Hotkey;               // keyboard shortcut that drives the focused room's dictation (persisted per-browser)
  dictationHotkeyMode: DictationHotkeyMode; // shortcut behaves as press-to-toggle or push-to-talk hold (persisted per-browser)
  dictationSound: boolean;               // play a blip when dictation toggles on/off (persisted per-browser)
  speakAgentMessages: boolean;           // read agent-sent dashboard messages aloud (persisted per-browser)
  beepBeforeSpeak: boolean;              // play a chime before a spoken message (persisted per-browser)
  // Break / stand-up enforcer. `breaks` is the server-synced config (hydrated on boot, edited in
  // Settings). The rest is per-machine runtime the timer hook writes and the overlay reads — the
  // *cycle anchor* itself lives in localStorage (see useBreakTimer), NOT here, so a refresh survives.
  breaks: BreakSettings;                 // recurring break-enforcer config (hydrated from server)
  breakActive: boolean;                  // the full-screen break veil is up
  breakRemainingMs: number;              // ms left in the active break (overlay countdown)
  breakPrewarnMs: number | null;         // ms left in the pre-warn heads-up (null = not pre-warning)
  breakIsTest: boolean;                  // current break came from "Test now" (always skippable)
  breakSkipSeq: number;                  // bump → the timer ends the current break + reschedules
  breakSnoozeSeq: number;                // bump → the timer pushes the break out 5 min
  breakTestSeq: number;                  // bump → the timer fires a preview break now
  breakTestCfg: { durationMinutes: number; speak: boolean }; // args for the next Test-now break
  monitorOpen: boolean;                  // System Monitor window open (shared by TopBar + the stats bars)
  monitorOrigin: WinRect | null;         // opener icon rect — the monitor grows from / minimizes into it
  monitorCloseSeq: number;               // bumped to ask the open monitor to run its minimize-to-icon close
  // Copilot — the in-app AI assistant window. Store-signalled like the monitor because it's opened
  // from TWO places outside its App render site: the always-on canvas orb AND the TopBar launcher tile.
  copilotOpen: boolean;                  // Copilot window open
  copilotOrigin: WinRect | null;         // opener rect (orb or tile) — grow-from / minimize-into
  copilotCloseSeq: number;               // bump → the open Copilot window runs its minimize-to-icon close
  copilotOrbPos: OrbPos | null;          // free-dragged orb, stored as a gap from its nearest edges so it tracks resizes; null ⇒ settings corner preset (persisted per-browser)
  // Settings-open signal — Settings lives in TopBar, but other panels (e.g. the File Browser's Places
  // bar) need to open it to a specific tab. They bump this; TopBar opens Settings on that tab. `seq`
  // forces a re-open even when the same tab is requested twice.
  settingsRequest: { tab: string; seq: number } | null;
  // Terminal scrollback viewer — store-signalled like the monitor (it lives in App, opened from a
  // button on the terminal pane, which sits inside the transformed Room frame so it can't host a
  // position:fixed window itself). Holds which terminal's buffer to show + the opener button rect.
  scrollbackTerminalId: string | null;   // terminal whose tmux buffer the viewer shows (null = closed)
  scrollbackOrigin: WinRect | null;      // opener button rect — the viewer grows from / minimizes into it
  scrollbackCloseSeq: number;            // bump → the open viewer runs its minimize-to-icon close
  // Localhost preview browser — store-signalled like the monitor (a terminal Cmd/Ctrl-click can open
  // it without an icon press). `localhostPending` queues a tab to add; `seq` forces a re-read even when
  // the same port/path is clicked twice.
  localhostOpen: boolean;                // Localhost window open
  localhostOrigin: WinRect | null;       // opener icon rect — grow-from / minimize-into
  localhostCloseSeq: number;             // bump → the open window runs its minimize-to-icon close
  localhostPending: { port: number; path: string; seq: number } | null; // a tab to open (from a terminal link)
  // Right-click "New workspace" on the canvas → open the New-workspace modal and drop the card where
  // you clicked. App consumes this once (opens the modal, remembers the spot + space), then clears it.
  newWorkspaceRequest: { spaceId: string | null; x: number; y: number; seq: number } | null;
  arrangeSeq: number;                    // bump → the active space canvas re-flows its cards into a grid
  browseOpen: boolean;                   // filesystem Browse panel expanded inside the dock
  // Live color while dragging a color picker, keyed by entity id (workspace or terminal). The
  // card/room/tab read this so the tint tracks the slider in real time; key absent = no preview,
  // fall back to the persisted color. Committed (released) colors clear the entry + persist.
  previewColors: Record<string, string | null>;

  // Desktop-style multi-select on the canvas (cards + notes + widgets together). `selection` holds
  // the chosen items keyed `${kind}:${id}`; `groupDrag` is the live (dx,dy) screen delta while a
  // whole selection is being dragged at once (each selected item renders translated by it, then the
  // controller persists every item's new position on drop). Both are ephemeral — never persisted.
  selection: Set<string>;
  groupDrag: { dx: number; dy: number } | null;

  // "Show Desktop" — open rooms hidden from the canvas. They STAY in openRooms (tmux alive; the WS just
  // detaches on unmount, exactly like spotlight's off-canvas rooms), they're simply not mounted, so the
  // bare card canvas (the "desktop") shows through. Per-browser, persisted so a refresh keeps the desktop
  // cleared. Restored one-at-a-time from the Stage Manager dock / a taskbar pill, or all at once by
  // toggling the bottom-bar button again.
  hiddenRoomIds: Set<string>;

  openRoom(workspaceId: string, origin?: RoomOrigin | null): void;
  setRoomMaximized(workspaceId: string, maximized: boolean): void; // a room mirrors its live window mode here
  setMirrorMaximized(map: Record<string, boolean>): void; // mirror viewer: set the per-workspace desired fullscreen map
  setMirrorActiveTerminals(map: Record<string, string>): void; // mirror viewer: set the per-workspace desired active terminal
  reportRoomRect(workspaceId: string, rect: WinRect): void; // a room reports its live floating geometry (for mirroring)
  setMirrorRects(map: Record<string, WinRect>): void; // mirror viewer: set the per-workspace desired floating geometry
  reportRoomEditor(workspaceId: string, openFiles: OpenFile[], activeFile: string): void; // a room reports its open tabs + active tab (for mirroring)
  setMirrorEditors(map: Record<string, { openFiles: OpenFile[]; activeFile: string }>): void; // mirror viewer: set the per-workspace desired editor tabs
  reportRoomView(workspaceId: string, view: RoomViewState): void; // a room reports its live sidebar/panel chrome (for mirroring)
  setMirrorRoomViews(map: Record<string, RoomViewState>): void; // mirror viewer: set the per-workspace desired sidebar/panel chrome
  openPanel(id: string): void;                  // mark a TopBar panel open (origin/animation stay local in TopBar)
  closePanel(id: string): void;                 // mark a TopBar panel closed (after its minimize animation)
  setPanelRect(id: string, rect: WinRect): void; // a panel reports its live floating geometry (for mirroring)
  setMirrorPanels(map: Record<string, { rect: WinRect | null }>): void; // mirror viewer: replace open panels from the host's view
  focusRoom(workspaceId: string): void;  // bring a room to the front of the stack
  beginClose(workspaceId: string): void; // start the collapse animation (room unmounts when it ends)
  closeRoom(workspaceId: string): void;
  toggleShowDesktop(workspaceIds: string[]): void; // hide all the given (current-space) rooms — or restore them if any are already hidden
  hideRoom(workspaceId: string): void;             // minimize one room off the canvas (stays alive in openRooms; restore from the dock/taskbar)
  showRoom(workspaceId: string, growFrom?: RoomOrigin | null): void; // un-hide one room; pass the dock thumbnail rect so it grows out of its tile
  clearGrowFrom(workspaceId: string): void;        // drop a room's one-shot grow-from rect once its restore-grow has finished
  requestTerminalFocus(workspaceId: string, terminalId: string): void; // a toast asks a room to select a terminal
  clearTerminalFocus(workspaceId: string): void;
  reportActiveTerminal(workspaceId: string, terminalId: string | null): void; // a room reports its active terminal
  setFocusedTerminal(terminalId: string | null): void; // a pane reports it gained/lost xterm focus
  setSidebarPosition(pos: SidebarPosition): void;
  toggleSidebarPosition(): void;
  setTheme(id: string): void;
  setPreviewColor(id: string, color: string | null): void; // stream a live preview color for an entity
  clearPreviewColor(id: string): void;                     // drop the preview (on commit / picker close)
  setSelection(keys: string[]): void;    // replace the canvas selection (marquee / single click)
  toggleSelected(key: string): void;     // add/remove one item (shift/⌘-click)
  clearSelection(): void;                // empty the selection (click empty canvas / Escape / switch space)
  setGroupDrag(d: { dx: number; dy: number } | null): void; // live group-drag delta (null = not dragging)
  toggleFavorites(): void;
  toggleStage(): void;                    // show/hide the Stage Manager dock (persists per-browser)
  closeStage(): void;                     // force the dock closed
  setStageMode(m: "all" | "spotlight"): void;   // switch switcher vs spotlight (persists per-browser)
  setStagedRoom(id: string | null, origin?: RoomOrigin | null): void; // stage a room; pass the tile rect as origin so the room grows out of its thumbnail
  setStageManagerPosition(p: SidebarPosition): void; // move the dock edge (caller also persists to server)
  setStageManagerScale(scale: number): void; // shrink/grow the whole dock live (clamped 0.5–1, persists per-browser)
  setShowSpacesBar(on: boolean): void;   // show/hide the spaces bar (persists to localStorage)
  setShowSystemStats(on: boolean): void; // show/hide the bottom stats readout (persists to localStorage; off unmounts it, stopping its poll)
  setShowRoomTaskbar(on: boolean): void; // show/hide the bottom open-rooms taskbar (persists to localStorage)
  toggleLauncherPin(id: string): void;   // pin/unpin a launcher tool (persists to localStorage)
  setActiveSpace(id: string): void;      // switch space (persists to localStorage, closes the overview)
  toggleSpacesOverview(): void;
  setSpacesOverviewOpen(open: boolean): void;
  openSpaceWizard(s: SpaceWizardState): void; // open the wizard (create or edit a space)
  closeSpaceWizard(): void;
  setSnapToGrid(on: boolean): void;      // toggle canvas grid snapping (persists to localStorage)
  setCameraForSpace(spaceId: string, cam: Camera): void; // set a space's pan+zoom camera (persists per-browser, coalesced)
  setTerminalFontSize(px: number): void; // set the default terminal font size in px (persists to localStorage)
  setTerminalTextLevel(level: number): void; // dim terminal text + ANSI colors (persists per-browser, live)
  setTerminalBgLevel(level: number): void;   // lift terminal background brightness (persists per-browser, live)
  setTerminalFontFamily(value: string): void;    // pick the terminal font stack (persists per-browser, live)
  setTerminalFontWeight(weight: number): void;   // set normal-text weight 300–700 (persists per-browser, live)
  setTerminalLineHeight(mult: number): void;     // set row height 1.0–1.8 (persists per-browser, live + refit)
  setTerminalLetterSpacing(px: number): void;    // set glyph spacing 0–4px (persists per-browser, live + refit)
  setTerminalPadding(px: number): void;          // set pane padding 0–32px (persists per-browser, live + refit)
  setTerminalScrollback(lines: number): void;    // set in-pane scrollback (persists per-browser, live)
  setTerminalLigatures(on: boolean): void;       // toggle code ligatures (persists per-browser, live)
  setFocusBarColor(hex: string): void;       // set focused-terminal bar color live (CSS var; caller persists to server)
  setVoiceAlerts(on: boolean): void;     // toggle spoken attention announcements (persists to localStorage)
  setVoiceName(name: string): void;      // pick the system voice for announcements (persists to localStorage)
  setVoiceRate(rate: number): void;      // set announcement speaking speed (persists to localStorage)
  setVoiceVolume(vol: number): void;     // set announcement playback volume 0–1 (persists to localStorage)
  setToastPosition(pos: ToastPosition): void;   // pick where toasts appear (persists to localStorage)
  setMicPosition(pos: MicPosition): void;       // pick where the room mic button sits (persists to localStorage)
  setDictationHotkey(hk: Hotkey): void;         // rebind the dictation shortcut (persists to localStorage)
  setDictationHotkeyMode(mode: DictationHotkeyMode): void; // press-to-toggle vs push-to-talk hold (persists to localStorage)
  setDictationSound(on: boolean): void;         // toggle the dictation start/stop blip (persists to localStorage)
  setSpeakAgentMessages(on: boolean): void;     // toggle reading agent messages aloud (persists to localStorage)
  setBeepBeforeSpeak(on: boolean): void;        // toggle the pre-speech chime (persists to localStorage)
  closeFavorites(): void;                // force the dock closed (e.g. when a room goes fullscreen)
  setBreaks(b: BreakSettings): void;     // apply break config (Settings save / server hydrate)
  setBreakRuntime(rt: { breakActive: boolean; breakRemainingMs: number; breakPrewarnMs: number | null; breakIsTest: boolean }): void; // timer → overlay
  skipBreak(): void;                     // overlay's "skip / keep working" button
  snoozeBreak(): void;                   // overlay's "snooze 5 min" button
  testBreak(cfg: { durationMinutes: number; speak: boolean }): void; // Settings "Test now" preview
  setMonitorOpen(open: boolean, origin?: WinRect | null): void; // open/close; origin = opener icon rect
  requestMonitorClose(): void;           // ask the open monitor to animate minimize-to-icon, then unmount
  setCopilotOpen(open: boolean, origin?: WinRect | null): void; // open/close the Copilot window; origin = opener (orb/tile) rect
  requestCopilotClose(): void;           // ask the open Copilot window to animate minimize-to-icon, then unmount
  setCopilotOrbPos(pos: OrbPos | null): void; // free-place the orb (edge-anchored); null resets to the corner preset (persists per-browser)
  openSettingsTab(tab: string): void;    // ask TopBar to open Settings on a specific tab (e.g. from PlacesBar)
  clearSettingsRequest(): void;          // TopBar consumed the request (opened Settings)
  openScrollback(terminalId: string, origin?: WinRect | null): void; // open the buffer viewer for a terminal
  requestScrollbackClose(): void;        // ask the open viewer to animate minimize-to-icon, then unmount
  closeScrollback(): void;               // the viewer finished its close animation → unmount
  openLocalhost(origin?: WinRect | null): void;            // open/focus the Localhost window (icon press)
  requestLocalhostClose(): void;                           // ask it to animate minimize-to-icon, then unmount
  openLocalhostPort(port: number, path?: string, origin?: WinRect | null): void; // open + queue a tab (terminal link)
  clearLocalhostPending(): void;                           // the window drained the queued tab
  requestNewWorkspace(at: { spaceId: string | null; x: number; y: number }): void; // canvas right-click → new card at (x,y)
  clearNewWorkspaceRequest(): void;                        // App consumed the request (opened the modal)
  requestArrange(): void;                                  // TopBar "Arrange" → active space canvas packs cards into a grid
  toggleBrowse(): void;
  toggleMinimap(): void;
  toggleWordWrap(): void;
  toggleLineNumbers(): void;
  setDiffSplit(split: boolean): void;
  setMdTextLevel(level: number): void;   // set Markdown letter brightness (persists per-browser)
  setMdBgLevel(level: number): void;     // set Markdown background brightness (persists per-browser)
  setSettings(patch: Partial<Pick<UiState,
    "sidebarPosition" | "theme" | "minimap" | "wordWrap" | "lineNumbers" | "diffSplit" | "autoSave" | "autoSaveDelaySeconds" | "betterComments" | "breaks" | "focusBarColor" | "stageManagerEnabled" | "stageManagerPosition"
  >>): void;
}

const SNAP_KEY = "tr.snapToGrid";
const STAGE_OPEN_KEY = "tr.stageOpen";
const STAGE_MODE_KEY = "tr.stageMode";
// stageManagerEnabled/Position are server-synced (same across browsers), but we ALSO cache the
// last-known values per-browser so the dock paints at the right edge on the very first frame after a
// refresh — without this the store starts at the "left"/on defaults, the dock flashes there, then
// snaps to the server value once getSettings resolves. getSettings still reconciles on load.
const STAGE_POS_KEY = "tr.stageManagerPosition";
const STAGE_ENABLED_KEY = "tr.stageManagerEnabled";
function readStageOpen(): boolean { try { return localStorage.getItem(STAGE_OPEN_KEY) === "1"; } catch { return false; } }
function readStageMode(): "all" | "spotlight" { try { return localStorage.getItem(STAGE_MODE_KEY) === "spotlight" ? "spotlight" : "all"; } catch { return "all"; } }
function readStagePos(): SidebarPosition { try { const v = localStorage.getItem(STAGE_POS_KEY); return v === "right" || v === "top" || v === "bottom" || v === "left" ? v : "left"; } catch { return "left"; } }
function readStageEnabled(): boolean { try { const v = localStorage.getItem(STAGE_ENABLED_KEY); return v === null ? true : v === "1"; } catch { return true; } }
const STAGE_SCALE_KEY = "tr.stageManagerScale";
const clampStageScale = (n: number) => Math.min(1, Math.max(0.5, Math.round(n * 100) / 100));
function readStageScale(): number { try { const n = Number(localStorage.getItem(STAGE_SCALE_KEY)); return n >= 0.5 && n <= 1 ? clampStageScale(n) : 1; } catch { return 1; } }
const TERM_FONT_KEY = "tr.terminalFontSize";
const TERM_TEXT_LEVEL_KEY = "tr.terminalTextLevel";
const TERM_BG_LEVEL_KEY = "tr.terminalBgLevel";
const TERM_FONT_FAMILY_KEY = "tr.terminalFontFamily";
const TERM_FONT_WEIGHT_KEY = "tr.terminalFontWeight";
const TERM_LINE_HEIGHT_KEY = "tr.terminalLineHeight";
const TERM_LETTER_SPACING_KEY = "tr.terminalLetterSpacing";
const TERM_PADDING_KEY = "tr.terminalPadding";
const TERM_SCROLLBACK_KEY = "tr.terminalScrollback";
const TERM_LIGATURES_KEY = "tr.terminalLigatures";
const VOICE_KEY = "tr.voiceAlerts";
const VOICE_NAME_KEY = "tr.voiceName";
const VOICE_RATE_KEY = "tr.voiceRate";
const VOICE_VOLUME_KEY = "tr.voiceVolume";
const TOAST_POS_KEY = "tr.toastPosition";
const MIC_POS_KEY = "tr.micPosition";
const DICTATION_HOTKEY_KEY = "tr.dictationHotkey";
const DICTATION_HOTKEY_MODE_KEY = "tr.dictationHotkeyMode";
const DICTATION_SOUND_KEY = "tr.dictationSound";
const SPEAK_AGENT_KEY = "tr.speakAgentMessages";
const BEEP_KEY = "tr.beepBeforeSpeak";
const ACTIVE_SPACE_KEY = "tr.activeSpace";
const SHOW_SPACES_BAR_KEY = "tr.showSpacesBar";
const SHOW_SYSTEM_STATS_KEY = "tr.showSystemStats";
const SHOW_ROOM_TASKBAR_KEY = "tr.showRoomTaskbar";
const LAUNCHER_PINS_KEY = "tr.launcherPins";
const MD_TEXT_LEVEL_KEY = "tr.mdTextLevel";
const MD_BG_LEVEL_KEY = "tr.mdBgLevel";
const OPEN_ROOMS_KEY = "tr.openRooms";
const HIDDEN_ROOMS_KEY = "tr.hiddenRooms";
function loadSnap(): boolean {
  try { return localStorage.getItem(SNAP_KEY) === "1"; } catch { return false; }
}
// Canvas zoom bounds — 25%…200%. Re-exported from canvas/camera so the controls + gesture handlers and
// the camera math clamp through one definition (no divergent copies).
export const CANVAS_ZOOM_MIN = CAMERA_ZOOM_MIN;
export const CANVAS_ZOOM_MAX = CAMERA_ZOOM_MAX;
// Per-space cameras persist as one JSON map under tr.cameraBySpace. Hydrated on boot (validated +
// zoom-clamped); writes are coalesced to ≤1 per 200ms so a pan drag never thrashes localStorage.
const CAMERA_KEY = "tr.cameraBySpace";
function loadCameras(): Record<string, Camera> {
  try {
    const raw = localStorage.getItem(CAMERA_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return {};
    const out: Record<string, Camera> = {};
    for (const [k, v] of Object.entries(obj as Record<string, any>)) {
      if (v && typeof v.x === "number" && typeof v.y === "number" && typeof v.zoom === "number"
          && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.zoom)) {
        out[k] = { x: v.x, y: v.y, zoom: clampZoom(v.zoom) };
      }
    }
    return out;
  } catch { return {}; }
}
let camSaveTimer: ReturnType<typeof setTimeout> | null = null;
let camSavePending: Record<string, Camera> | null = null;
function saveCameras(map: Record<string, Camera>): void {
  camSavePending = map;
  if (camSaveTimer) return;
  camSaveTimer = setTimeout(() => {
    camSaveTimer = null;
    try { localStorage.setItem(CAMERA_KEY, JSON.stringify(camSavePending)); } catch { /* private mode */ }
  }, 200);
}
// The free-dragged Copilot orb is stored as a GAP from whichever horizontal/vertical edge it's nearest
// to (not an absolute top-left), so it tracks window resizes: a right-anchored orb keeps its distance
// from the right edge (follows it as the window grows/shrinks), while a left/top-anchored one stays put.
export const ORB_SIZE = 48;   // w-12 h-12
export const ORB_MARGIN = 8;  // min gap kept from every viewport edge when clamping
export type OrbPos = { ax: "left" | "right"; dx: number; ay: "top" | "bottom"; dy: number };

/** Absolute top-left for an anchored orb at the given viewport size (caller clamps for display). */
export function orbToAbsolute(p: OrbPos, vw: number, vh: number): { x: number; y: number } {
  return {
    x: p.ax === "left" ? p.dx : vw - ORB_SIZE - p.dx,
    y: p.ay === "top" ? p.dy : vh - ORB_SIZE - p.dy,
  };
}
/** Anchor an absolute top-left to its nearest edges (right half → right-anchored, bottom half → bottom). */
export function orbAnchor(left: number, top: number, vw: number, vh: number): OrbPos {
  const ax = left + ORB_SIZE / 2 > vw / 2 ? "right" : "left";
  const ay = top + ORB_SIZE / 2 > vh / 2 ? "bottom" : "top";
  return {
    ax, dx: Math.max(0, ax === "left" ? left : vw - (left + ORB_SIZE)),
    ay, dy: Math.max(0, ay === "top" ? top : vh - (top + ORB_SIZE)),
  };
}

const COPILOT_ORB_POS_KEY = "tr.copilotOrbPos";
function loadCopilotOrbPos(): OrbPos | null {
  try {
    const raw = localStorage.getItem(COPILOT_ORB_POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if ((p?.ax === "left" || p?.ax === "right") && (p?.ay === "top" || p?.ay === "bottom") &&
        typeof p?.dx === "number" && typeof p?.dy === "number") return { ax: p.ax, dx: p.dx, ay: p.ay, dy: p.dy };
    // Migrate the previous absolute {x,y} shape: anchor it using the current viewport so it stays put.
    if (typeof p?.x === "number" && typeof p?.y === "number") return orbAnchor(p.x, p.y, window.innerWidth, window.innerHeight);
    return null;
  } catch { return null; }
}
function loadShowSpacesBar(): boolean {
  try { return localStorage.getItem(SHOW_SPACES_BAR_KEY) !== "0"; } catch { return true; } // default ON
}
function loadShowSystemStats(): boolean {
  try { return localStorage.getItem(SHOW_SYSTEM_STATS_KEY) !== "0"; } catch { return true; } // default ON
}
function loadShowRoomTaskbar(): boolean {
  try { return localStorage.getItem(SHOW_ROOM_TASKBAR_KEY) !== "0"; } catch { return true; } // default ON
}
function loadLauncherPins(): string[] {
  try {
    const raw = localStorage.getItem(LAUNCHER_PINS_KEY);
    const a = raw ? JSON.parse(raw) : [];
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}
function loadActiveSpace(): string {
  try { return localStorage.getItem(ACTIVE_SPACE_KEY) ?? ""; } catch { return ""; }
}
function loadVoiceAlerts(): boolean {
  try { return localStorage.getItem(VOICE_KEY) === "1"; } catch { return false; }
}
function loadVoiceName(): string {
  try { return localStorage.getItem(VOICE_NAME_KEY) ?? ""; } catch { return ""; }
}
function loadVoiceRate(): number {
  try { const r = Number(localStorage.getItem(VOICE_RATE_KEY)); return r >= 0.5 && r <= 2 ? r : 1; } catch { return 1; }
}
function loadVoiceVolume(): number {
  try { const raw = localStorage.getItem(VOICE_VOLUME_KEY); if (raw === null) return 1; const v = Number(raw); return v >= 0 && v <= 1 ? v : 1; } catch { return 1; }
}
// Default terminal font size (px). Bounds + default mirror FONT_* in components/TerminalView — keep in sync.
function loadTerminalFontSize(): number {
  try { const n = Number(localStorage.getItem(TERM_FONT_KEY)); return n >= 8 && n <= 32 ? Math.round(n) : 13; } catch { return 13; }
}
// Markdown comfort-tint levels (percent). Out-of-range / unset reads as 100 = theme default.
function loadMdLevel(key: string, min: number, max: number): number {
  try { const n = Number(localStorage.getItem(key)); return n >= min && n <= max ? Math.round(n) : 100; } catch { return 100; }
}
// Terminal typography/layout hydration. Each falls back to the value that reproduces today's default
// look, so a fresh browser (or a bad/cleared value) renders exactly as before. Keep bounds in sync
// with the matching setters below and the Settings → Appearance → Terminal controls.
function loadTermFontFamily(): string {
  try { return localStorage.getItem(TERM_FONT_FAMILY_KEY) || DEFAULT_TERM_FONT; } catch { return DEFAULT_TERM_FONT; }
}
function loadTermFontWeight(): number {
  try { const n = Number(localStorage.getItem(TERM_FONT_WEIGHT_KEY)); return (TERM_FONT_WEIGHTS as readonly number[]).includes(n) ? n : 400; } catch { return 400; }
}
function loadTermLineHeight(): number {
  try { const n = Number(localStorage.getItem(TERM_LINE_HEIGHT_KEY)); return n >= 1 && n <= 1.8 ? Math.round(n * 100) / 100 : 1; } catch { return 1; }
}
function loadTermLetterSpacing(): number {
  try { const n = Number(localStorage.getItem(TERM_LETTER_SPACING_KEY)); return n >= 0 && n <= 4 ? Math.round(n) : 0; } catch { return 0; }
}
function loadTermPadding(): number {
  try { const n = Number(localStorage.getItem(TERM_PADDING_KEY)); return n >= 0 && n <= 32 ? Math.round(n) : 12; } catch { return 12; }
}
function loadTermScrollback(): number {
  try { const n = Number(localStorage.getItem(TERM_SCROLLBACK_KEY)); return (TERM_SCROLLBACKS as readonly number[]).includes(n) ? n : 1000; } catch { return 1000; }
}
function loadTermLigatures(): boolean {
  try { return localStorage.getItem(TERM_LIGATURES_KEY) === "1"; } catch { return false; }
}
/** The slim, per-machine open-room set saved to localStorage so a refresh reopens the same rooms.
 *  Only workspaceId + z-order + initial window mode/geometry — the room's panel sizes, editor tabs,
 *  and exact window placement rehydrate from the DB-backed room layout (see store/room.ts). Rooms
 *  mid-close (closing) are excluded so a refresh during the collapse doesn't resurrect them. */
function serializeOpenRooms(rooms: OpenRoom[]): string {
  return JSON.stringify(
    rooms.filter((r) => !r.closing).map((r) => ({ workspaceId: r.workspaceId, z: r.z, windowed: r.windowed, rect: r.rect })),
  );
}
function loadOpenRooms(): OpenRoom[] {
  try {
    const raw = localStorage.getItem(OPEN_ROOMS_KEY);
    const a = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(a)) return [];
    return a
      .filter((r) => r && typeof r.workspaceId === "string")
      .map((r) => ({
        workspaceId: r.workspaceId as string,
        origin: null,                              // no card to grow from on a cold load — fade in instead
        z: typeof r.z === "number" ? r.z : 0,
        closing: false,
        windowed: r.windowed !== false,            // default to a floating window
        rect: (r.rect ?? null) as WinRect | null,  // seeds createRoomStore; the DB layout wins once moved
      }));
  } catch { return []; }
}
/** The "Show Desktop" hidden-room set, per-browser. Stored as a plain id array; stale ids (a room
 *  closed since) are harmless — the render filter ignores ids that aren't open. */
function loadHiddenRooms(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_ROOMS_KEY);
    const a = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : []);
  } catch { return new Set<string>(); }
}
const TOAST_POSITIONS: ToastPosition[] = [
  "top-left", "top-center", "top-right",
  "center-left", "center", "center-right",
  "bottom-left", "bottom-center", "bottom-right",
];
function loadToastPosition(): ToastPosition {
  try {
    const p = localStorage.getItem(TOAST_POS_KEY);
    if (p === "bottom") return "bottom-center"; // migrate the old 3-way value to its grid anchor
    return (TOAST_POSITIONS as string[]).includes(p ?? "") ? (p as ToastPosition) : "top-right";
  } catch { return "top-right"; }
}
function loadMicPosition(): MicPosition {
  try { return localStorage.getItem(MIC_POS_KEY) === "bottom" ? "bottom" : "top"; } catch { return "top"; }
}
function loadDictationHotkey(): Hotkey {
  try {
    const raw = localStorage.getItem(DICTATION_HOTKEY_KEY);
    return (raw && asHotkey(JSON.parse(raw))) || DEFAULT_DICTATION_HOTKEY;
  } catch { return DEFAULT_DICTATION_HOTKEY; }
}
function loadDictationHotkeyMode(): DictationHotkeyMode {
  try { return localStorage.getItem(DICTATION_HOTKEY_MODE_KEY) === "hold" ? "hold" : "toggle"; } catch { return "toggle"; }
}
function loadDictationSound(): boolean {
  try { return localStorage.getItem(DICTATION_SOUND_KEY) !== "0"; } catch { return true; } // default ON
}
// Default ON: an agent only messages when it needs you, and you won't see a silent toast — so speak
// it (with a chime) unless you opt out. Stored as "0"/"1"; absent (null) reads as the default.
function loadAgentSpeak(key: string): boolean {
  try { return localStorage.getItem(key) !== "0"; } catch { return true; }
}

/** Viewport-Y of the bottom of the Terminal Hub top bar (tagged data-spaces-strip — it carries the spaces
 *  switcher), or 0 when absent. The maximized-room top, the floating-window placement, and the
 *  window-drag floor all sit below this so nothing slides up under the bar. Measured live — no
 *  hardcoded bar height. */
export function spacesBarBottom(): number {
  if (typeof document === "undefined") return 0;
  const el = document.querySelector("[data-spaces-strip]");
  return el ? el.getBoundingClientRect().bottom : 0;
}

/** An element's viewport rect as a WinRect — capture an opener icon so a window can grow from it. */
export function rectOf(el: Element): WinRect {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/** The standard floating-window size — ~80% of the viewport, capped. One source so the centered
 *  default box and the card-anchored open box always match in size. */
function defaultWindowSize(): { w: number; h: number } {
  const vw = window.innerWidth, vh = window.innerHeight;
  return { w: Math.min(1100, Math.round(vw * 0.8)), h: Math.min(760, Math.round(vh * 0.82)) };
}

/** A ~80% floating-window box for a room with no saved geometry. Centered in the viewport, with its
 *  top clamped below the spaces bar (measured) so a freshly opened/restored window never lands
 *  clipped under it — if the viewport is too short to center below the bar, it opens just under it
 *  instead. `offset` cascades each additional same-session window down-right so stacked rooms stay
 *  visible. */
export function defaultWindowRect(offset = 0): WinRect {
  const vw = window.innerWidth, vh = window.innerHeight;
  const { w, h } = defaultWindowSize();
  const top = spacesBarBottom() + 8; // below the top bar + the same 8px gap the edges use
  const cx = Math.round((vw - w) / 2) + offset;
  const cy = Math.round((vh - h) / 2) + offset;
  return {
    w, h,
    x: Math.max(8, Math.min(vw - w - 8, cx)),
    y: Math.max(top, Math.min(vh - h - 8, cy)),
  };
}

/** A first-open floating-window box anchored at the card you opened from: top-left pinned to the
 *  card's corner at the standard window size, clamped so the window stays on-screen and below the
 *  spaces bar. The room grows out of the card into this box, settling at the same corner. */
function cardAnchoredRect(origin: { x: number; y: number }): WinRect {
  const vw = window.innerWidth, vh = window.innerHeight;
  const { w, h } = defaultWindowSize();
  const top = spacesBarBottom() + 8;
  return {
    w, h,
    x: Math.max(8, Math.min(vw - w - 8, origin.x)),
    y: Math.max(top, Math.min(vh - h - 8, origin.y)),
  };
}

// Restore the open rooms (per-machine) so a browser refresh reopens what you had open. Layout and
// positions come from the DB; this only remembers which rooms are open on THIS machine + their z-order.
const restoredOpenRooms = loadOpenRooms();

export const useUi = create<UiState>((set) => ({
  openRooms: restoredOpenRooms,
  zTop: restoredOpenRooms.reduce((m, r) => Math.max(m, r.z), 0),
  roomMaximized: {},
  cameraBySpace: loadCameras(),
  mirrorMaximized: {},
  mirrorActiveByWorkspace: {},
  roomRectByWorkspace: {},
  mirrorRectByWorkspace: {},
  roomEditorByWorkspace: {},
  mirrorEditorByWorkspace: {},
  roomViewByWorkspace: {},
  mirrorViewByWorkspace: {},
  panels: {},
  pendingTerminalFocus: {},
  activeTerminalByWorkspace: {},
  focusedTerminalId: null,
  sidebarPosition: "bottom",             // user preference — persists across rooms; hydrated from server
  theme: DEFAULT_THEME_ID,               // applied to <html> on boot; hydrated from server settings
  minimap: true,                         // on by default — most useful on the big files it's meant for
  wordWrap: false,                       // off by default; opt-in for those who want it
  lineNumbers: true,                     // on by default — standard for a code editor
  diffSplit: true,                       // side-by-side by default (the layout this feature adds)
  autoSave: false,
  autoSaveDelaySeconds: 2,
  betterComments: DEFAULT_BETTER_COMMENTS,
  mdTextLevel: loadMdLevel(MD_TEXT_LEVEL_KEY, 40, 100), // 100 = theme default; hydrated from this browser
  mdBgLevel: loadMdLevel(MD_BG_LEVEL_KEY, 60, 180),     // 100 = theme default; hydrated from this browser
  favoritesOpen: false,                  // hidden by default — slide it out from the TopBar star
  stageManagerEnabled: readStageEnabled(),   // last-known (cached) so it paints right on refresh; server reconciles
  stageManagerPosition: readStagePos(),      // last-known (cached) so the dock paints at the right edge instantly
  stageManagerScale: readStageScale(),       // per-browser dock size (1 = full); shrinks tiles + gaps uniformly
  stageOpen: readStageOpen(),            // per-browser — hidden by default
  stageMode: readStageMode(),            // per-browser — all-open switcher by default
  stagedWorkspaceId: null,               // nothing staged until spotlight is entered
  showSpacesBar: loadShowSpacesBar(),    // on by default — the virtual canvases switcher at the top
  showSystemStats: loadShowSystemStats(),// on by default — the bottom CPU/RAM/network readout
  showRoomTaskbar: loadShowRoomTaskbar(),// on by default — the bottom open-rooms ("active windows") taskbar
  launcherPins: loadLauncherPins(),      // hydrate the pinned launcher tools from this browser
  activeSpaceId: loadActiveSpace(),      // hydrate the last-viewed space; "" falls back to the first space
  spacesOverviewOpen: false,             // switcher collapsed by default
  spaceWizard: null,                     // wizard closed by default
  snapToGrid: loadSnap(),                // hydrate the grid-snap preference from this browser
  terminalFontSize: loadTerminalFontSize(), // default terminal font size, hydrated from this browser
  terminalTextLevel: loadMdLevel(TERM_TEXT_LEVEL_KEY, 40, 100),  // 100 = theme default; hydrated from this browser
  terminalBgLevel: loadMdLevel(TERM_BG_LEVEL_KEY, 100, 180),     // 100 = theme black; higher lifts it lighter
  terminalFontFamily: loadTermFontFamily(),   // Meslo Nerd Font stack by default; hydrated from this browser
  terminalFontWeight: loadTermFontWeight(),   // 400 = normal; hydrated from this browser
  terminalLineHeight: loadTermLineHeight(),   // 1.0 = xterm default; hydrated from this browser
  terminalLetterSpacing: loadTermLetterSpacing(), // 0 = default; hydrated from this browser
  terminalPadding: loadTermPadding(),         // 12px = default --tr-term-pad; hydrated from this browser
  terminalScrollback: loadTermScrollback(),   // 1000 = xterm default; hydrated from this browser
  terminalLigatures: loadTermLigatures(),     // off by default; hydrated from this browser
  focusBarColor: "#22c55e",              // default Terminal Hub green; hydrated from server settings on boot
  voiceAlerts: loadVoiceAlerts(),        // off by default — opt-in; voice is intrusive
  voiceName: loadVoiceName(),            // empty = browser/system default voice
  voiceRate: loadVoiceRate(),            // 1 = normal speed; hydrated from this browser
  voiceVolume: loadVoiceVolume(),        // 1 = full volume; hydrated from this browser
  toastPosition: loadToastPosition(),    // top-right by default — slides down from the top-right corner
  micPosition: loadMicPosition(),        // top bar by default; hydrated from this browser
  dictationHotkey: loadDictationHotkey(),// unbound by default (avoid the hard-refresh clash); set per-browser
  dictationHotkeyMode: loadDictationHotkeyMode(), // press-to-toggle by default
  dictationSound: loadDictationSound(),  // blip on toggle, on by default
  speakAgentMessages: loadAgentSpeak(SPEAK_AGENT_KEY), // on by default
  beepBeforeSpeak: loadAgentSpeak(BEEP_KEY),           // on by default
  breaks: DEFAULT_BREAK_SETTINGS,        // hydrated from server settings on boot; edited in Settings
  breakActive: false,                    // no break veil until the timer fires one
  breakRemainingMs: 0,
  breakPrewarnMs: null,
  breakIsTest: false,
  breakSkipSeq: 0,
  breakSnoozeSeq: 0,
  breakTestSeq: 0,
  breakTestCfg: { durationMinutes: DEFAULT_BREAK_SETTINGS.durationMinutes, speak: DEFAULT_BREAK_SETTINGS.speak },
  monitorOpen: false,                    // System Monitor window closed until opened from a stats bar / TopBar
  monitorOrigin: null,                   // opener icon rect, captured when the monitor is opened
  monitorCloseSeq: 0,                    // nonce; bumping it triggers the open monitor's animated close
  copilotOpen: false,                    // Copilot window closed until opened from the orb / launcher tile
  copilotOrigin: null,                   // opener rect, captured when the Copilot window is opened
  copilotCloseSeq: 0,                    // nonce; bumping it triggers the open Copilot window's animated close
  copilotOrbPos: loadCopilotOrbPos(),    // hydrate any free-dragged orb position from this browser
  settingsRequest: null,                 // no pending Settings-open request until a panel asks for one
  scrollbackTerminalId: null,            // buffer viewer closed until a terminal's "view buffer" button opens it
  scrollbackOrigin: null,                // opener button rect, captured when the viewer is opened
  scrollbackCloseSeq: 0,                 // nonce; bumping it triggers the open viewer's animated close
  localhostOpen: false,                  // Localhost preview window closed until opened
  localhostOrigin: null,                 // opener icon rect, captured when opened from the launcher
  localhostCloseSeq: 0,                  // nonce; bump triggers the open window's animated close
  localhostPending: null,                // no queued tab until a terminal link asks for one
  newWorkspaceRequest: null,             // no pending canvas "New workspace" request until a right-click
  arrangeSeq: 0,                         // nonce; bumping it asks the active space canvas to grid-pack its cards
  browseOpen: false,                     // collapsed by default — reveal the file browser when needed
  previewColors: {},                     // no live previews until a picker drag starts
  selection: new Set<string>(),          // nothing selected on the canvas until a click/marquee
  groupDrag: null,                       // no group drag in flight
  hiddenRoomIds: loadHiddenRooms(),      // hydrate the "Show Desktop" hidden set from this browser

  openRoom: (workspaceId, origin = null) => set((s) => {
    const z = s.zTop + 1;
    // Opening (or re-focusing) a room always un-hides it: a card's Open, a toast/notification deep-link,
    // or a taskbar pill must bring a Show-Desktop-hidden room back, never leave it invisible. Reuse the
    // existing set ref when nothing changed so the hiddenRoomIds selector doesn't re-render needlessly.
    const nextHidden = new Set(s.hiddenRoomIds);
    nextHidden.delete(workspaceId);
    const hiddenRoomIds = nextHidden.size === s.hiddenRoomIds.size ? s.hiddenRoomIds : nextHidden;
    // Already open: just bring it to the front (don't reset its layout/geometry).
    if (s.openRooms.some(r => r.workspaceId === workspaceId)) {
      return {
        zTop: z,
        openRooms: s.openRooms.map(r => r.workspaceId === workspaceId ? { ...r, z, closing: false } : r),
        hiddenRoomIds,
      };
    }
    // First-open default: a floating window with its top-left pinned to the card you opened from, so
    // the room grows out of the card and settles at that corner (fluid — no jump to center/fullscreen).
    // This is only the DEFAULT: createRoomStore restores the room's own saved geometry + mode instead
    // once you've moved, resized, or maximized it. No origin (e.g. a toast opening the room) falls back
    // to a centered/cascaded box. A floating room never hides the bars, so roomMaximized stays false.
    const rect = origin ? cardAnchoredRect(origin) : defaultWindowRect((s.openRooms.length % 6) * 36);
    return {
      zTop: z,
      openRooms: [...s.openRooms, { workspaceId, origin, z, closing: false, windowed: true, rect }],
      roomMaximized: { ...s.roomMaximized, [workspaceId]: false },
      hiddenRoomIds,
    };
  }),
  setRoomMaximized: (workspaceId, maximized) => set((s) => (
    s.roomMaximized[workspaceId] === maximized ? s : { roomMaximized: { ...s.roomMaximized, [workspaceId]: maximized } }
  )),
  setCameraForSpace: (spaceId, cam) => set((s) => {
    const cur = s.cameraBySpace[spaceId];
    if (cur && cur.x === cam.x && cur.y === cam.y && cur.zoom === cam.zoom) return s;
    const next = { ...s.cameraBySpace, [spaceId]: cam };
    saveCameras(next);
    return { cameraBySpace: next };
  }),
  setMirrorMaximized: (mirrorMaximized) => set({ mirrorMaximized }),
  setMirrorActiveTerminals: (mirrorActiveByWorkspace) => set({ mirrorActiveByWorkspace }),
  reportRoomRect: (workspaceId, rect) => set((s) => {
    const cur = s.roomRectByWorkspace[workspaceId];
    if (cur && cur.x === rect.x && cur.y === rect.y && cur.w === rect.w && cur.h === rect.h) return s;
    return { roomRectByWorkspace: { ...s.roomRectByWorkspace, [workspaceId]: rect } };
  }),
  setMirrorRects: (mirrorRectByWorkspace) => set({ mirrorRectByWorkspace }),
  reportRoomEditor: (workspaceId, openFiles, activeFile) => set((s) => {
    const cur = s.roomEditorByWorkspace[workspaceId];
    if (cur && cur.activeFile === activeFile && JSON.stringify(cur.openFiles) === JSON.stringify(openFiles)) return s;
    return { roomEditorByWorkspace: { ...s.roomEditorByWorkspace, [workspaceId]: { openFiles, activeFile } } };
  }),
  setMirrorEditors: (mirrorEditorByWorkspace) => set({ mirrorEditorByWorkspace }),
  reportRoomView: (workspaceId, view) => set((s) => {
    const c = s.roomViewByWorkspace[workspaceId];
    if (c && c.activeView === view.activeView && c.scmTab === view.scmTab && c.leftOpen === view.leftOpen
      && c.rightOpen === view.rightOpen && c.sidebarWidth === view.sidebarWidth
      && c.terminalListWidth === view.terminalListWidth && c.dockHeight === view.dockHeight
      && c.dockFull === view.dockFull) return s;
    return { roomViewByWorkspace: { ...s.roomViewByWorkspace, [workspaceId]: view } };
  }),
  setMirrorRoomViews: (mirrorViewByWorkspace) => set({ mirrorViewByWorkspace }),
  // No-op if already open (keeps its live rect). A fresh open starts with rect null; useDraggableWindow
  // reports the modal's first geometry (restored from the modal's own localStorage seed) right after mount.
  openPanel: (id) => set((s) => (s.panels[id] ? s : { panels: { ...s.panels, [id]: { rect: null } } })),
  closePanel: (id) => set((s) => {
    if (!(id in s.panels)) return s;
    const next = { ...s.panels };
    delete next[id];
    return { panels: next };
  }),
  setPanelRect: (id, rect) => set((s) => {
    const cur = s.panels[id]?.rect;
    if (cur && cur.x === rect.x && cur.y === rect.y && cur.w === rect.w && cur.h === rect.h) return s;
    return { panels: { ...s.panels, [id]: { rect } } };
  }),
  setMirrorPanels: (panels) => set({ panels }),
  focusRoom: (workspaceId) => set((s) => {
    if (s.openRooms.length === 0) return s;
    const top = s.openRooms.reduce((m, r) => Math.max(m, r.z), 0);
    const cur = s.openRooms.find(r => r.workspaceId === workspaceId);
    if (cur && cur.z === top) return s;                 // already on top — no churn
    const z = s.zTop + 1;
    return { zTop: z, openRooms: s.openRooms.map(r => r.workspaceId === workspaceId ? { ...r, z } : r) };
  }),
  beginClose: (workspaceId) => set((s) => ({
    openRooms: s.openRooms.map(r => r.workspaceId === workspaceId ? { ...r, closing: true } : r),
  })),
  closeRoom: (workspaceId) => set((s) => {
    const active = { ...s.activeTerminalByWorkspace };
    delete active[workspaceId];
    const maximized = { ...s.roomMaximized };
    delete maximized[workspaceId];
    const rects = { ...s.roomRectByWorkspace };
    delete rects[workspaceId];
    const editors = { ...s.roomEditorByWorkspace };
    delete editors[workspaceId];
    const views = { ...s.roomViewByWorkspace };
    delete views[workspaceId];
    const nextHidden = new Set(s.hiddenRoomIds);
    nextHidden.delete(workspaceId);
    const hiddenRoomIds = nextHidden.size === s.hiddenRoomIds.size ? s.hiddenRoomIds : nextHidden;
    return { openRooms: s.openRooms.filter(r => r.workspaceId !== workspaceId), activeTerminalByWorkspace: active, roomMaximized: maximized, roomRectByWorkspace: rects, roomEditorByWorkspace: editors, roomViewByWorkspace: views, hiddenRoomIds };
  }),
  // "Show Desktop" toggle. Receives the open rooms ON THE CURRENT SPACE (the caller scopes it, like the
  // taskbar/dock do). If ANY of them are hidden, restore them all ("show it again"); otherwise hide them
  // all to reveal the card canvas. The dock/taskbar bring rooms back one at a time via showRoom.
  toggleShowDesktop: (workspaceIds) => set((s) => {
    if (workspaceIds.length === 0) return s;
    const anyHidden = workspaceIds.some(id => s.hiddenRoomIds.has(id));
    const hiddenRoomIds = new Set(s.hiddenRoomIds);
    if (anyHidden) workspaceIds.forEach(id => hiddenRoomIds.delete(id)); // restore all
    else workspaceIds.forEach(id => hiddenRoomIds.add(id));              // hide all → reveal the desktop
    return { hiddenRoomIds };
  }),
  // Minimize: hide one room off the canvas (it stays in openRooms — tmux alive, just unmounted, same as
  // Show Desktop). Restorable from its Stage Manager dock thumbnail or its taskbar pill.
  hideRoom: (workspaceId) => set((s) => {
    if (s.hiddenRoomIds.has(workspaceId)) return s;
    const hiddenRoomIds = new Set(s.hiddenRoomIds);
    hiddenRoomIds.add(workspaceId);
    return { hiddenRoomIds };
  }),
  showRoom: (workspaceId, growFrom) => set((s) => {
    if (!s.hiddenRoomIds.has(workspaceId)) return s;
    const hiddenRoomIds = new Set(s.hiddenRoomIds);
    hiddenRoomIds.delete(workspaceId);
    // When restored from a dock tile, stamp the tile rect so the remounting room grows out of it.
    const openRooms = growFrom !== undefined
      ? s.openRooms.map(r => r.workspaceId === workspaceId ? { ...r, growFrom } : r)
      : s.openRooms;
    return { hiddenRoomIds, openRooms };
  }),
  clearGrowFrom: (workspaceId) => set((s) => {
    if (!s.openRooms.some(r => r.workspaceId === workspaceId && r.growFrom)) return s;
    return { openRooms: s.openRooms.map(r => r.workspaceId === workspaceId ? { ...r, growFrom: null } : r) };
  }),
  requestTerminalFocus: (workspaceId, terminalId) => set((s) => ({
    pendingTerminalFocus: { ...s.pendingTerminalFocus, [workspaceId]: terminalId },
  })),
  clearTerminalFocus: (workspaceId) => set((s) => {
    if (!(workspaceId in s.pendingTerminalFocus)) return s;
    const next = { ...s.pendingTerminalFocus };
    delete next[workspaceId];
    return { pendingTerminalFocus: next };
  }),
  reportActiveTerminal: (workspaceId, terminalId) => set((s) => {
    if (s.activeTerminalByWorkspace[workspaceId] === terminalId) return s;
    return { activeTerminalByWorkspace: { ...s.activeTerminalByWorkspace, [workspaceId]: terminalId } };
  }),
  setFocusedTerminal: (terminalId) => set((s) => (s.focusedTerminalId === terminalId ? s : { focusedTerminalId: terminalId })),
  setSidebarPosition: (sidebarPosition) => set({ sidebarPosition }),
  toggleSidebarPosition: () => set((s) => {
    const order: SidebarPosition[] = ["bottom", "left", "right", "top"];
    return { sidebarPosition: order[(order.indexOf(s.sidebarPosition) + 1) % order.length] };
  }),
  setTheme: (theme) => set({ theme }),
  setPreviewColor: (id, color) => set((s) => ({ previewColors: { ...s.previewColors, [id]: color } })),
  clearPreviewColor: (id) => set((s) => {
    if (!(id in s.previewColors)) return s;
    const next = { ...s.previewColors };
    delete next[id];
    return { previewColors: next };
  }),
  setSelection: (keys) => set({ selection: new Set(keys) }),
  toggleSelected: (key) => set((s) => {
    const next = new Set(s.selection);
    if (next.has(key)) next.delete(key); else next.add(key);
    return { selection: next };
  }),
  clearSelection: () => set((s) => (s.selection.size ? { selection: new Set<string>() } : s)),
  setGroupDrag: (groupDrag) => set({ groupDrag }),
  toggleFavorites: () => set((s) => ({ favoritesOpen: !s.favoritesOpen })),
  toggleStage: () => set((s) => ({ stageOpen: !s.stageOpen })),
  closeStage: () => set({ stageOpen: false }),
  setStageMode: (stageMode) => set({ stageMode }),
  // Stage a room (spotlight). With an `origin` (the clicked tile's viewport rect), also retarget that
  // room's grow-from rect so it expands out of — and later collapses back into — its thumbnail, the
  // macOS-Stage-Manager swap. `undefined` origin leaves the room's existing origin untouched.
  setStagedRoom: (stagedWorkspaceId, origin) => set((s) => (
    origin === undefined
      ? { stagedWorkspaceId }
      : { stagedWorkspaceId, openRooms: s.openRooms.map(r => r.workspaceId === stagedWorkspaceId ? { ...r, origin } : r) }
  )),
  setStageManagerPosition: (stageManagerPosition) => { try { localStorage.setItem(STAGE_POS_KEY, stageManagerPosition); } catch {} ; set({ stageManagerPosition }); },
  setStageManagerScale: (scale) => { const stageManagerScale = clampStageScale(scale); try { localStorage.setItem(STAGE_SCALE_KEY, String(stageManagerScale)); } catch {} ; set({ stageManagerScale }); },
  setShowSpacesBar: (on) => { try { localStorage.setItem(SHOW_SPACES_BAR_KEY, on ? "1" : "0"); } catch { /* private mode */ } set({ showSpacesBar: on }); },
  setShowSystemStats: (on) => { try { localStorage.setItem(SHOW_SYSTEM_STATS_KEY, on ? "1" : "0"); } catch { /* private mode */ } set({ showSystemStats: on }); },
  setShowRoomTaskbar: (on) => { try { localStorage.setItem(SHOW_ROOM_TASKBAR_KEY, on ? "1" : "0"); } catch { /* private mode */ } set({ showRoomTaskbar: on }); },
  toggleLauncherPin: (id) => set((s) => {
    const next = s.launcherPins.includes(id) ? s.launcherPins.filter((p) => p !== id) : [...s.launcherPins, id];
    try { localStorage.setItem(LAUNCHER_PINS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
    return { launcherPins: next };
  }),
  setActiveSpace: (id) => { try { localStorage.setItem(ACTIVE_SPACE_KEY, id); } catch { /* private mode */ } set({ activeSpaceId: id, spacesOverviewOpen: false }); },
  toggleSpacesOverview: () => set((s) => ({ spacesOverviewOpen: !s.spacesOverviewOpen })),
  setSpacesOverviewOpen: (open) => set({ spacesOverviewOpen: open }),
  // Opening the wizard also collapses the Mission-Control dropdown so the window isn't fighting it.
  openSpaceWizard: (spaceWizard) => set({ spaceWizard, spacesOverviewOpen: false }),
  closeSpaceWizard: () => set({ spaceWizard: null }),
  setSnapToGrid: (on) => { try { localStorage.setItem(SNAP_KEY, on ? "1" : "0"); } catch { /* private mode */ } set({ snapToGrid: on }); },
  setTerminalFontSize: (px) => { const v = Math.min(32, Math.max(8, Math.round(px))); try { localStorage.setItem(TERM_FONT_KEY, String(v)); } catch { /* private mode */ } set({ terminalFontSize: v }); },
  setTerminalTextLevel: (level) => { const v = Math.min(100, Math.max(40, Math.round(level))); try { localStorage.setItem(TERM_TEXT_LEVEL_KEY, String(v)); } catch { /* private mode */ } set({ terminalTextLevel: v }); },
  setTerminalBgLevel: (level) => { const v = Math.min(180, Math.max(100, Math.round(level))); try { localStorage.setItem(TERM_BG_LEVEL_KEY, String(v)); } catch { /* private mode */ } set({ terminalBgLevel: v }); },
  setTerminalFontFamily: (value) => { const v = value || DEFAULT_TERM_FONT; try { localStorage.setItem(TERM_FONT_FAMILY_KEY, v); } catch { /* private mode */ } set({ terminalFontFamily: v }); },
  setTerminalFontWeight: (weight) => { const v = (TERM_FONT_WEIGHTS as readonly number[]).includes(weight) ? weight : 400; try { localStorage.setItem(TERM_FONT_WEIGHT_KEY, String(v)); } catch { /* private mode */ } set({ terminalFontWeight: v }); },
  setTerminalLineHeight: (mult) => { const v = Math.round(Math.min(1.8, Math.max(1, mult)) * 100) / 100; try { localStorage.setItem(TERM_LINE_HEIGHT_KEY, String(v)); } catch { /* private mode */ } set({ terminalLineHeight: v }); },
  setTerminalLetterSpacing: (px) => { const v = Math.min(4, Math.max(0, Math.round(px))); try { localStorage.setItem(TERM_LETTER_SPACING_KEY, String(v)); } catch { /* private mode */ } set({ terminalLetterSpacing: v }); },
  setTerminalPadding: (px) => { const v = Math.min(32, Math.max(0, Math.round(px))); try { localStorage.setItem(TERM_PADDING_KEY, String(v)); } catch { /* private mode */ } set({ terminalPadding: v }); },
  setTerminalScrollback: (lines) => { const v = (TERM_SCROLLBACKS as readonly number[]).includes(lines) ? lines : 1000; try { localStorage.setItem(TERM_SCROLLBACK_KEY, String(v)); } catch { /* private mode */ } set({ terminalScrollback: v }); },
  setTerminalLigatures: (on) => { try { localStorage.setItem(TERM_LIGATURES_KEY, on ? "1" : "0"); } catch { /* private mode */ } set({ terminalLigatures: on }); },
  setFocusBarColor: (hex) => set({ focusBarColor: hex }),
  setVoiceAlerts: (on) => { try { localStorage.setItem(VOICE_KEY, on ? "1" : "0"); } catch { /* private mode */ } set({ voiceAlerts: on }); },
  setVoiceName: (name) => { try { localStorage.setItem(VOICE_NAME_KEY, name); } catch { /* private mode */ } set({ voiceName: name }); },
  setVoiceRate: (rate) => { const r = Math.min(2, Math.max(0.5, rate)); try { localStorage.setItem(VOICE_RATE_KEY, String(r)); } catch { /* private mode */ } set({ voiceRate: r }); },
  setVoiceVolume: (vol) => { const v = Math.min(1, Math.max(0, vol)); try { localStorage.setItem(VOICE_VOLUME_KEY, String(v)); } catch { /* private mode */ } set({ voiceVolume: v }); },
  setToastPosition: (pos) => { try { localStorage.setItem(TOAST_POS_KEY, pos); } catch { /* private mode */ } set({ toastPosition: pos }); },
  setMicPosition: (pos) => { try { localStorage.setItem(MIC_POS_KEY, pos); } catch { /* private mode */ } set({ micPosition: pos }); },
  setDictationHotkey: (hk) => { try { localStorage.setItem(DICTATION_HOTKEY_KEY, JSON.stringify(hk)); } catch { /* private mode */ } set({ dictationHotkey: hk }); },
  setDictationHotkeyMode: (mode) => { try { localStorage.setItem(DICTATION_HOTKEY_MODE_KEY, mode); } catch { /* private mode */ } set({ dictationHotkeyMode: mode }); },
  setDictationSound: (on) => { try { localStorage.setItem(DICTATION_SOUND_KEY, on ? "1" : "0"); } catch { /* private mode */ } set({ dictationSound: on }); },
  setSpeakAgentMessages: (on) => { try { localStorage.setItem(SPEAK_AGENT_KEY, on ? "1" : "0"); } catch { /* private mode */ } set({ speakAgentMessages: on }); },
  setBeepBeforeSpeak: (on) => { try { localStorage.setItem(BEEP_KEY, on ? "1" : "0"); } catch { /* private mode */ } set({ beepBeforeSpeak: on }); },
  closeFavorites: () => set({ favoritesOpen: false }),
  setBreaks: (breaks) => set({ breaks }),
  setBreakRuntime: (rt) => set(rt),
  skipBreak: () => set((s) => ({ breakSkipSeq: s.breakSkipSeq + 1 })),
  snoozeBreak: () => set((s) => ({ breakSnoozeSeq: s.breakSnoozeSeq + 1 })),
  testBreak: (cfg) => set((s) => ({ breakTestCfg: cfg, breakTestSeq: s.breakTestSeq + 1 })),
  setMonitorOpen: (monitorOpen, origin) =>
    // Record the opener rect only when opening; keep it on close so the window can fly back into it.
    set(monitorOpen ? { monitorOpen, monitorOrigin: origin ?? null } : { monitorOpen }),
  requestMonitorClose: () => set((s) => ({ monitorCloseSeq: s.monitorCloseSeq + 1 })),
  setCopilotOpen: (copilotOpen, origin) =>
    // Capture the opener rect on open; on close keep the last origin so the minimize animation
    // still flies back into the orb/tile it grew from.
    set(copilotOpen ? { copilotOpen, copilotOrigin: origin ?? null } : { copilotOpen }),
  requestCopilotClose: () => set((s) => ({ copilotCloseSeq: s.copilotCloseSeq + 1 })),
  setCopilotOrbPos: (pos) => {
    try {
      if (pos) localStorage.setItem(COPILOT_ORB_POS_KEY, JSON.stringify(pos));
      else localStorage.removeItem(COPILOT_ORB_POS_KEY);
    } catch { /* private mode */ }
    set({ copilotOrbPos: pos });
  },
  openSettingsTab: (tab) => set((s) => ({ settingsRequest: { tab, seq: (s.settingsRequest?.seq ?? 0) + 1 } })),
  clearSettingsRequest: () => set({ settingsRequest: null }),
  openScrollback: (terminalId, origin = null) => set({ scrollbackTerminalId: terminalId, scrollbackOrigin: origin }),
  requestScrollbackClose: () => set((s) => ({ scrollbackCloseSeq: s.scrollbackCloseSeq + 1 })),
  closeScrollback: () => set({ scrollbackTerminalId: null }),
  openLocalhost: (origin = null) => set({ localhostOpen: true, localhostOrigin: origin }),
  requestLocalhostClose: () => set((s) => ({ localhostCloseSeq: s.localhostCloseSeq + 1 })),
  openLocalhostPort: (port, path = "/", origin = null) => set((s) => ({
    localhostOpen: true,
    // Keep the existing grow-from origin if the window is already up; only a fresh open sets it.
    localhostOrigin: s.localhostOpen ? s.localhostOrigin : origin,
    localhostPending: { port, path, seq: (s.localhostPending?.seq ?? 0) + 1 },
  })),
  clearLocalhostPending: () => set({ localhostPending: null }),
  requestNewWorkspace: (at) => set((s) => ({ newWorkspaceRequest: { ...at, seq: (s.newWorkspaceRequest?.seq ?? 0) + 1 } })),
  clearNewWorkspaceRequest: () => set({ newWorkspaceRequest: null }),
  requestArrange: () => set((s) => ({ arrangeSeq: s.arrangeSeq + 1 })),
  toggleBrowse: () => set((s) => ({ browseOpen: !s.browseOpen })),
  toggleMinimap: () => set((s) => ({ minimap: !s.minimap })),
  toggleWordWrap: () => set((s) => ({ wordWrap: !s.wordWrap })),
  toggleLineNumbers: () => set((s) => ({ lineNumbers: !s.lineNumbers })),
  setDiffSplit: (diffSplit) => set({ diffSplit }),
  setMdTextLevel: (level) => { const v = Math.min(100, Math.max(40, Math.round(level))); try { localStorage.setItem(MD_TEXT_LEVEL_KEY, String(v)); } catch { /* private mode */ } set({ mdTextLevel: v }); },
  setMdBgLevel: (level) => { const v = Math.min(180, Math.max(60, Math.round(level))); try { localStorage.setItem(MD_BG_LEVEL_KEY, String(v)); } catch { /* private mode */ } set({ mdBgLevel: v }); },
  setSettings: (patch) => {
    // Cache the server-synced Stage Manager values per-browser too, so the next refresh paints the
    // dock at the right edge/visibility on frame one (init reads these) instead of flashing the default.
    try {
      if (patch.stageManagerPosition !== undefined) localStorage.setItem(STAGE_POS_KEY, patch.stageManagerPosition);
      if (patch.stageManagerEnabled !== undefined) localStorage.setItem(STAGE_ENABLED_KEY, patch.stageManagerEnabled ? "1" : "0");
    } catch {}
    set(patch);
  },
}));

// Persist the open-room set + z-order to localStorage on every change so a refresh restores it. Layout
// and positions live in the DB; this is only which rooms are open on THIS machine. Guarded so identical
// states don't rewrite, and closing rooms are dropped (see serializeOpenRooms).
let lastOpenRoomsSer = serializeOpenRooms(useUi.getState().openRooms);
useUi.subscribe((s) => {
  const ser = serializeOpenRooms(s.openRooms);
  if (ser === lastOpenRoomsSer) return;
  lastOpenRoomsSer = ser;
  try { localStorage.setItem(OPEN_ROOMS_KEY, ser); } catch { /* private mode / quota — ignore */ }
});

// Persist the Stage Manager dock's open flag + mode per-browser (which rooms are open already persist
// above; this is just the dock's own UI state). Guarded so identical states don't rewrite.
let lastStageSer = `${useUi.getState().stageOpen}|${useUi.getState().stageMode}`;
useUi.subscribe((s) => {
  const ser = `${s.stageOpen}|${s.stageMode}`;
  if (ser === lastStageSer) return;
  lastStageSer = ser;
  try { localStorage.setItem(STAGE_OPEN_KEY, s.stageOpen ? "1" : "0"); localStorage.setItem(STAGE_MODE_KEY, s.stageMode); } catch { /* private mode / quota — ignore */ }
});

// Persist the "Show Desktop" hidden-room set per-browser so a refresh keeps the desktop cleared (the
// rooms themselves persist above; this is just which of them are hidden). Guarded against no-op rewrites.
let lastHiddenSer = JSON.stringify([...useUi.getState().hiddenRoomIds].sort());
useUi.subscribe((s) => {
  const ser = JSON.stringify([...s.hiddenRoomIds].sort());
  if (ser === lastHiddenSer) return;
  lastHiddenSer = ser;
  try { localStorage.setItem(HIDDEN_ROOMS_KEY, ser); } catch { /* private mode / quota — ignore */ }
});
