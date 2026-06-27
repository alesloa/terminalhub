import type { NotifyLevel, NotifyCategory } from "./notify/bus.js";
import type { SpaceConfig } from "./spaces/types.js";

export type { SpaceConfig, SpacePreset, SpaceCatalog, SkillCard, CommandCard, McpCard } from "./spaces/types.js";

export interface Workspace {
  id: string;
  name: string;
  folder: string;
  launchCommand: string; // "" = plain shell
  color: string | null;      // room/editor chrome accent (Peacock)
  cardColor: string | null;  // canvas card accent, set + shaded independently of `color`
  layout: string | null;     // opaque JSON: per-workspace room layout (panel sizes/open/view); null = defaults
  spaceId: string | null;    // owning space (workspaces.spaceId); set on every row after the boot migration
  folderId: string | null;   // owning canvas folder (folders.id); null = loose on the canvas (the common case)
  config: SpaceConfig | null; // per-workspace wizard picks; seeds ADDITIVELY over the space config; null = none
  x: number;
  y: number;
  createdAt: number;
  updatedAt: number;
}

// The canvas/virtual-spaces backdrop config — one shape reused for the global default (settings key
// `canvasBackground`) and per-space overrides (spaces.background). `kind` selects which fields apply:
// solid uses `color` (null = theme default canvas color), wallpaper uses `wallpaper` (a wallpaper id:
// a built-in slug, `gradient:<id>`, or `upload:<id>`). `dim` (0-100) is the black scrim opacity —
// applied in solid mode only when `overlay` is on, and always (as the lone overlay slider) in
// wallpaper mode. Mirrored by hand in web/src/api/types.ts.
export interface CanvasBackground {
  kind: "solid" | "wallpaper";
  color: string | null;     // solid: hex, or null for the theme's default canvas color
  wallpaper: string | null; // wallpaper: id of the chosen wallpaper, or null when none picked yet
  overlay: boolean;         // solid: draw the dim scrim over the color
  dim: number;              // 0-100 scrim opacity
}

// The Stage Manager dock's frosted-glass background (the macOS-Dock-style panel behind the room
// thumbnails). Stored as an opaque JSON blob under the `stageDock` settings key (the
// getCanvasBackground/getBreaks idiom), NOT a flat Settings column. `color` null = track the theme's
// elevated surface so the panel follows theme changes; an explicit hex pins it. `opacity` is the fill
// translucency (the "frost"), `blur` the backdrop blur in px. Mirrored by hand in web/src/api/types.ts.
export interface StageDock {
  enabled: boolean;         // draw the frosted panel behind the dock (off = the old no-panel floating tiles)
  color: string | null;     // panel tint hex (#rgb/#rrggbb), or null to track the theme's elevated surface
  opacity: number;          // 0-100 fill opacity — 0 = fully transparent (no background)
  blur: number;             // 0-40 px backdrop blur
  borderColor: string | null; // border tint hex, or null to track the theme's strong edge color
  borderOpacity: number;    // 0-100 border opacity — 0 = fully transparent (no border)
}

// A space = a virtual desktop: its own canvas of workspace cards. `position` orders them in the
// switcher (contiguous 0..n-1). Mirrored by hand in web/src/api/types.ts.
export interface Space {
  id: string;
  name: string;
  icon: string | null;   // codicon name, null = default glyph
  color: string | null;  // accent/tint, null = default --tr-accent
  background: CanvasBackground | null; // per-space backdrop override; null = inherit the global default
  config: SpaceConfig | null; // Space Creation Wizard selections; null = seed nothing (Home/legacy spaces)
  position: number;
  createdAt: number;
  updatedAt: number;
}

// A canvas folder: an iPhone-style group of workspace cards on one space's canvas. The folder holds
// the group's name + canvas position (x/y); its member cards carry workspaces.folderId and leave the
// canvas to live inside it. `spaceId` scopes the folder to one space (null = Home), exactly like a
// workspace card. Mirrored by hand in web/src/api/types.ts.
export interface Folder {
  id: string;
  spaceId: string | null;
  name: string;
  x: number;
  y: number;
  createdAt: number;
  updatedAt: number;
}

// An uploaded "bring your own" wallpaper. The image bytes ride along as a data URL stored in the DB
// (same approach as custom-agent icons) so it serves back authed and works as a CSS background even
// over a tunnel. `listWallpapers` omits `dataUrl` to keep the roster light. Mirrored in web types.
export interface Wallpaper {
  id: string;
  name: string;
  createdAt: number;
}
export interface WallpaperData extends Wallpaper {
  dataUrl: string; // "data:image/jpeg;base64,…"
}

export interface Terminal {
  id: string;
  workspaceId: string;
  title: string;
  color: string | null;
  icon: string | null; // codicon name shown left of the title, or null for the default terminal glyph
  tmuxSession: string;
  launchCommandOverride: string | null;
  position: number; // order within the workspace's terminal list (contiguous 0..n-1)
  createdAt: number;
  titleAuto: boolean; // true = auto-titled (tracks the agent session / placeholder); false = user-renamed (pinned)
  alive?: boolean; // derived from tmux, not stored
}

// How a terminal earns a "needs attention" notification: `explicit` = bell / OSC-notify only,
// `silence` = went quiet after activity only, `layered` = either (the never-miss default).
export type AttentionMode = "layered" | "explicit" | "silence";

export interface Settings {
  defaultLaunchCommand: string;
  defaultShell: string;
  attentionMode: AttentionMode;    // which signals fire an attention toast (see AttentionMode)
  silenceSeconds: number;          // quiet window (s) before silence counts as "finished" (silence/layered)
  token: string | null;
  autoSave: boolean;
  autoSaveDelaySeconds: number;
  minimap: boolean;
  wordWrap: boolean;
  lineNumbers: boolean;
  diffSplit: boolean;
  sidebarPosition: "bottom" | "left" | "right" | "top";
  theme: string;                   // active theme id (roster lives in web/src/theme)
  sttProvider: "local" | "openai"; // speech-to-text backend for terminal dictation
  openaiSttModel: string;          // OpenAI transcription model id
  openaiApiKey: string | null;     // write-only; never returned to the browser
  micMode: "toggle" | "hold";      // mic button: click-to-toggle vs hold-to-talk (push-to-talk)
  pushoverToken: string | null;    // write-only Pushover app API token; never returned to the browser
  pushoverUser: string | null;     // write-only Pushover user/group key; never returned to the browser
  headroomLauncherHidden: boolean; // user dismissed the "Claude (Headroom)" launcher card in the picker
  focusBarColor: string;           // hex color of the focused-terminal green bar (Settings → Appearance)
  tmuxStatusFg: string;            // hex foreground (text) color of each terminal's tmux status bar
  stageManagerEnabled: boolean;    // master on/off for the Stage Manager feature (off = no launcher, nothing mounts)
  stageManagerPosition: "left" | "right" | "top" | "bottom"; // which edge the Stage Manager dock anchors to
}

// "Better Comments" — color a comment's text by a leading tag (e.g. `// ! alert`). One tag
// entry per marker; styles mirror the VS Code extension's tag schema. Stored as a JSON blob
// under the `betterComments` settings key. Mirrored by hand in web/src/api/types.ts.
export interface CommentTag {
  tag: string;             // marker the comment text must start with: "!", "?", "//", "todo", "*"
  color: string;           // hex text color
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  backgroundColor: string; // "transparent" by default
}

export interface BetterCommentsConfig {
  enabled: boolean;        // master on/off
  tags: CommentTag[];
}

// Break / stand-up enforcer config — a recurring full-screen break reminder. CLIENT-SIDE feature:
// the timer + overlay live in the browser; the server only persists this blob under the `breaks`
// settings key (passthrough, like betterComments). No server scheduler. Mirrored by hand in
// web/src/api/types.ts.
export interface BreakSettings {
  enabled: boolean;         // master on/off
  intervalMinutes: number;  // how often a break fires
  durationMinutes: number;  // how long the break lasts / the overlay counts down
  pauseWhenHidden: boolean; // don't accrue time while the tab is hidden (user away)
  preWarnSeconds: number;   // heads-up countdown before the screen locks (0 = lock immediately)
  allowSkip: boolean;       // show the mandatory "skip / keep working" escape button
  speak: boolean;           // read the break prompt aloud when it starts (reuses notify TTS)
}

export interface CustomAgent {
  id: string;
  name: string;
  command: string;
  icon: string | null; // uploaded icon as a data URL, or null
  category: string;     // section it shows under in the picker ("Other" by default; never "Detected agents")
  createdAt: number;
}

// A temp access link ("add a teammate") — a revocable, optionally-expiring credential that drops a
// teammate straight into a room. `secret` is the URL credential (returned ONLY to the main/owner
// principal so the manager can re-copy the link; NEVER to a key principal). `workspaceId` is the
// room to auto-open on arrival (null = land on the canvas). `expiresAt` null = never. Mirrored by
// hand in web/src/api/types.ts.
export interface AccessKey {
  id: string;
  label: string;
  secret: string;
  workspaceId: string | null;
  expiresAt: number | null;
  createdAt: number;
  lastUsedAt: number | null;
  mirror: boolean; // push the owner's UI nav (space/rooms/fullscreen/panels) to this viewer
  lock: boolean;   // viewer is a passive spectator — mouse + terminal typing disabled
}

// One entry in the curated voice roster (see store.getKeptVoices). Browsers enumerate the OS's
// speech-synthesis voices; the user trims that list and the kept set is mirrored server-side so
// both the voice picker and notifying agents (GET /api/voices) can read it. Mirrored by hand in
// web/src/api/types.ts.
export interface KeptVoice { name: string; lang: string }

export interface Bookmark {
  id: string;
  folder: string;        // owning workspace folder (absolute)
  filePath: string;      // absolute path of the bookmarked file
  line: number;          // 1-based line number
  label: string | null;  // labeled-bookmark text, null = plain bookmark
  preview: string | null; // trimmed line text captured at toggle time
  createdAt: number;
  updatedAt: number;
}

// A saved-folder "favorite" and its containing group — the Favorites project-switcher panel.
// Groups nest via parentId (null = root). Favorites live in a group, or at root (groupId null).
// `position` orders siblings within a bucket. Mirrored by hand in web/src/api/types.ts.
export interface FavoriteGroup {
  id: string;
  parentId: string | null; // null = root; otherwise a self-ref to the parent group
  name: string;
  position: number;        // order among siblings sharing parentId
  createdAt: number;
  updatedAt: number;
}
export interface Favorite {
  id: string;
  groupId: string | null;  // null = root; otherwise the containing group
  folder: string;          // absolute host path
  label: string | null;    // null = display basename(folder)
  position: number;        // order among siblings sharing groupId
  createdAt: number;
  updatedAt: number;
}

// A saved program "blueprint" — the node-canvas map built in the Prompt Builder. `graph` is the
// React-Flow graph (nodes + edges) serialized to JSON; the server treats it as an OPAQUE blob and
// never interprets its structure (the web canvas owns the shape). Mirrored in web/src/api/types.ts.
export interface Blueprint {
  id: string;
  name: string;
  graph: string;          // opaque JSON: { nodes, edges }
  chat: string | null;    // opaque JSON: AI-assistant transcript [{role,content}]; null = none saved
  createdAt: number;
  updatedAt: number;
}

// A canvas sticky note — a quick throwaway post-it floating on a space's canvas (distinct from the
// `Note` scratchpad panel). `spaceId` scopes it to one space like a workspace card (null = Home).
// `color` is a hex tint from the shared ColorPicker (null = the default yellow). `x`/`y`/`w`/`h` are
// viewport-pixel geometry; `pinned` floats it above an open room. Mirrored in web/src/api/types.ts.
export interface StickyNote {
  id: string;
  spaceId: string | null;
  content: string;
  color: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}
// A widget dropped onto a space's canvas (mirrors web/src/api/types.ts; keep in sync by hand). `kind`
// selects which widget renders; `config` is opaque per-instance JSON (e.g. a world clock's cities).
// x/y/w/h are canvas geometry, like a StickyNote. `spaceId` scopes it to one space (null = Home).
export type SpaceWidgetKind = "claude-meter" | "codex-meter" | "world-clock" | "agent-activity" | "today" | "headroom-savings";
export interface SpaceWidget {
  id: string;
  spaceId: string | null;
  kind: SpaceWidgetKind;
  x: number;
  y: number;
  w: number;
  h: number;
  config: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

// Per-agent daily pacing baseline for the usage meters (see server/src/meters/baseline.ts). One row
// per agent ("claude" | "codex"): the weekly % captured at the start of the current local day, plus
// the keys that detect a day/week rollover. Persisted so "used today" survives restarts.
export interface MeterBaseline {
  weekKey: number | null;
  dayKey: string | null;
  dayStartWeeklyPct: number;
}

// A free-form scratchpad note from the Notes panel. `title` may be empty (the UI then shows the
// first line of content). Mirrored by hand in web/src/api/types.ts.
export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

// A folder that groups saved web links in the top-bar Links dropdown. Mirrored by hand in
// web/src/api/types.ts.
export interface LinkFolder {
  id: string;
  name: string;
  color: string | null; // custom folder-name text color (null = theme default)
  sort: number;
  createdAt: number;
  updatedAt: number;
}

// A saved web link ("important website"). `folderId` is null when ungrouped (top level); `sort` is the
// manual order within its folder (or the ungrouped set). Mirrored by hand in web/src/api/types.ts.
export interface Link {
  id: string;
  folderId: string | null;
  title: string;
  url: string;
  description: string;
  color: string | null; // custom text color: title shows it at full, description dimmed (null = theme default)
  sort: number;
  createdAt: number;
  updatedAt: number;
}

// Task-board (kanban) card. `column` is the lane it lives in; `position` orders cards within that
// lane (ascending, contiguous). `color` is an optional hex accent (null = neutral).
export type BoardColumn = "todo" | "doing" | "done";
export const BOARD_COLUMNS: readonly BoardColumn[] = ["todo", "doing", "done"];
export interface BoardCard {
  id: string;
  column: BoardColumn;
  position: number;
  title: string;
  body: string;
  color: string | null;
  createdAt: number;
  updatedAt: number;
}

// Timesheet (Harvest-style time tracker). One work session; `stoppedAt` null = still running. The
// client/project/task NAMES are stored on the entry, not foreign keys — see db/schema.sql. Mirrored
// by hand in web/src/api/types.ts.
export interface TimeEntry {
  id: string;
  client: string;
  project: string;
  task: string;
  notes: string;
  startedAt: number;
  stoppedAt: number | null;
  createdAt: number;
  updatedAt: number;
}
// Timesheet catalog rows — the dropdown sources, managed in the panel's Settings tab. `archived`
// hides a row from the dropdowns without touching past entries. Mirrored by hand in web types.
export interface TimeClient { id: string; name: string; archived: boolean; position: number; createdAt: number; updatedAt: number; }
export interface TimeProject { id: string; clientId: string; name: string; archived: boolean; position: number; createdAt: number; updatedAt: number; }
export interface TimeTask { id: string; name: string; archived: boolean; position: number; createdAt: number; updatedAt: number; }

export interface ProcessInfo {
  pid: number;
  ppid: number;
  cpu: number; // %CPU, normalized to total machine capacity (0–100) — not ps's per-core figure
  mem: number; // %MEM
  rss: number; // resident memory, KB
  name: string; // executable basename
  command: string; // full command line
}

// Live host metrics for the system-monitor bar. Mirrored by hand in web/src/api/types.ts.
// Bytes for memory; bytes/sec for network (rx = download/↓, tx = upload/↑).
export interface SystemStats {
  cpu: { percent: number };                                // 0–100
  mem: { used: number; total: number; percent: number };   // bytes, bytes, 0–100
  net: { rxBytesPerSec: number; txBytesPerSec: number };    // ≥ 0
}

// A TCP socket in the LISTEN state, from the port monitor. Mirrored by hand in
// web/src/api/types.ts. pid 0 / empty name = the OS hid the owner (unprivileged scan).
export interface PortInfo {
  port: number;     // listening port
  protocol: string; // "tcp" (lowercased from the source tool)
  address: string;  // local bind address: "*", "127.0.0.1", "[::1]", "0.0.0.0"
  pid: number;      // owning process id, 0 if unknown
  name: string;     // process/command name, "" if unknown
}

// --- Calendar reminders + scheduled notifications -----------------------------------------------
// A reminder is one scheduled notification — the single primitive behind both the calendar (which is
// a *view* over these rows) and the one-off "ping me at T" form. Every instant is epoch-ms UTC
// (Date.now()-style): an absolute moment, never a naive local datetime, so the server's timezone is
// irrelevant — the browser converts to/from the viewer's local zone for display and input.
// Mirrored by hand in web/src/api/types.ts.
export type ReminderStatus = "pending" | "snoozed" | "fired" | "cancelled" | "missed";

// Which delivery channels fire when the reminder comes due. `inApp` = the toast/notify bus; `speak` =
// read the toast aloud (TTS); `pushover` = push to the phone (only if Pushover is configured).
export interface NotifyChannels { inApp: boolean; pushover: boolean; speak: boolean }

export type RecurrenceFreq = "daily" | "weekly" | "monthly" | "yearly";
// A repeat rule. `interval` = every N units (1 = every day/week/month/year). `until` caps the series
// by instant (epoch ms), `count` caps it by occurrence count; both null = open-ended.
export interface Recurrence { freq: RecurrenceFreq; interval: number; until: number | null; count: number | null }

export interface Reminder {
  id: string;
  title: string;
  body: string;                  // description ("" = none)
  fireAt: number;                // epoch ms — the event start / where the calendar chip sits
  allDay: boolean;
  endAt: number | null;          // epoch ms — optional span end (calendar display); null = point event
  leadMinutes: number;           // alert this many minutes BEFORE fireAt (0 = at fireAt)
  color: string | null;          // calendar-chip accent (hex); null = default
  imagePath: string | null;      // relative path under the reminder-images dir (server-owned); null = none
  channels: NotifyChannels;
  level: NotifyLevel;            // toast color / severity (reuses the notify levels)
  priority: number;              // Pushover priority -2..2 (2 = emergency); ignored for in-app
  recurrence: Recurrence | null; // repeat rule; null = one-time
  status: ReminderStatus;
  snoozeUntil: number | null;    // epoch ms a snoozed reminder re-fires at; null unless status==='snoozed'
  firedAt: number | null;        // epoch ms of the last fire; null until first fired
  wasMissed: boolean;            // fired late by boot catch-up (server was down when it came due)
  createdAt: number;
  updatedAt: number;
}

// A persisted notification — the durable record the notification center reads. The live notify bus is
// fire-and-forget (a fire is lost if no browser is open); every fire ALSO writes one of these so the
// inbox shows history + an unread badge even across restarts. Mirrored in web/src/api/types.ts.
export interface AppNotification {
  id: string;
  reminderId: string | null;     // source reminder; null if it came from elsewhere
  title: string;
  body: string;
  level: NotifyLevel;
  category: NotifyCategory;      // center bucket: "agent" | "error" | "info"
  imagePath: string | null;
  workspaceId: string | null;   // deep-link target: clicking opens this room…
  terminalId: string | null;    // …and focuses this terminal (agent notifications carry both)
  wasMissed: boolean;
  pushover: boolean;             // a Pushover send was attempted for this fire
  pushoverOk: boolean | null;    // true = delivered, false = failed, null = not attempted
  read: boolean;
  firedAt: number;
  createdAt: number;
}

// ── Copilot ──────────────────────────────────────────────────────────────────
// The in-app Copilot agent. `CopilotSettings` is a singleton config blob persisted under the
// `copilot` settings key (the getBreaks/getCanvasBackground idiom), NOT its own table.
export type CopilotReportChannel = "toast" | "voice" | "pushover";
export type CopilotOrbPosition = "bottom-right" | "bottom-left" | "top-right" | "top-left";
export interface CopilotSettings {
  enabled: boolean;                       // master on/off for the whole feature
  defaultEngine: string | null;           // AiProvider id to drive the loop; null = use the ai default
  reportChannels: CopilotReportChannel[]; // where scheduled loops report their findings
  confirmDangerous: boolean;              // gate tools flagged `dangerous` behind a confirm step
  orbEnabled: boolean;                    // show the always-on canvas orb
  orbPosition: CopilotOrbPosition;        // which corner the orb floats in
}
export interface CopilotConversation { id: string; title: string; createdAt: number; updatedAt: number; }
// A stored message row. `content` is an opaque JSON array of canonical content blocks (text /
// tool_use / tool_result) — the store never parses it; the copilot service does.
export interface CopilotStoredMessage { id: string; conversationId: string; role: "user" | "assistant"; content: string; createdAt: number; }
export interface CopilotSkillState { enabled: boolean; settings: Record<string, unknown>; }
// A connected skill account as the browser sees it — NEVER includes the secret (an IMAP app-password
// or OAuth token); `hasSecret` reports whether one is stored. `config` is non-secret (imap user/host/port).
export interface CopilotSkillAccount { id: string; skillId: string; label: string; provider: string; config: Record<string, unknown>; hasSecret: boolean; createdAt: number; }
export type CopilotReportMode = "always" | "on-change" | "on-find";
export interface CopilotJob {
  id: string;
  title: string;
  tool: string;                       // tool name the loop runs
  args: Record<string, unknown>;
  intervalSec: number;
  reportMode: CopilotReportMode;
  enabled: boolean;
  nextRun: number;                    // epoch ms
  lastRun: number | null;
  lastSummary: string | null;         // kept so on-change can compare
  createdAt: number;
  updatedAt: number;
}

// An MCP tool server the Copilot can call. `transport`: 'stdio' spawns `command` (argv) on the host
// with `env`; 'http' connects to `url`. `tools` is the schema list discovered at connect time.
export type CopilotMcpTransport = "stdio" | "http";
export interface CopilotMcpToolInfo { name: string; description: string; inputSchema: Record<string, unknown>; }
// Public shape (what the browser sees) — env VALUES are never returned, only the key names (env may
// hold secrets). The internal config (with env values, for the connect path) is CopilotMcpServerConfig.
export interface CopilotMcpServer {
  id: string;
  label: string;
  transport: CopilotMcpTransport;
  command: string[];                  // argv (stdio)
  url: string | null;                 // endpoint (http)
  envKeys: string[];                  // names of stored env vars, values withheld
  enabled: boolean;
  tools: CopilotMcpToolInfo[];        // discovered at last connect
  status: "ok" | "error" | "unknown";
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}
export interface CopilotMcpServerConfig extends Omit<CopilotMcpServer, "envKeys"> { env: Record<string, string>; }
