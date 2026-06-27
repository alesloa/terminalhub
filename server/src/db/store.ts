import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { Workspace, Terminal, Settings, CustomAgent, AccessKey, Bookmark, BetterCommentsConfig, BreakSettings, FavoriteGroup, Favorite, Blueprint, Note, Link, LinkFolder, StickyNote, SpaceWidget, SpaceWidgetKind, MeterBaseline, BoardCard, BoardColumn, Space, Folder, KeptVoice, CanvasBackground, StageDock, Wallpaper, WallpaperData, Reminder, AppNotification, ReminderStatus, NotifyChannels, Recurrence, CopilotSettings, CopilotConversation, CopilotStoredMessage, CopilotSkillState, CopilotSkillAccount, CopilotJob, CopilotReportMode, CopilotMcpServer, CopilotMcpServerConfig, CopilotMcpToolInfo, CopilotMcpTransport, TimeEntry, TimeClient, TimeProject, TimeTask } from "../types.js";
import type { SpaceConfig, SpacePreset } from "../spaces/types.js";
import { normalizeSpaceConfig } from "../spaces/types.js";
import type { NotifyLevel, NotifyCategory } from "../notify/bus.js";
import type { AiConfig } from "../ai/types.js";
import type { SkillInstall, CatalogSource, CatalogEntry } from "../skills/types.js";
import { DEFAULT_CATALOG_SOURCES } from "../skills/defaults.js";
import { computeNextOccurrence } from "../scheduler/recurrence.js";

const EMPTY_AI_CONFIG: AiConfig = { providers: [], defaultProviderId: null };

// A connected Google Drive account. refresh_token/access_token are server-only secrets — they are
// returned by getDriveAccount (used only inside the Drive controller) but NEVER by listDriveAccounts.
export type DriveAccount = {
  id: string; email: string; name: string | null; label: string | null; picture: string | null;
  refreshToken: string; accessToken: string | null; expiry: number | null;
  scope: string; createdAt: number;
};
// What the browser is allowed to see — NEVER the tokens. `label` is the user's custom name (null =
// fall back to the email).
export type DriveAccountPublic = Pick<DriveAccount, "id" | "email" | "name" | "label" | "picture">;

// A copilot skill account WITH its secret — returned only to server-side callers (the email tool),
// never by the public list. The route layer projects to CopilotSkillAccount (hasSecret) for the browser.
export type SkillAccountSecret = { id: string; skillId: string; label: string; provider: string; config: Record<string, unknown>; secret: string; createdAt: number };

// A space widget's opaque per-instance config column (TEXT) → object, tolerating malformed JSON.
function parseWidgetConfig(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
}

// A skill account's non-secret config column → object (tolerant of malformed JSON).
function parseConfig(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try { const v = JSON.parse(raw); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}
// Project a copilot_skill_accounts row to the public shape — secret stripped, replaced by hasSecret.
function rowToAccountPublic(r: { id: string; skillId: string; label: string; provider: string; config: string; secret: string; createdAt: number }): CopilotSkillAccount {
  return { id: r.id, skillId: r.skillId, label: r.label, provider: r.provider, config: parseConfig(r.config), hasSecret: !!r.secret, createdAt: r.createdAt };
}
// A copilot_jobs row → CopilotJob (parse args JSON, 0/1 → boolean).
function rowToJob(r: any): CopilotJob {
  return {
    id: r.id, title: r.title, tool: r.tool, args: parseConfig(r.args),
    intervalSec: r.intervalSec, reportMode: r.reportMode, enabled: r.enabled === 1,
    nextRun: r.nextRun, lastRun: r.lastRun ?? null, lastSummary: r.lastSummary ?? null,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}
function parseMcpTools(raw: string | null): CopilotMcpToolInfo[] {
  try { const v = JSON.parse(raw ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
// A copilot_mcp_servers row → public CopilotMcpServer. env VALUES are dropped (may be secrets); only
// the key names ride out. `command` and `tools` are JSON columns.
function rowToMcpPublic(r: any): CopilotMcpServer {
  return {
    id: r.id, label: r.label, transport: r.transport,
    command: (() => { try { const v = JSON.parse(r.command ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; } })(),
    url: r.url ?? null, envKeys: Object.keys(parseConfig(r.env)),
    enabled: r.enabled === 1, tools: parseMcpTools(r.tools),
    status: r.status, lastError: r.lastError ?? null, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}
// Internal — includes env VALUES, for the connect/run path only (never sent to the browser).
function rowToMcpConfig(r: any): CopilotMcpServerConfig {
  const { envKeys, ...pub } = rowToMcpPublic(r);
  return { ...pub, env: parseConfig(r.env) as Record<string, string> };
}

// VS Code "Better Comments" v3.0.2 defaults, verbatim.
const DEFAULT_BETTER_COMMENTS: BetterCommentsConfig = {
  enabled: true,
  tags: [
    { tag: "!", color: "#FF2D00", bold: false, italic: false, underline: false, strikethrough: false, backgroundColor: "transparent" },
    { tag: "?", color: "#3498DB", bold: false, italic: false, underline: false, strikethrough: false, backgroundColor: "transparent" },
    { tag: "//", color: "#474747", bold: false, italic: false, underline: false, strikethrough: true, backgroundColor: "transparent" },
    { tag: "todo", color: "#FF8C00", bold: false, italic: false, underline: false, strikethrough: false, backgroundColor: "transparent" },
    { tag: "*", color: "#98C379", bold: false, italic: false, underline: false, strikethrough: false, backgroundColor: "transparent" },
  ],
};

// Theme-default backdrop: a solid canvas with no chosen color (null falls back to the theme's
// --tr-bg), no wallpaper, scrim off. This is what the canvas looks like before the user customizes.
const DEFAULT_CANVAS_BG: CanvasBackground = { kind: "solid", color: null, wallpaper: null, overlay: false, dim: 50 };

// Stage Manager dock frosted-panel defaults — on, tint tracking the theme (null), 55% fill, 16px blur.
// Stored as a JSON blob under the `stageDock` settings key (the canvasBackground idiom).
const DEFAULT_STAGE_DOCK: StageDock = { enabled: true, color: null, opacity: 55, blur: 16, borderColor: null, borderOpacity: 40 };

// Break / stand-up enforcer defaults — off until the user opts in; an hourly 10-minute break with a
// 20-second heads-up, skippable, pausing while the tab is hidden. Stored as a JSON blob under the
// `breaks` settings key (passthrough, like betterComments/canvasBackground).
const DEFAULT_BREAKS: BreakSettings = {
  enabled: false, intervalMinutes: 60, durationMinutes: 10,
  pauseWhenHidden: true, preWarnSeconds: 20, allowSkip: true, speak: false,
};

// Copilot config defaults — feature on (the user asked for it), no engine pinned (fall back to the
// ai controller's default provider), report to a toast, dangerous tools gated, orb on bottom-right.
// Stored as a JSON blob under the `copilot` settings key, like DEFAULT_BREAKS.
const DEFAULT_COPILOT_SETTINGS: CopilotSettings = {
  enabled: true,
  defaultEngine: null,
  reportChannels: ["toast"],
  confirmDangerous: true,
  orbEnabled: true,
  orbPosition: "bottom-right",
};
const COPILOT_REPORT_CHANNELS = ["toast", "voice", "pushover"] as const;
const COPILOT_ORB_POSITIONS = ["bottom-right", "bottom-left", "top-right", "top-left"] as const;

const here = dirname(fileURLToPath(import.meta.url));

function id(prefix: string): string {
  return prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

/** Map a raw terminals row to a Terminal: SQLite stores titleAuto as 1/0, the type wants a boolean.
 *  (A pre-migration row missing the column reads as auto, i.e. unlocked.) */
function rowToTerminal(row: any): Terminal {
  return { ...row, titleAuto: row.titleAuto !== 0 };
}

// access_keys stores mirror/lock as 0/1 INTEGERs; expose them as real booleans to the rest of the app.
function rowToAccessKey(row: any): AccessKey {
  return { ...row, mirror: row.mirror === 1, lock: row.lock === 1 };
}

const DEFAULT_SETTINGS: Settings = {
  defaultLaunchCommand: "claude",
  defaultShell: process.env.SHELL ?? "/bin/bash",
  attentionMode: "layered",
  silenceSeconds: 10,
  token: null,
  autoSave: false,
  autoSaveDelaySeconds: 2,
  minimap: true,
  wordWrap: false,
  lineNumbers: true,
  diffSplit: true,
  sidebarPosition: "bottom",
  theme: "terminalhub",
  sttProvider: "local",
  openaiSttModel: "gpt-4o-transcribe",
  openaiApiKey: null,
  micMode: "toggle",
  pushoverToken: null,
  pushoverUser: null,
  headroomLauncherHidden: false,
  focusBarColor: "#22c55e",
  tmuxStatusFg: "#22c55e",
  stageManagerEnabled: true,
  stageManagerPosition: "left",
};

function parseSetting(key: string, value: string): unknown {
  if (value === "null") return null;
  if (["autoSave", "minimap", "wordWrap", "lineNumbers", "diffSplit", "headroomLauncherHidden", "stageManagerEnabled"].includes(key)) return value === "true";
  if (key === "autoSaveDelaySeconds") {
    const n = Number(value);
    return Number.isFinite(n) ? n : DEFAULT_SETTINGS.autoSaveDelaySeconds;
  }
  if (key === "silenceSeconds") {
    const n = Number(value);
    return Number.isFinite(n) ? n : DEFAULT_SETTINGS.silenceSeconds;
  }
  if (key === "attentionMode") return ["layered", "explicit", "silence"].includes(value) ? value : "layered";
  if (key === "sidebarPosition") return ["bottom", "left", "right", "top"].includes(value) ? value : "bottom";
  if (key === "stageManagerPosition") return ["left", "right", "top", "bottom"].includes(value) ? value : "left";
  if (key === "sttProvider") return value === "openai" ? "openai" : "local";
  if (key === "micMode") return value === "hold" ? "hold" : "toggle";
  return value;
}

export interface Store {
  createWorkspace(w: Pick<Workspace,"name"|"folder"|"launchCommand"|"color"> & Partial<Pick<Workspace,"x"|"y"|"spaceId"|"config">>): Workspace;
  getWorkspace(id: string): Workspace | undefined;
  listWorkspaces(): Workspace[];
  updateWorkspace(id: string, patch: Partial<Pick<Workspace,"name"|"folder"|"launchCommand"|"color"|"cardColor"|"layout"|"spaceId"|"folderId"|"config"|"x"|"y">>): void;
  deleteWorkspace(id: string): void;
  // Canvas folders (iPhone-style card groups). A folder owns a name + canvas position; its members
  // carry workspaces.folderId. `createFolder` can seed members in one shot (the group gesture);
  // `deleteFolder` dissolves the folder (members' folderId cleared → back onto the canvas).
  listFolders(): Folder[];
  getFolder(id: string): Folder | undefined;
  createFolder(f: { spaceId?: string | null; name?: string; x: number; y: number; memberIds?: string[] }): Folder;
  updateFolder(id: string, patch: Partial<Pick<Folder, "name" | "x" | "y" | "spaceId">>): void;
  deleteFolder(id: string): void;
  createSpace(s: { name: string; icon?: string | null; color?: string | null; config?: SpaceConfig | null }): Space;
  getSpace(id: string): Space | undefined;
  listSpaces(): Space[];
  updateSpace(id: string, patch: { name?: string; icon?: string | null; color?: string | null; background?: CanvasBackground | null; config?: SpaceConfig | null }): void;
  moveSpace(id: string, index: number): void;
  deleteSpace(id: string): boolean;
  reassignWorkspaces(fromSpaceId: string, toSpaceId: string): void;
  listSpacePresets(): SpacePreset[];
  getSpacePreset(id: string): SpacePreset | undefined;
  createSpacePreset(p: { name: string; icon?: string | null; config: SpaceConfig }): SpacePreset;
  updateSpacePreset(id: string, patch: { name?: string; icon?: string | null; config?: SpaceConfig }): SpacePreset | undefined;
  deleteSpacePreset(id: string): void;
  reassignTerminals(fromWorkspaceId: string, toWorkspaceId: string): void;
  getHomeSpaceId(): string | undefined;
  getDesktopWorkspaceId(): string | undefined;
  createTerminal(t: Pick<Terminal,"workspaceId"|"title"|"color"|"tmuxSession"|"launchCommandOverride">): Terminal;
  getTerminal(id: string): Terminal | undefined;
  listTerminals(workspaceId: string): Terminal[];
  listAllTerminals(): Terminal[];
  // `auto: true` marks the title as auto-generated (placeholder / agent auto-title), leaving the
  // tab unlocked so the auto-titler may refine it later. A title change without `auto` is a user
  // rename and locks the tab (titleAuto → false) so nothing overwrites it.
  updateTerminal(id: string, patch: Partial<Pick<Terminal,"title"|"color"|"icon">> & { auto?: boolean }): void;
  setTerminalSession(id: string, tmuxSession: string): void;
  moveTerminal(id: string, index: number): void;
  deleteTerminal(id: string): void;
  getSettings(): Settings;
  setSettings(patch: Partial<Settings>): void;
  getCanvasBackground(): CanvasBackground;
  setCanvasBackground(bg: CanvasBackground): void;
  getStageDock(): StageDock;
  setStageDock(dock: StageDock): void;
  listWallpapers(): Wallpaper[];
  getWallpaper(id: string): WallpaperData | undefined;
  createWallpaper(w: { name: string; dataUrl: string }): Wallpaper;
  deleteWallpaper(id: string): void;
  listCustomAgents(): CustomAgent[];
  createCustomAgent(a: Pick<CustomAgent,"name"|"command"|"icon"|"category">): CustomAgent;
  deleteCustomAgent(id: string): void;
  getAiConfig(): AiConfig;
  setAiConfig(c: AiConfig): void;
  getBetterComments(): BetterCommentsConfig;
  setBetterComments(c: BetterCommentsConfig): void;
  getBreaks(): BreakSettings;
  setBreaks(b: BreakSettings): void;
  // Copilot singleton settings (JSON blob under the `copilot` settings key). getCopilotSettings
  // merges over defaults field-by-field; setCopilotSettings persists the validated whole object.
  getCopilotSettings(): CopilotSettings;
  setCopilotSettings(s: CopilotSettings): void;
  // Copilot conversations + message transcripts (ids `co_` / `cm_`). `content` is stored verbatim
  // (opaque JSON block array); messages cascade-delete with their conversation and replay in
  // insertion order.
  createCopilotConversation(title?: string): CopilotConversation;
  listCopilotConversations(): CopilotConversation[];
  getCopilotConversation(id: string): CopilotConversation | undefined;
  updateCopilotConversation(id: string, patch: { title?: string }): void;
  touchCopilotConversation(id: string): void;
  deleteCopilotConversation(id: string): void;
  addCopilotMessage(m: { conversationId: string; role: "user" | "assistant"; content: string }): CopilotStoredMessage;
  listCopilotMessages(conversationId: string): CopilotStoredMessage[];
  // Per-skill enable/settings state (no row = never toggled → disabled, default settings).
  getCopilotSkillState(id: string): CopilotSkillState | undefined;
  setCopilotSkillState(id: string, patch: { enabled?: boolean; settings?: Record<string, unknown> }): void;
  // Skill accounts. `secret` is stored but NEVER returned by the public list/create — only
  // getSkillAccountSecret (server-side, for the tool) exposes it.
  createSkillAccount(a: { skillId: string; label: string; provider: string; config: Record<string, unknown>; secret: string }): CopilotSkillAccount;
  listSkillAccounts(skillId: string): CopilotSkillAccount[];
  getSkillAccountSecret(id: string): SkillAccountSecret | undefined;
  updateSkillAccount(id: string, patch: { label?: string; config?: Record<string, unknown>; secret?: string }): CopilotSkillAccount | undefined;
  deleteSkillAccount(id: string): void;
  // Scheduled copilot loops. `dueJobs` selects enabled jobs whose nextRun has passed; `markJobRun`
  // advances nextRun + records the run. Mirrors the reminder scheduler's polling model.
  createCopilotJob(j: { title?: string; tool: string; args?: Record<string, unknown>; intervalSec: number; reportMode?: CopilotReportMode; nextRun?: number }): CopilotJob;
  listCopilotJobs(): CopilotJob[];
  getCopilotJob(id: string): CopilotJob | undefined;
  updateCopilotJob(id: string, patch: Partial<Pick<CopilotJob, "title" | "args" | "intervalSec" | "reportMode" | "enabled" | "nextRun">>): CopilotJob | undefined;
  deleteCopilotJob(id: string): void;
  dueCopilotJobs(now: number): CopilotJob[];
  markCopilotJobRun(id: string, opts: { now: number; nextRun: number; summary: string }): void;
  // MCP tool servers. `getMcpServerConfig` returns env VALUES (for the connect path); everything else
  // returns the public shape with env values stripped. `setMcpServerTools` caches a connect's result.
  createMcpServer(s: { label: string; transport: CopilotMcpTransport; command?: string[]; url?: string | null; env?: Record<string, string> }): CopilotMcpServer;
  listMcpServers(): CopilotMcpServer[];
  getMcpServer(id: string): CopilotMcpServer | undefined;
  getMcpServerConfig(id: string): CopilotMcpServerConfig | undefined;
  updateMcpServer(id: string, patch: { label?: string; command?: string[]; url?: string | null; env?: Record<string, string>; enabled?: boolean }): CopilotMcpServer | undefined;
  setMcpServerTools(id: string, tools: CopilotMcpToolInfo[], status: "ok" | "error", lastError: string | null): void;
  deleteMcpServer(id: string): void;
  getKeptVoices(): KeptVoice[];
  setKeptVoices(voices: KeptVoice[]): void;
  getClaudePrefs(): Record<string, { pinned: boolean; color: string | null }>;
  setClaudePref(sessionId: string, patch: { pinned?: boolean; color?: string | null }): void;
  deleteClaudePref(sessionId: string): void;
  listBookmarks(folder: string): Bookmark[];
  getBookmark(id: string): Bookmark | undefined;
  createBookmark(b: Pick<Bookmark,"folder"|"filePath"|"line"|"label"|"preview">): Bookmark;
  updateBookmark(id: string, patch: { label?: string | null }): void;
  updateBookmarkLine(id: string, line: number): void;
  deleteBookmark(id: string): void;
  clearFileBookmarks(folder: string, filePath: string): void;
  clearFolderBookmarks(folder: string): void;
  createFavoriteGroup(g: { parentId: string | null; name: string }): FavoriteGroup;
  listFavoriteGroups(): FavoriteGroup[];
  getFavoriteGroup(id: string): FavoriteGroup | undefined;
  renameFavoriteGroup(id: string, name: string): void;
  deleteFavoriteGroup(id: string, reassignTo?: string | null): void;
  moveFavoriteGroup(id: string, parentId: string | null, index: number): boolean;
  createFavorite(f: { groupId: string | null; folder: string; label?: string | null }): Favorite | undefined;
  listFavorites(): Favorite[];
  getFavorite(id: string): Favorite | undefined;
  renameFavorite(id: string, label: string | null): void;
  deleteFavorite(id: string): void;
  moveFavorite(id: string, groupId: string | null, index: number): void;
  listSkillInstalls(): SkillInstall[];
  getSkillInstall(installPath: string): SkillInstall | undefined;
  upsertSkillInstall(row: SkillInstall): void;
  moveSkillInstall(oldPath: string, newPath: string): void;
  deleteSkillInstall(installPath: string): void;
  createBlueprint(b: { name: string; graph: string; chat?: string | null }): Blueprint;
  getBlueprint(id: string): Blueprint | undefined;
  listBlueprints(): Blueprint[];
  updateBlueprint(id: string, patch: Partial<Pick<Blueprint, "name" | "graph" | "chat">>): void;
  deleteBlueprint(id: string): void;
  // Temp access links. `secret` is minted server-side (crypto-random). `getValidAccessKey` matches by
  // secret AND not-expired (sweeping any expired rows first); `sweepAccessKeys` purges past-expiry
  // rows; `touchAccessKey` bumps lastUsedAt at most ~once/minute.
  createAccessKey(a: { label?: string; workspaceId?: string | null; expiresAt?: number | null; mirror?: boolean; lock?: boolean }): AccessKey;
  listAccessKeys(): AccessKey[];
  getValidAccessKey(secret: string): AccessKey | undefined;
  revokeAccessKey(id: string): void;
  touchAccessKey(id: string): void;
  sweepAccessKeys(): number;
  createNote(n: { title: string; content: string }): Note;
  getNote(id: string): Note | undefined;
  listNotes(): Note[];
  updateNote(id: string, patch: Partial<Pick<Note, "title" | "content">>): void;
  deleteNote(id: string): void;
  // Web links + their folders (the top-bar Links dropdown).
  listLinks(): Link[];
  getLink(id: string): Link | undefined;
  createLink(l: { folderId?: string | null; title: string; url: string; description?: string }): Link;
  updateLink(id: string, patch: Partial<Pick<Link, "folderId" | "title" | "url" | "description" | "color" | "sort">>): Link | undefined;
  deleteLink(id: string): void;
  reorderLinks(items: { id: string; folderId: string | null; sort: number }[]): void;
  listLinkFolders(): LinkFolder[];
  getLinkFolder(id: string): LinkFolder | undefined;
  createLinkFolder(f: { name: string }): LinkFolder;
  updateLinkFolder(id: string, patch: Partial<Pick<LinkFolder, "name" | "color" | "sort">>): LinkFolder | undefined;
  deleteLinkFolder(id: string): void;
  reorderLinkFolders(items: { id: string; sort: number }[]): void;
  createStickyNote(n: { spaceId?: string | null; content?: string; color?: string | null; x: number; y: number; w: number; h: number }): StickyNote;
  getStickyNote(id: string): StickyNote | undefined;
  listStickyNotes(): StickyNote[];
  updateStickyNote(id: string, patch: Partial<Pick<StickyNote, "spaceId" | "content" | "color" | "x" | "y" | "w" | "h" | "pinned">>): void;
  deleteStickyNote(id: string): void;
  createSpaceWidget(n: { spaceId?: string | null; kind: SpaceWidgetKind; x: number; y: number; w: number; h: number; config?: Record<string, unknown> | null }): SpaceWidget;
  getSpaceWidget(id: string): SpaceWidget | undefined;
  listSpaceWidgets(): SpaceWidget[];
  updateSpaceWidget(id: string, patch: Partial<Pick<SpaceWidget, "spaceId" | "x" | "y" | "w" | "h" | "config">>): void;
  deleteSpaceWidget(id: string): void;
  getMeterBaseline(agent: string): MeterBaseline | null;
  saveMeterBaseline(agent: string, b: MeterBaseline): void;
  createBoardCard(c: { column: BoardColumn; title: string; body: string; color: string | null }): BoardCard;
  getBoardCard(id: string): BoardCard | undefined;
  listBoardCards(): BoardCard[];
  updateBoardCard(id: string, patch: Partial<Pick<BoardCard, "title" | "body" | "color">>): void;
  moveBoardCard(id: string, column: BoardColumn, position: number): void;
  deleteBoardCard(id: string): void;
  // Timesheet (Harvest-style tracker). Entries store client/project/task NAMES (not FKs); the catalog
  // tables only power the dropdowns. start/create auto-add any unknown name to the catalog so an agent
  // never has to set it up first. listTimeEntries returns entries started within [from,to) plus any
  // still-running entry. stopTimeEntry stops by id, by client (all running for it), or the latest
  // running when given neither — returning the entries it stopped. See db/schema.sql.
  listTimeEntries(from: number, to: number): TimeEntry[];
  getTimeEntry(id: string): TimeEntry | undefined;
  startTimeEntry(e: { client: string; project?: string; task?: string; notes?: string }): TimeEntry;
  createTimeEntry(e: { client: string; project?: string; task?: string; notes?: string; startedAt: number; stoppedAt?: number | null }): TimeEntry;
  stopTimeEntry(opts: { id?: string; client?: string; now: number }): TimeEntry[];
  updateTimeEntry(id: string, patch: Partial<Pick<TimeEntry, "client" | "project" | "task" | "notes" | "startedAt" | "stoppedAt">>): TimeEntry | undefined;
  deleteTimeEntry(id: string): void;
  listTimeClients(): TimeClient[];
  createTimeClient(name: string): TimeClient;
  updateTimeClient(id: string, patch: Partial<Pick<TimeClient, "name" | "archived" | "position">>): TimeClient | undefined;
  deleteTimeClient(id: string): void;            // also drops the client's projects (history keeps the names)
  listTimeProjects(clientId?: string): TimeProject[];
  createTimeProject(clientId: string, name: string): TimeProject;
  updateTimeProject(id: string, patch: Partial<Pick<TimeProject, "name" | "archived" | "position">>): TimeProject | undefined;
  deleteTimeProject(id: string): void;
  listTimeTasks(): TimeTask[];
  createTimeTask(name: string): TimeTask;
  updateTimeTask(id: string, patch: Partial<Pick<TimeTask, "name" | "archived" | "position">>): TimeTask | undefined;
  deleteTimeTask(id: string): void;
  createReminder(r: {
    title: string; body?: string; fireAt: number; allDay?: boolean; endAt?: number | null;
    leadMinutes?: number; color?: string | null; imagePath?: string | null;
    channels?: NotifyChannels; level?: NotifyLevel; priority?: number; recurrence?: Recurrence | null;
  }): Reminder;
  getReminder(id: string): Reminder | undefined;
  listReminders(filter?: { from?: number; to?: number; status?: ReminderStatus[] }): Reminder[];
  updateReminder(id: string, patch: Partial<Pick<Reminder, "title" | "body" | "fireAt" | "allDay" | "endAt" | "leadMinutes" | "color" | "imagePath" | "channels" | "level" | "priority" | "recurrence" | "status">>): Reminder | undefined;
  deleteReminder(id: string): void;
  dueReminders(now: number): Reminder[];
  markFired(id: string, opts: { now: number; wasMissed?: boolean }): void;
  snoozeReminder(id: string, until: number): Reminder | undefined;
  createNotification(n: {
    title: string; body?: string; level?: NotifyLevel; category?: NotifyCategory; reminderId?: string | null;
    imagePath?: string | null; workspaceId?: string | null; terminalId?: string | null;
    wasMissed?: boolean; pushover?: boolean; pushoverOk?: boolean | null; firedAt?: number;
  }): AppNotification;
  listNotifications(limit?: number): AppNotification[];
  unreadNotificationCount(): number;
  markNotificationRead(id: string): void;
  markAllNotificationsRead(): void;
  deleteNotification(id: string): void;
  deleteNotificationsForTerminal(terminalId: string): number; // returns how many were removed
  clearNotifications(): void;
  setReminderImage(reminderId: string, dataUrl: string): void;
  getReminderImage(reminderId: string): string | undefined;
  deleteReminderImage(reminderId: string): void;
  listCatalogSources(): CatalogSource[];
  addCatalogSource(source: string, official?: boolean): void;
  setCatalogSourceOfficial(source: string, official: boolean): void;
  removeCatalogSource(source: string): void;
  setCatalogSourceMeta(source: string, meta: { lastIndexedAt: number; skillCount: number; error: string | null }): void;
  replaceCatalogEntries(source: string, entries: Omit<CatalogEntry, "source" | "official">[]): void;
  listCatalogEntries(filter?: string): Omit<CatalogEntry, "official">[];
  upsertDriveAccount(a: {
    email: string; name: string | null; picture: string | null;
    refreshToken: string; accessToken: string | null; expiry: number | null; scope: string;
  }): DriveAccount;
  listDriveAccounts(): DriveAccountPublic[];
  getDriveAccount(id: string): DriveAccount | null;
  updateDriveTokens(id: string, t: { accessToken: string; expiry: number }): void;
  renameDriveAccount(id: string, label: string | null): void; // user-chosen name; null/"" → fall back to email
  deleteDriveAccount(id: string): void;
  // Google OAuth client creds, set from Settings (write-only secret). Both must be present to count
  // as configured; getDriveCredentials returns null otherwise. The secret never leaves the server.
  getDriveCredentials(): { clientId: string; clientSecret: string } | null;
  setDriveCredentials(c: { clientId: string; clientSecret: string }): void;
  clearDriveCredentials(): void;
  // Optional OAuth redirect-URI override (settings → env → derived). Lets the operator pin the
  // callback to a value registered in Google Cloud regardless of how the server is reached.
  getDriveRedirect(): string | null;
  setDriveRedirect(url: string | null): void;
}

export function createStore(path: string): Store {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(join(here, "schema.sql"), "utf8"));

  // Migrate older DBs: schema.sql's CREATE TABLE IF NOT EXISTS won't add a column to an
  // existing workspaces table, so add cardColor (the canvas card's own accent, independent
  // of the room-chrome `color`) when it's missing.
  const wsCols = db.prepare(`PRAGMA table_info(workspaces)`).all() as { name: string }[];
  if (!wsCols.some(c => c.name === "cardColor")) db.exec(`ALTER TABLE workspaces ADD COLUMN cardColor TEXT`);
  // `layout` is the per-workspace room layout (panel sizes, open/collapsed, active view) as an
  // opaque JSON blob — stored and returned verbatim; the web owns its shape. null = use defaults.
  if (!wsCols.some(c => c.name === "layout")) db.exec(`ALTER TABLE workspaces ADD COLUMN layout TEXT`);
  // `spaceId` is the owning virtual-desktop (see the spaces table); add it to older workspaces
  // tables. The boot migration below backfills every NULL to the Home space.
  if (!wsCols.some(c => c.name === "spaceId")) db.exec(`ALTER TABLE workspaces ADD COLUMN spaceId TEXT`);
  // `folderId` points a card at its owning canvas folder (folders table, created by schema.sql's
  // CREATE TABLE IF NOT EXISTS above). Older DBs lack the column; add it (null = loose on the canvas).
  if (!wsCols.some(c => c.name === "folderId")) db.exec(`ALTER TABLE workspaces ADD COLUMN folderId TEXT`);
  // `config` is the per-workspace wizard SpaceConfig (opaque JSON; null = no own picks). It seeds
  // ADDITIVELY on top of the owning space's config — see spaces/merge.ts. Add it to older tables.
  if (!wsCols.some(c => c.name === "config")) db.exec(`ALTER TABLE workspaces ADD COLUMN config TEXT`);
  // `chat` holds a blueprint's saved AI-assistant transcript (opaque JSON); add it to older
  // blueprints tables so reopening a pre-existing blueprint doesn't error on the missing column.
  const bpCols = db.prepare(`PRAGMA table_info(blueprints)`).all() as { name: string }[];
  if (!bpCols.some(c => c.name === "chat")) db.exec(`ALTER TABLE blueprints ADD COLUMN chat TEXT`);
  // `icon` is a codicon name shown left of a terminal's title (null = default terminal glyph); add
  // it to terminals tables created before this feature so listing them doesn't error.
  const tmCols = db.prepare(`PRAGMA table_info(terminals)`).all() as { name: string }[];
  if (!tmCols.some(c => c.name === "icon")) db.exec(`ALTER TABLE terminals ADD COLUMN icon TEXT`);
  // `titleAuto` (1/0) marks whether the tab name is auto-generated (still tracked to the running
  // agent session / placeholder) or locked by a user rename. Older rows default to 1 so the
  // auto-titler can correct any stale name; a user rename flips it to 0 and pins the name.
  if (!tmCols.some(c => c.name === "titleAuto")) db.exec(`ALTER TABLE terminals ADD COLUMN titleAuto INTEGER NOT NULL DEFAULT 1`);
  // `position` orders terminals within their workspace's list (drag-reorder). Older tables ordered by
  // createdAt alone; add the column, then backfill contiguous positions per workspace IN that same
  // createdAt order so the existing visible order is preserved exactly. Only on first add — never
  // re-runs, so it can't clobber a user's later custom order.
  if (!tmCols.some(c => c.name === "position")) {
    db.exec(`ALTER TABLE terminals ADD COLUMN position INTEGER NOT NULL DEFAULT 0`);
    const wsIds = db.prepare(`SELECT DISTINCT workspaceId FROM terminals`).all() as { workspaceId: string }[];
    const setPos = db.prepare(`UPDATE terminals SET position=? WHERE id=?`);
    for (const { workspaceId } of wsIds) {
      const rows = db.prepare(`SELECT id FROM terminals WHERE workspaceId=? ORDER BY createdAt`).all(workspaceId) as { id: string }[];
      rows.forEach((r, i) => setPos.run(i, r.id));
    }
  }
  // `background` is a space's per-canvas backdrop override (CanvasBackground as opaque JSON; null =
  // inherit the global default); add it to spaces tables created before this feature.
  const spCols = db.prepare(`PRAGMA table_info(spaces)`).all() as { name: string }[];
  if (!spCols.some(c => c.name === "background")) db.exec(`ALTER TABLE spaces ADD COLUMN background TEXT`);
  // `config` is the Space Creation Wizard's per-space SpaceConfig (opaque JSON; null = seed nothing);
  // add it to spaces tables created before the wizard existed.
  if (!spCols.some(c => c.name === "config")) db.exec(`ALTER TABLE spaces ADD COLUMN config TEXT`);

  // `official` is a user-set per-catalog-source flag (skills from it show the ✓ Official badge);
  // add it to catalog-source tables created before the badge existed.
  const scsCols = db.prepare(`PRAGMA table_info(skill_catalog_source)`).all() as { name: string }[];
  if (!scsCols.some(c => c.name === "official")) db.exec(`ALTER TABLE skill_catalog_source ADD COLUMN official INTEGER NOT NULL DEFAULT 0`);

  // `category` is the picker section a custom agent shows under ("Other" by default; "Detected agents"
  // is reserved for $PATH-detected built-ins and never chosen). Backfill older rows to 'Other'.
  const caCols = db.prepare(`PRAGMA table_info(custom_agents)`).all() as { name: string }[];
  if (!caCols.some(c => c.name === "category")) db.exec(`ALTER TABLE custom_agents ADD COLUMN category TEXT NOT NULL DEFAULT 'Other'`);

  // Notifications grew an agent/error/info `category` (the center's filter+color bucket) and a
  // workspaceId/terminalId deep-link target (agent notifications open the terminal that fired them).
  // Add them to tables created before the notification center became a synced history.
  const nfCols = db.prepare(`PRAGMA table_info(notifications)`).all() as { name: string }[];
  if (!nfCols.some(c => c.name === "category")) db.exec(`ALTER TABLE notifications ADD COLUMN category TEXT NOT NULL DEFAULT 'info'`);
  if (!nfCols.some(c => c.name === "workspaceId")) db.exec(`ALTER TABLE notifications ADD COLUMN workspaceId TEXT`);
  if (!nfCols.some(c => c.name === "terminalId")) db.exec(`ALTER TABLE notifications ADD COLUMN terminalId TEXT`);

  // Connected Drives grew a user-chosen `label` (rename a Drive in Settings → it shows in the Places
  // bar instead of the email). Add it to drive_account tables created before the rename feature.
  const daCols = db.prepare(`PRAGMA table_info(drive_account)`).all() as { name: string }[];
  if (daCols.length && !daCols.some(c => c.name === "label")) db.exec(`ALTER TABLE drive_account ADD COLUMN label TEXT`);
  // Share links grew presentation flags: `mirror` (push the owner's UI nav to the viewer) and `lock`
  // (make the viewer a passive spectator — mouse + terminal typing disabled). Older rows default to 0,
  // i.e. a plain full-access link that mirrors nothing and locks no one.
  const akCols = db.prepare(`PRAGMA table_info(access_keys)`).all() as { name: string }[];
  if (!akCols.some(c => c.name === "mirror")) db.exec(`ALTER TABLE access_keys ADD COLUMN mirror INTEGER NOT NULL DEFAULT 0`);
  if (!akCols.some(c => c.name === "lock")) db.exec(`ALTER TABLE access_keys ADD COLUMN "lock" INTEGER NOT NULL DEFAULT 0`);

  // Links + their folders gained a custom text color (right-click → color picker) after they shipped.
  const lkCols = db.prepare(`PRAGMA table_info(links)`).all() as { name: string }[];
  if (lkCols.length && !lkCols.some(c => c.name === "color")) db.exec(`ALTER TABLE links ADD COLUMN color TEXT`);
  const lfCols = db.prepare(`PRAGMA table_info(link_folders)`).all() as { name: string }[];
  if (lfCols.length && !lfCols.some(c => c.name === "color")) db.exec(`ALTER TABLE link_folders ADD COLUMN color TEXT`);

  // Folder→color memory, so a color survives terminating + re-adding a folder. Writing a
  // real color upserts it; clearing (null) forgets it. Read back on create when none given.
  const rememberColor = (folder: string, color: string | null) => {
    if (color) {
      db.prepare(`INSERT INTO workspace_colors (folder,color,updatedAt) VALUES (?,?,?)
        ON CONFLICT(folder) DO UPDATE SET color=excluded.color, updatedAt=excluded.updatedAt`)
        .run(folder, color, Date.now());
    } else {
      db.prepare(`DELETE FROM workspace_colors WHERE folder=?`).run(folder);
    }
  };
  const recallColor = (folder: string): string | null =>
    (db.prepare(`SELECT color FROM workspace_colors WHERE folder=?`).get(folder) as { color: string } | undefined)?.color ?? null;

  // Favorites tree helpers, shared across both tables (favorite_groups by parentId, favorites by
  // groupId). A NULL bucket key is the root, which a bound `?` can't match (NULL = NULL is never
  // true in SQL), so branch on null. `table`/`col` are fixed internal literals, never user input.
  type FavTable = "favorite_groups" | "favorites";
  type FavCol = "parentId" | "groupId";
  // Next append position: siblings stay contiguous 0..n-1, so the count is the next free slot.
  const countSiblings = (table: FavTable, col: FavCol, bucket: string | null): number => {
    const row = (bucket === null
      ? db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${col} IS NULL`).get()
      : db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${col}=?`).get(bucket)) as { c: number };
    return row.c;
  };
  // Rewrite a bucket's positions to contiguous 0..n-1 in current order, closing any gap a
  // delete/move left behind (which would otherwise drift the next append position).
  const renumberBucket = (table: FavTable, col: FavCol, bucket: string | null) => {
    const rows = (bucket === null
      ? db.prepare(`SELECT id FROM ${table} WHERE ${col} IS NULL ORDER BY position, createdAt`).all()
      : db.prepare(`SELECT id FROM ${table} WHERE ${col}=? ORDER BY position, createdAt`).all(bucket)) as { id: string }[];
    const upd = db.prepare(`UPDATE ${table} SET position=? WHERE id=?`);
    rows.forEach((r, i) => upd.run(i, r.id));
  };
  const favDupExists = (groupId: string | null, folder: string): boolean =>
    !!(groupId === null
      ? db.prepare(`SELECT 1 FROM favorites WHERE groupId IS NULL AND folder=?`).get(folder)
      : db.prepare(`SELECT 1 FROM favorites WHERE groupId=? AND folder=?`).get(groupId, folder));
  // Every group strictly below `rootId` (excludes rootId itself) — for cycle guards and cascade.
  const collectDescendantGroupIds = (rootId: string): Set<string> => {
    const out = new Set<string>();
    const stack = [rootId];
    while (stack.length) {
      const kids = db.prepare(`SELECT id FROM favorite_groups WHERE parentId=?`).all(stack.pop()!) as { id: string }[];
      for (const k of kids) if (!out.has(k.id)) { out.add(k.id); stack.push(k.id); }
    }
    return out;
  };

  // Workspaces store `config` (the per-workspace wizard picks) as opaque JSON; parse + normalize on
  // every read so callers see a SpaceConfig object (null on absent/corrupt). `layout` stays raw.
  const mapWorkspace = (row: any): Workspace | undefined => row ? {
    ...row,
    config: ((): SpaceConfig | null => {
      if (!row.config) return null;
      try { return normalizeSpaceConfig(JSON.parse(row.config)); } catch { return null; }
    })(),
  } : undefined;

  // Spaces store `background` as an opaque JSON string (or NULL); rows come back with that raw
  // string, so map every read through here to parse it into a CanvasBackground (null on absent/bad).
  const mapSpace = (row: any): Space => ({
    ...row,
    background: ((): CanvasBackground | null => {
      if (!row?.background) return null;
      try { return JSON.parse(row.background) as CanvasBackground; } catch { return null; }
    })(),
    // `config` is opaque JSON (or NULL); parse + normalize so a corrupt blob degrades safely.
    config: ((): SpaceConfig | null => {
      if (!row?.config) return null;
      try { return normalizeSpaceConfig(JSON.parse(row.config)); } catch { return null; }
    })(),
  });

  // Space presets store the SpaceConfig as opaque JSON in `config`; parse + normalize on read.
  const mapPreset = (row: any): SpacePreset => ({
    id: row.id, name: row.name, icon: row.icon ?? null,
    config: ((): SpaceConfig => {
      try { return normalizeSpaceConfig(JSON.parse(row.config)); } catch { return normalizeSpaceConfig(null); }
    })(),
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  });

  // Rewrite spaces' positions to contiguous 0..n-1 in current order (after a delete/move).
  const renumberSpaces = () => {
    const rows = db.prepare(`SELECT id FROM spaces ORDER BY position, createdAt`).all() as { id: string }[];
    const upd = db.prepare(`UPDATE spaces SET position=? WHERE id=?`);
    rows.forEach((r, i) => upd.run(i, r.id));
  };

  // Reminders/notifications store JSON columns (channels, recurrence) and integer booleans; map both
  // ways through these so the rest of the code deals in typed objects, never raw rows.
  const DEFAULT_CHANNELS: NotifyChannels = { inApp: true, pushover: false, speak: true };
  const parseChannels = (raw: string | null): NotifyChannels => {
    if (!raw) return { ...DEFAULT_CHANNELS };
    try { const c = JSON.parse(raw); return { inApp: !!c.inApp, pushover: !!c.pushover, speak: !!c.speak }; }
    catch { return { ...DEFAULT_CHANNELS }; }
  };
  const parseRecurrence = (raw: string | null): Recurrence | null => {
    if (!raw) return null;
    try {
      const r = JSON.parse(raw);
      if (!["daily", "weekly", "monthly", "yearly"].includes(r?.freq)) return null;
      return { freq: r.freq, interval: Number(r.interval) || 1, until: r.until ?? null, count: r.count ?? null };
    } catch { return null; }
  };
  const mapReminder = (row: any): Reminder => ({
    id: row.id, title: row.title, body: row.body, fireAt: row.fireAt,
    allDay: row.allDay === 1, endAt: row.endAt ?? null, leadMinutes: row.leadMinutes,
    color: row.color ?? null, imagePath: row.imagePath ?? null,
    channels: parseChannels(row.channels), level: row.level, priority: row.priority,
    recurrence: parseRecurrence(row.recurrence), status: row.status,
    snoozeUntil: row.snoozeUntil ?? null, firedAt: row.firedAt ?? null, wasMissed: row.wasMissed === 1,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  });
  const reminderRow = (r: Reminder) => ({
    id: r.id, title: r.title, body: r.body, fireAt: r.fireAt, allDay: r.allDay ? 1 : 0,
    endAt: r.endAt, leadMinutes: r.leadMinutes, color: r.color, imagePath: r.imagePath,
    channels: JSON.stringify(r.channels), level: r.level, priority: r.priority,
    recurrence: r.recurrence ? JSON.stringify(r.recurrence) : null, status: r.status,
    snoozeUntil: r.snoozeUntil, firedAt: r.firedAt, wasMissed: r.wasMissed ? 1 : 0,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  });
  const mapNotification = (r: any): AppNotification => ({
    id: r.id, reminderId: r.reminderId ?? null, title: r.title, body: r.body, level: r.level,
    category: (r.category ?? "info") as NotifyCategory,
    imagePath: r.imagePath ?? null, workspaceId: r.workspaceId ?? null, terminalId: r.terminalId ?? null,
    wasMissed: r.wasMissed === 1, pushover: r.pushover === 1,
    pushoverOk: r.pushoverOk === null || r.pushoverOk === undefined ? null : r.pushoverOk === 1,
    read: r.read === 1, firedAt: r.firedAt, createdAt: r.createdAt,
  });

  // Timesheet row mappers. Entries keep stoppedAt as null when running; catalog rows store archived
  // as 0/1, exposed as a boolean to the rest of the app.
  const mapTimeEntry = (r: any): TimeEntry => ({
    id: r.id, client: r.client, project: r.project, task: r.task, notes: r.notes,
    startedAt: r.startedAt, stoppedAt: r.stoppedAt ?? null, createdAt: r.createdAt, updatedAt: r.updatedAt,
  });
  const mapTimeCat = (r: any) => ({ ...r, archived: r.archived === 1 });

  // Catalog upserts: find a row by name (case-insensitive, trimmed) or create it. Used by start/create
  // (so an agent naming a brand-new client/project/task auto-fills the dropdowns) AND by the catalog
  // create endpoints (idempotent — POSTing the same name twice returns the existing row).
  const ensureClient = (name: string): TimeClient | null => {
    const n = (name ?? "").trim(); if (!n) return null;
    const found = db.prepare(`SELECT * FROM tt_clients WHERE name=? COLLATE NOCASE`).get(n) as any;
    if (found) return mapTimeCat(found);
    const now = Date.now();
    const position = (db.prepare(`SELECT COUNT(*) AS c FROM tt_clients`).get() as { c: number }).c;
    const row = { id: id("cl_"), name: n, archived: 0, position, createdAt: now, updatedAt: now };
    db.prepare(`INSERT INTO tt_clients (id,name,archived,position,createdAt,updatedAt) VALUES (@id,@name,@archived,@position,@createdAt,@updatedAt)`).run(row);
    return mapTimeCat(row);
  };
  const ensureProject = (clientId: string, name: string): TimeProject | null => {
    const n = (name ?? "").trim(); if (!n || !clientId) return null;
    const found = db.prepare(`SELECT * FROM tt_projects WHERE clientId=? AND name=? COLLATE NOCASE`).get(clientId, n) as any;
    if (found) return mapTimeCat(found);
    const now = Date.now();
    const position = (db.prepare(`SELECT COUNT(*) AS c FROM tt_projects WHERE clientId=?`).get(clientId) as { c: number }).c;
    const row = { id: id("pj_"), clientId, name: n, archived: 0, position, createdAt: now, updatedAt: now };
    db.prepare(`INSERT INTO tt_projects (id,clientId,name,archived,position,createdAt,updatedAt) VALUES (@id,@clientId,@name,@archived,@position,@createdAt,@updatedAt)`).run(row);
    return mapTimeCat(row);
  };
  const ensureTask = (name: string): TimeTask | null => {
    const n = (name ?? "").trim(); if (!n) return null;
    const found = db.prepare(`SELECT * FROM tt_tasks WHERE name=? COLLATE NOCASE`).get(n) as any;
    if (found) return mapTimeCat(found);
    const now = Date.now();
    const position = (db.prepare(`SELECT COUNT(*) AS c FROM tt_tasks`).get() as { c: number }).c;
    const row = { id: id("tk_"), name: n, archived: 0, position, createdAt: now, updatedAt: now };
    db.prepare(`INSERT INTO tt_tasks (id,name,archived,position,createdAt,updatedAt) VALUES (@id,@name,@archived,@position,@createdAt,@updatedAt)`).run(row);
    return mapTimeCat(row);
  };
  // Auto-add an entry's client, its project (under that client), and its task to the catalog.
  const ensureCatalog = (client?: string, project?: string, task?: string) => {
    const c = ensureClient(client ?? "");
    if (c && project) ensureProject(c.id, project);
    ensureTask(task ?? "");
  };

  const store: Store = {
    createWorkspace(w) {
      const now = Date.now();
      const color = w.color ?? recallColor(w.folder);
      const spaceId = w.spaceId ?? store.getHomeSpaceId() ?? null;
      const ws: Workspace = { id: id("ws_"), cardColor: null, layout: null, folderId: null, config: null, createdAt: now, updatedAt: now, ...w, color, x: w.x ?? 0, y: w.y ?? 0, spaceId };
      // `config` is a SpaceConfig object on the row but an opaque JSON string in the column — serialize.
      db.prepare(`INSERT INTO workspaces (id,name,folder,launchCommand,color,cardColor,layout,spaceId,config,x,y,createdAt,updatedAt)
        VALUES (@id,@name,@folder,@launchCommand,@color,@cardColor,@layout,@spaceId,@config,@x,@y,@createdAt,@updatedAt)`)
        .run({ ...ws, config: ws.config ? JSON.stringify(ws.config) : null });
      if (color) rememberColor(ws.folder, color);
      return ws;
    },
    getWorkspace(wid) { return mapWorkspace(db.prepare(`SELECT * FROM workspaces WHERE id=?`).get(wid)); },
    listWorkspaces() { return (db.prepare(`SELECT * FROM workspaces ORDER BY createdAt`).all() as any[]).map(mapWorkspace) as Workspace[]; },
    updateWorkspace(wid, patch) {
      const cur = this.getWorkspace(wid); if (!cur) return;
      const next = { ...cur, ...patch, updatedAt: Date.now() };
      db.prepare(`UPDATE workspaces SET name=@name,folder=@folder,launchCommand=@launchCommand,color=@color,cardColor=@cardColor,layout=@layout,spaceId=@spaceId,folderId=@folderId,config=@config,x=@x,y=@y,updatedAt=@updatedAt WHERE id=@id`)
        .run({ ...next, config: next.config ? JSON.stringify(next.config) : null });
      if ("color" in patch) rememberColor(next.folder, next.color);
    },
    deleteWorkspace(wid) { db.prepare(`DELETE FROM workspaces WHERE id=?`).run(wid); },
    createFolder(f) {
      const now = Date.now();
      const folder: Folder = {
        id: id("fld_"), spaceId: f.spaceId ?? store.getHomeSpaceId() ?? null,
        name: f.name ?? "", x: f.x, y: f.y, createdAt: now, updatedAt: now,
      };
      db.prepare(`INSERT INTO folders (id,spaceId,name,x,y,createdAt,updatedAt)
        VALUES (@id,@spaceId,@name,@x,@y,@createdAt,@updatedAt)`).run(folder);
      // Drop the seed members (the cards you grouped) into the new folder atomically.
      if (f.memberIds?.length) {
        const upd = db.prepare(`UPDATE workspaces SET folderId=?, updatedAt=? WHERE id=?`);
        db.transaction(() => { for (const wid of f.memberIds!) upd.run(folder.id, now, wid); })();
      }
      return folder;
    },
    getFolder(fid) { return db.prepare(`SELECT * FROM folders WHERE id=?`).get(fid) as Folder | undefined; },
    listFolders() { return db.prepare(`SELECT * FROM folders ORDER BY createdAt`).all() as Folder[]; },
    updateFolder(fid, patch) {
      const cur = this.getFolder(fid); if (!cur) return;
      const next = { ...cur, ...patch, updatedAt: Date.now() };
      db.prepare(`UPDATE folders SET spaceId=@spaceId,name=@name,x=@x,y=@y,updatedAt=@updatedAt WHERE id=@id`).run(next);
    },
    deleteFolder(fid) {
      // Dissolve: members return to the canvas (folderId cleared) before the folder row is dropped.
      db.transaction(() => {
        db.prepare(`UPDATE workspaces SET folderId=NULL, updatedAt=? WHERE folderId=?`).run(Date.now(), fid);
        db.prepare(`DELETE FROM folders WHERE id=?`).run(fid);
      })();
    },
    createSpace(s) {
      const now = Date.now();
      const config = s.config ?? null;
      const row: Space = {
        id: id("sp_"), name: s.name, icon: s.icon ?? null, color: s.color ?? null, background: null,
        config,
        position: (db.prepare(`SELECT COUNT(*) AS c FROM spaces`).get() as { c: number }).c,
        createdAt: now, updatedAt: now,
      };
      db.prepare(`INSERT INTO spaces (id,name,icon,color,config,position,createdAt,updatedAt)
        VALUES (@id,@name,@icon,@color,@config,@position,@createdAt,@updatedAt)`)
        .run({ id: row.id, name: row.name, icon: row.icon, color: row.color, config: config ? JSON.stringify(config) : null, position: row.position, createdAt: row.createdAt, updatedAt: row.updatedAt });
      return row;
    },
    getSpace(sid) {
      const row = db.prepare(`SELECT * FROM spaces WHERE id=?`).get(sid);
      return row ? mapSpace(row) : undefined;
    },
    listSpaces() { return (db.prepare(`SELECT * FROM spaces ORDER BY position, createdAt`).all() as any[]).map(mapSpace); },
    updateSpace(sid, patch) {
      const cur = store.getSpace(sid); if (!cur) return;
      const next = { ...cur, ...patch, updatedAt: Date.now() };
      // `background` + `config` are JSON columns — serialize the object (or keep NULL); never bind raw.
      const bg = "background" in patch ? patch.background : cur.background;
      const config = "config" in patch ? patch.config : cur.config;
      db.prepare(`UPDATE spaces SET name=@name, icon=@icon, color=@color, background=@background, config=@config, updatedAt=@updatedAt WHERE id=@id`)
        .run({ id: sid, name: next.name, icon: next.icon, color: next.color, background: bg ? JSON.stringify(bg) : null, config: config ? JSON.stringify(config) : null, updatedAt: next.updatedAt });
    },
    moveSpace(sid, index) {
      const cur = store.getSpace(sid); if (!cur) return;
      db.transaction(() => {
        const rest = db.prepare(`SELECT id FROM spaces WHERE id<>? ORDER BY position, createdAt`).all(sid) as { id: string }[];
        const ids = rest.map(r => r.id);
        ids.splice(Math.max(0, Math.min(index, ids.length)), 0, sid);
        const upd = db.prepare(`UPDATE spaces SET position=? WHERE id=?`);
        ids.forEach((id, i) => upd.run(i, id));
      })();
    },
    deleteSpace(sid) {
      const all = store.listSpaces();
      if (sid === store.getHomeSpaceId()) return false;   // Home is permanent
      if (all.length <= 1) return false;                  // never delete the last space
      const idx = all.findIndex(s => s.id === sid);
      if (idx < 0) return false;
      const target = all[idx - 1] ?? all[idx + 1];        // previous by position, or next if it was first
      db.transaction(() => {
        // Dissolve this space's folders first: clear membership and drop the folder rows, so the
        // reassigned cards land loose on the target space (folders carry a now-stale space + position).
        db.prepare(`UPDATE workspaces SET folderId=NULL WHERE spaceId=?`).run(sid);
        db.prepare(`DELETE FROM folders WHERE spaceId=?`).run(sid);
        store.reassignWorkspaces(sid, target.id);
        db.prepare(`DELETE FROM spaces WHERE id=?`).run(sid);
        renumberSpaces();
      })();
      return true;
    },
    reassignWorkspaces(fromSpaceId, toSpaceId) {
      db.prepare(`UPDATE workspaces SET spaceId=?, updatedAt=? WHERE spaceId=?`).run(toSpaceId, Date.now(), fromSpaceId);
    },
    reassignTerminals(fromWorkspaceId, toWorkspaceId) {
      // Re-point terminal rows only; tmuxSession is left untouched so attach/reconcile are unaffected.
      db.prepare(`UPDATE terminals SET workspaceId=? WHERE workspaceId=?`).run(toWorkspaceId, fromWorkspaceId);
    },
    listSpacePresets() {
      return (db.prepare(`SELECT * FROM space_presets ORDER BY name`).all() as any[]).map(mapPreset);
    },
    getSpacePreset(pid) {
      const row = db.prepare(`SELECT * FROM space_presets WHERE id=?`).get(pid);
      return row ? mapPreset(row) : undefined;
    },
    createSpacePreset(p) {
      const now = Date.now();
      const row: SpacePreset = { id: id("spt_"), name: p.name, icon: p.icon ?? null, config: p.config, createdAt: now, updatedAt: now };
      db.prepare(`INSERT INTO space_presets (id,name,icon,config,createdAt,updatedAt)
        VALUES (@id,@name,@icon,@config,@createdAt,@updatedAt)`)
        .run({ id: row.id, name: row.name, icon: row.icon, config: JSON.stringify(row.config), createdAt: now, updatedAt: now });
      return row;
    },
    updateSpacePreset(pid, patch) {
      const cur = store.getSpacePreset(pid); if (!cur) return undefined;
      const next: SpacePreset = { ...cur, ...patch, updatedAt: Date.now() };
      db.prepare(`UPDATE space_presets SET name=@name, icon=@icon, config=@config, updatedAt=@updatedAt WHERE id=@id`)
        .run({ id: pid, name: next.name, icon: next.icon, config: JSON.stringify(next.config), updatedAt: next.updatedAt });
      return next;
    },
    deleteSpacePreset(pid) { db.prepare(`DELETE FROM space_presets WHERE id=?`).run(pid); },
    getHomeSpaceId() {
      const row = db.prepare(`SELECT value FROM settings WHERE key='homeSpaceId'`).get() as { value: string } | undefined;
      return row && row.value !== "null" ? row.value : undefined;
    },
    getDesktopWorkspaceId() {
      const row = db.prepare(`SELECT value FROM settings WHERE key='desktopWorkspaceId'`).get() as { value: string } | undefined;
      return row && row.value !== "null" ? row.value : undefined;
    },
    createTerminal(t) {
      // New terminals append to the end of their workspace's list — positions stay contiguous, so the
      // current count is the next free slot. Fresh tabs start auto-titled (titleAuto=1).
      const position = (db.prepare(`SELECT COUNT(*) AS c FROM terminals WHERE workspaceId=?`).get(t.workspaceId) as { c: number }).c;
      const term: Terminal = { id: id("tm_"), createdAt: Date.now(), icon: null, position, titleAuto: true, ...t };
      db.prepare(`INSERT INTO terminals (id,workspaceId,title,color,icon,tmuxSession,launchCommandOverride,position,createdAt,titleAuto)
        VALUES (@id,@workspaceId,@title,@color,@icon,@tmuxSession,@launchCommandOverride,@position,@createdAt,@titleAuto)`)
        .run({ ...term, titleAuto: 1 }); // bind 1, not the boolean (better-sqlite3 won't bind booleans)
      return term;
    },
    getTerminal(tid) { const r = db.prepare(`SELECT * FROM terminals WHERE id=?`).get(tid); return r ? rowToTerminal(r) : undefined; },
    listTerminals(wid) { return (db.prepare(`SELECT * FROM terminals WHERE workspaceId=? ORDER BY position, createdAt`).all(wid)).map(rowToTerminal); },
    listAllTerminals() { return (db.prepare(`SELECT * FROM terminals ORDER BY createdAt`).all()).map(rowToTerminal); },
    updateTerminal(tid, patch) {
      const cur = this.getTerminal(tid); if (!cur) return;
      const next = { ...cur, ...patch };
      // A user rename (title set without `auto`) locks the tab; an auto-titler update leaves the
      // lock as-is. titleAuto is stored as 1/0 (better-sqlite3 doesn't bind booleans).
      const titleAuto = patch.title !== undefined && !patch.auto ? 0 : (cur.titleAuto ? 1 : 0);
      db.prepare(`UPDATE terminals SET title=@title,color=@color,icon=@icon,titleAuto=@titleAuto WHERE id=@id`)
        .run({ ...next, titleAuto });
    },
    setTerminalSession(tid, tmuxSession) {
      db.prepare(`UPDATE terminals SET tmuxSession=? WHERE id=?`).run(tmuxSession, tid);
    },
    moveTerminal(tid, index) {
      const cur = this.getTerminal(tid); if (!cur) return;
      // Reorder within the terminal's own workspace: pull it out, splice it in at `index`, then
      // write contiguous positions 0..n-1 (mirrors moveSpace, scoped by workspaceId).
      db.transaction(() => {
        const rest = db.prepare(`SELECT id FROM terminals WHERE workspaceId=? AND id<>? ORDER BY position, createdAt`)
          .all(cur.workspaceId, tid) as { id: string }[];
        const ids = rest.map(r => r.id);
        ids.splice(Math.max(0, Math.min(index, ids.length)), 0, tid);
        const upd = db.prepare(`UPDATE terminals SET position=? WHERE id=?`);
        ids.forEach((id, i) => upd.run(i, id));
      })();
    },
    deleteTerminal(tid) {
      const cur = this.getTerminal(tid);
      db.prepare(`DELETE FROM terminals WHERE id=?`).run(tid);
      if (!cur) return;
      // Close the gap the delete left so positions stay contiguous (keeps the next append slot right).
      const rows = db.prepare(`SELECT id FROM terminals WHERE workspaceId=? ORDER BY position, createdAt`)
        .all(cur.workspaceId) as { id: string }[];
      const upd = db.prepare(`UPDATE terminals SET position=? WHERE id=?`);
      rows.forEach((r, i) => upd.run(i, r.id));
    },
    getSettings() {
      const rows = db.prepare(`SELECT key,value FROM settings`).all() as { key: string; value: string }[];
      const s: any = { ...DEFAULT_SETTINGS };
      for (const r of rows) { if (r.key === "aiConfig" || r.key === "betterComments" || r.key === "breaks" || r.key === "copilot" || r.key === "keptVoices" || r.key === "homeSpaceId" || r.key === "desktopWorkspaceId" || r.key === "canvasBackground" || r.key === "stageDock" || r.key === "drive.clientId" || r.key === "drive.clientSecret" || r.key === "drive.redirect") continue; s[r.key] = parseSetting(r.key, r.value); }
      return s as Settings;
    },
    setSettings(patch) {
      const up = db.prepare(`INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
      for (const [k, v] of Object.entries(patch)) up.run(k, v === null ? "null" : String(v));
    },
    getCanvasBackground() {
      const row = db.prepare(`SELECT value FROM settings WHERE key='canvasBackground'`).get() as { value: string } | undefined;
      if (!row) return { ...DEFAULT_CANVAS_BG };
      try { return { ...DEFAULT_CANVAS_BG, ...(JSON.parse(row.value) as Partial<CanvasBackground>) }; }
      catch { return { ...DEFAULT_CANVAS_BG }; }
    },
    setCanvasBackground(bg) {
      db.prepare(`INSERT INTO settings (key,value) VALUES ('canvasBackground',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
        .run(JSON.stringify(bg));
    },
    getStageDock() {
      const row = db.prepare(`SELECT value FROM settings WHERE key='stageDock'`).get() as { value: string } | undefined;
      if (!row) return { ...DEFAULT_STAGE_DOCK };
      try { return { ...DEFAULT_STAGE_DOCK, ...(JSON.parse(row.value) as Partial<StageDock>) }; }
      catch { return { ...DEFAULT_STAGE_DOCK }; }
    },
    setStageDock(dock) {
      db.prepare(`INSERT INTO settings (key,value) VALUES ('stageDock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
        .run(JSON.stringify(dock));
    },
    listWallpapers() { return db.prepare(`SELECT id,name,createdAt FROM wallpapers ORDER BY createdAt DESC`).all() as Wallpaper[]; },
    getWallpaper(wid) { return db.prepare(`SELECT id,name,dataUrl,createdAt FROM wallpapers WHERE id=?`).get(wid) as WallpaperData | undefined; },
    createWallpaper(w) {
      const wp: WallpaperData = { id: id("wp_"), name: w.name, dataUrl: w.dataUrl, createdAt: Date.now() };
      db.prepare(`INSERT INTO wallpapers (id,name,dataUrl,createdAt) VALUES (@id,@name,@dataUrl,@createdAt)`).run(wp);
      return { id: wp.id, name: wp.name, createdAt: wp.createdAt };
    },
    deleteWallpaper(wid) { db.prepare(`DELETE FROM wallpapers WHERE id=?`).run(wid); },
    listCustomAgents() { return db.prepare(`SELECT * FROM custom_agents ORDER BY createdAt`).all() as CustomAgent[]; },
    createCustomAgent(a) {
      const agent: CustomAgent = { id: id("ag_"), createdAt: Date.now(), ...a };
      db.prepare(`INSERT INTO custom_agents (id,name,command,icon,category,createdAt)
        VALUES (@id,@name,@command,@icon,@category,@createdAt)`).run(agent);
      return agent;
    },
    deleteCustomAgent(aid) { db.prepare(`DELETE FROM custom_agents WHERE id=?`).run(aid); },
    getAiConfig() {
      const row = db.prepare(`SELECT value FROM settings WHERE key='aiConfig'`).get() as { value: string } | undefined;
      if (!row) return { ...EMPTY_AI_CONFIG };
      try { return JSON.parse(row.value) as AiConfig; } catch { return { ...EMPTY_AI_CONFIG }; }
    },
    setAiConfig(c) {
      db.prepare(`INSERT INTO settings (key,value) VALUES ('aiConfig',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
        .run(JSON.stringify(c));
    },
    getBetterComments() {
      const row = db.prepare(`SELECT value FROM settings WHERE key='betterComments'`).get() as { value: string } | undefined;
      if (!row) return structuredClone(DEFAULT_BETTER_COMMENTS);
      try {
        const parsed = JSON.parse(row.value) as Partial<BetterCommentsConfig>;
        if (typeof parsed?.enabled !== "boolean" || !Array.isArray(parsed?.tags)) return structuredClone(DEFAULT_BETTER_COMMENTS);
        return { enabled: parsed.enabled, tags: parsed.tags };
      } catch { return structuredClone(DEFAULT_BETTER_COMMENTS); }
    },
    setBetterComments(c) {
      db.prepare(`INSERT INTO settings (key,value) VALUES ('betterComments',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
        .run(JSON.stringify(c));
    },
    getBreaks() {
      const row = db.prepare(`SELECT value FROM settings WHERE key='breaks'`).get() as { value: string } | undefined;
      if (!row) return { ...DEFAULT_BREAKS };
      try {
        const p = JSON.parse(row.value) as Partial<BreakSettings>;
        // Merge over the defaults field-by-field so a partial/older blob never yields undefined fields.
        return {
          enabled: typeof p.enabled === "boolean" ? p.enabled : DEFAULT_BREAKS.enabled,
          intervalMinutes: Number.isFinite(p.intervalMinutes) ? Number(p.intervalMinutes) : DEFAULT_BREAKS.intervalMinutes,
          durationMinutes: Number.isFinite(p.durationMinutes) ? Number(p.durationMinutes) : DEFAULT_BREAKS.durationMinutes,
          pauseWhenHidden: typeof p.pauseWhenHidden === "boolean" ? p.pauseWhenHidden : DEFAULT_BREAKS.pauseWhenHidden,
          preWarnSeconds: Number.isFinite(p.preWarnSeconds) ? Number(p.preWarnSeconds) : DEFAULT_BREAKS.preWarnSeconds,
          allowSkip: typeof p.allowSkip === "boolean" ? p.allowSkip : DEFAULT_BREAKS.allowSkip,
          speak: typeof p.speak === "boolean" ? p.speak : DEFAULT_BREAKS.speak,
        };
      } catch { return { ...DEFAULT_BREAKS }; }
    },
    setBreaks(b) {
      db.prepare(`INSERT INTO settings (key,value) VALUES ('breaks',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
        .run(JSON.stringify(b));
    },
    getCopilotSettings() {
      const row = db.prepare(`SELECT value FROM settings WHERE key='copilot'`).get() as { value: string } | undefined;
      if (!row) return { ...DEFAULT_COPILOT_SETTINGS };
      try {
        const p = JSON.parse(row.value) as Partial<CopilotSettings>;
        // Merge over defaults field-by-field so a partial/older blob never yields undefined fields.
        return {
          enabled: typeof p.enabled === "boolean" ? p.enabled : DEFAULT_COPILOT_SETTINGS.enabled,
          defaultEngine: typeof p.defaultEngine === "string" ? p.defaultEngine : DEFAULT_COPILOT_SETTINGS.defaultEngine,
          reportChannels: Array.isArray(p.reportChannels)
            ? p.reportChannels.filter((c): c is CopilotSettings["reportChannels"][number] => (COPILOT_REPORT_CHANNELS as readonly string[]).includes(c as string))
            : [...DEFAULT_COPILOT_SETTINGS.reportChannels],
          confirmDangerous: typeof p.confirmDangerous === "boolean" ? p.confirmDangerous : DEFAULT_COPILOT_SETTINGS.confirmDangerous,
          orbEnabled: typeof p.orbEnabled === "boolean" ? p.orbEnabled : DEFAULT_COPILOT_SETTINGS.orbEnabled,
          orbPosition: (COPILOT_ORB_POSITIONS as readonly string[]).includes(p.orbPosition as string) ? p.orbPosition! : DEFAULT_COPILOT_SETTINGS.orbPosition,
        };
      } catch { return { ...DEFAULT_COPILOT_SETTINGS }; }
    },
    setCopilotSettings(s) {
      db.prepare(`INSERT INTO settings (key,value) VALUES ('copilot',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
        .run(JSON.stringify(s));
    },
    createCopilotConversation(title = "") {
      const now = Date.now();
      const c: CopilotConversation = { id: id("co_"), title, createdAt: now, updatedAt: now };
      db.prepare(`INSERT INTO copilot_conversations (id,title,createdAt,updatedAt) VALUES (@id,@title,@createdAt,@updatedAt)`).run(c);
      return c;
    },
    listCopilotConversations() {
      return db.prepare(`SELECT * FROM copilot_conversations ORDER BY updatedAt DESC, createdAt DESC`).all() as CopilotConversation[];
    },
    getCopilotConversation(cid) {
      return db.prepare(`SELECT * FROM copilot_conversations WHERE id=?`).get(cid) as CopilotConversation | undefined;
    },
    updateCopilotConversation(cid, patch) {
      if (patch.title === undefined) return;
      db.prepare(`UPDATE copilot_conversations SET title=?, updatedAt=? WHERE id=?`).run(patch.title, Date.now(), cid);
    },
    touchCopilotConversation(cid) {
      db.prepare(`UPDATE copilot_conversations SET updatedAt=? WHERE id=?`).run(Date.now(), cid);
    },
    deleteCopilotConversation(cid) {
      db.prepare(`DELETE FROM copilot_conversations WHERE id=?`).run(cid);
    },
    addCopilotMessage(m) {
      const row: CopilotStoredMessage = { id: id("cm_"), conversationId: m.conversationId, role: m.role, content: m.content, createdAt: Date.now() };
      db.prepare(`INSERT INTO copilot_messages (id,conversationId,role,content,createdAt) VALUES (@id,@conversationId,@role,@content,@createdAt)`).run(row);
      return row;
    },
    listCopilotMessages(cid) {
      return db.prepare(`SELECT id,conversationId,role,content,createdAt FROM copilot_messages WHERE conversationId=? ORDER BY rowid ASC`).all(cid) as CopilotStoredMessage[];
    },
    getCopilotSkillState(sid) {
      const row = db.prepare(`SELECT enabled,settings FROM copilot_skills WHERE id=?`).get(sid) as { enabled: number; settings: string } | undefined;
      if (!row) return undefined;
      let settings: Record<string, unknown> = {};
      try { const p = JSON.parse(row.settings); if (p && typeof p === "object") settings = p; } catch { /* default {} */ }
      return { enabled: row.enabled === 1, settings };
    },
    setCopilotSkillState(sid, patch) {
      const cur = this.getCopilotSkillState(sid) ?? { enabled: false, settings: {} };
      const next = {
        enabled: patch.enabled ?? cur.enabled,
        settings: patch.settings ?? cur.settings,
      };
      db.prepare(`INSERT INTO copilot_skills (id,enabled,settings) VALUES (?,?,?)
        ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled, settings=excluded.settings`)
        .run(sid, next.enabled ? 1 : 0, JSON.stringify(next.settings));
    },
    createSkillAccount(a) {
      const now = Date.now();
      const id2 = id("ca_");
      db.prepare(`INSERT INTO copilot_skill_accounts (id,skillId,label,provider,config,secret,createdAt)
        VALUES (?,?,?,?,?,?,?)`).run(id2, a.skillId, a.label, a.provider, JSON.stringify(a.config ?? {}), a.secret ?? "", now);
      return { id: id2, skillId: a.skillId, label: a.label, provider: a.provider, config: a.config ?? {}, hasSecret: !!a.secret, createdAt: now };
    },
    listSkillAccounts(skillId) {
      const rows = db.prepare(`SELECT id,skillId,label,provider,config,secret,createdAt FROM copilot_skill_accounts WHERE skillId=? ORDER BY createdAt`).all(skillId) as any[];
      return rows.map(rowToAccountPublic);
    },
    getSkillAccountSecret(aid) {
      const r = db.prepare(`SELECT id,skillId,label,provider,config,secret,createdAt FROM copilot_skill_accounts WHERE id=?`).get(aid) as any;
      if (!r) return undefined;
      return { id: r.id, skillId: r.skillId, label: r.label, provider: r.provider, config: parseConfig(r.config), secret: r.secret, createdAt: r.createdAt };
    },
    updateSkillAccount(aid, patch) {
      const r = db.prepare(`SELECT id,skillId,label,provider,config,secret,createdAt FROM copilot_skill_accounts WHERE id=?`).get(aid) as any;
      if (!r) return undefined;
      const label = patch.label ?? r.label;
      const config = patch.config ? JSON.stringify(patch.config) : r.config;
      const secret = patch.secret !== undefined ? patch.secret : r.secret; // "" clears, undefined keeps
      db.prepare(`UPDATE copilot_skill_accounts SET label=?, config=?, secret=? WHERE id=?`).run(label, config, secret, aid);
      return rowToAccountPublic({ ...r, label, config, secret });
    },
    deleteSkillAccount(aid) {
      db.prepare(`DELETE FROM copilot_skill_accounts WHERE id=?`).run(aid);
    },
    createCopilotJob(j) {
      const now = Date.now();
      const job: CopilotJob = {
        id: id("cj_"), title: j.title ?? "", tool: j.tool, args: j.args ?? {},
        intervalSec: j.intervalSec, reportMode: j.reportMode ?? "on-change", enabled: true,
        nextRun: j.nextRun ?? now + j.intervalSec * 1000, lastRun: null, lastSummary: null,
        createdAt: now, updatedAt: now,
      };
      db.prepare(`INSERT INTO copilot_jobs (id,title,tool,args,intervalSec,reportMode,enabled,nextRun,lastRun,lastSummary,createdAt,updatedAt)
        VALUES (@id,@title,@tool,@args,@intervalSec,@reportMode,1,@nextRun,NULL,NULL,@createdAt,@updatedAt)`)
        .run({ ...job, args: JSON.stringify(job.args) });
      return job;
    },
    listCopilotJobs() {
      return (db.prepare(`SELECT * FROM copilot_jobs ORDER BY createdAt DESC`).all() as any[]).map(rowToJob);
    },
    getCopilotJob(jid) {
      const r = db.prepare(`SELECT * FROM copilot_jobs WHERE id=?`).get(jid) as any;
      return r ? rowToJob(r) : undefined;
    },
    updateCopilotJob(jid, patch) {
      const cur = this.getCopilotJob(jid);
      if (!cur) return undefined;
      const next: CopilotJob = {
        ...cur,
        title: patch.title ?? cur.title,
        args: patch.args ?? cur.args,
        intervalSec: patch.intervalSec ?? cur.intervalSec,
        reportMode: patch.reportMode ?? cur.reportMode,
        enabled: patch.enabled ?? cur.enabled,
        nextRun: patch.nextRun ?? cur.nextRun,
        updatedAt: Date.now(),
      };
      db.prepare(`UPDATE copilot_jobs SET title=@title, args=@args, intervalSec=@intervalSec, reportMode=@reportMode, enabled=@enabled, nextRun=@nextRun, updatedAt=@updatedAt WHERE id=@id`)
        .run({ id: jid, title: next.title, args: JSON.stringify(next.args), intervalSec: next.intervalSec, reportMode: next.reportMode, enabled: next.enabled ? 1 : 0, nextRun: next.nextRun, updatedAt: next.updatedAt });
      return next;
    },
    deleteCopilotJob(jid) {
      db.prepare(`DELETE FROM copilot_jobs WHERE id=?`).run(jid);
    },
    dueCopilotJobs(now) {
      return (db.prepare(`SELECT * FROM copilot_jobs WHERE enabled=1 AND nextRun<=? ORDER BY nextRun`).all(now) as any[]).map(rowToJob);
    },
    markCopilotJobRun(jid, opts) {
      db.prepare(`UPDATE copilot_jobs SET lastRun=?, nextRun=?, lastSummary=?, updatedAt=? WHERE id=?`)
        .run(opts.now, opts.nextRun, opts.summary, Date.now(), jid);
    },
    createMcpServer(s) {
      const now = Date.now();
      const id_ = id("mc_");
      db.prepare(`INSERT INTO copilot_mcp_servers (id,label,transport,command,url,env,enabled,tools,status,lastError,createdAt,updatedAt)
        VALUES (@id,@label,@transport,@command,@url,@env,1,'[]','unknown',NULL,@now,@now)`)
        .run({ id: id_, label: s.label, transport: s.transport, command: JSON.stringify(s.command ?? []), url: s.url ?? null, env: JSON.stringify(s.env ?? {}), now });
      return this.getMcpServer(id_)!;
    },
    listMcpServers() {
      return (db.prepare(`SELECT * FROM copilot_mcp_servers ORDER BY createdAt DESC`).all() as any[]).map(rowToMcpPublic);
    },
    getMcpServer(mid) {
      const r = db.prepare(`SELECT * FROM copilot_mcp_servers WHERE id=?`).get(mid) as any;
      return r ? rowToMcpPublic(r) : undefined;
    },
    getMcpServerConfig(mid) {
      const r = db.prepare(`SELECT * FROM copilot_mcp_servers WHERE id=?`).get(mid) as any;
      return r ? rowToMcpConfig(r) : undefined;
    },
    updateMcpServer(mid, patch) {
      const r = db.prepare(`SELECT * FROM copilot_mcp_servers WHERE id=?`).get(mid) as any;
      if (!r) return undefined;
      const next = {
        label: patch.label ?? r.label,
        command: JSON.stringify(patch.command ?? JSON.parse(r.command ?? "[]")),
        url: patch.url !== undefined ? patch.url : r.url,
        env: JSON.stringify(patch.env ?? parseConfig(r.env)),
        enabled: patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : r.enabled,
        updatedAt: Date.now(),
      };
      db.prepare(`UPDATE copilot_mcp_servers SET label=@label, command=@command, url=@url, env=@env, enabled=@enabled, updatedAt=@updatedAt WHERE id=@id`)
        .run({ id: mid, ...next });
      return this.getMcpServer(mid);
    },
    setMcpServerTools(mid, tools, status, lastError) {
      db.prepare(`UPDATE copilot_mcp_servers SET tools=?, status=?, lastError=?, updatedAt=? WHERE id=?`)
        .run(JSON.stringify(tools), status, lastError, Date.now(), mid);
    },
    deleteMcpServer(mid) {
      db.prepare(`DELETE FROM copilot_mcp_servers WHERE id=?`).run(mid);
    },
    getKeptVoices() {
      const row = db.prepare(`SELECT value FROM settings WHERE key='keptVoices'`).get() as { value: string } | undefined;
      if (!row) return [];
      try {
        const v = JSON.parse(row.value);
        return Array.isArray(v) ? (v as KeptVoice[]) : [];
      } catch { return []; }
    },
    setKeptVoices(voices) {
      db.prepare(`INSERT INTO settings (key,value) VALUES ('keptVoices',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
        .run(JSON.stringify(voices));
    },
    getClaudePrefs() {
      const rows = db.prepare(`SELECT sessionId,pinned,color FROM claude_session_prefs`)
        .all() as { sessionId: string; pinned: number; color: string | null }[];
      const out: Record<string, { pinned: boolean; color: string | null }> = {};
      for (const r of rows) out[r.sessionId] = { pinned: r.pinned === 1, color: r.color ?? null };
      return out;
    },
    setClaudePref(sessionId, patch) {
      // Upsert touching only the provided fields: insert a fresh row with the patched values
      // over the defaults, or update just the columns present in `patch` on conflict.
      const sets: string[] = [];
      if ("pinned" in patch) sets.push("pinned=excluded.pinned");
      if ("color" in patch) sets.push("color=excluded.color");
      if (sets.length === 0) return;
      db.prepare(`INSERT INTO claude_session_prefs (sessionId,pinned,color) VALUES (?,?,?)
        ON CONFLICT(sessionId) DO UPDATE SET ${sets.join(",")}`)
        .run(sessionId, patch.pinned ? 1 : 0, patch.color ?? null);
    },
    deleteClaudePref(sessionId) { db.prepare(`DELETE FROM claude_session_prefs WHERE sessionId=?`).run(sessionId); },
    listBookmarks(folder) {
      return db.prepare(`SELECT * FROM bookmarks WHERE folder=? ORDER BY filePath, line`).all(folder) as Bookmark[];
    },
    getBookmark(bid) { return db.prepare(`SELECT * FROM bookmarks WHERE id=?`).get(bid) as Bookmark | undefined; },
    createBookmark(b) {
      const now = Date.now();
      const bm: Bookmark = { id: id("bk_"), createdAt: now, updatedAt: now, ...b };
      db.prepare(`INSERT INTO bookmarks (id,folder,filePath,line,label,preview,createdAt,updatedAt)
        VALUES (@id,@folder,@filePath,@line,@label,@preview,@createdAt,@updatedAt)`).run(bm);
      return bm;
    },
    updateBookmark(bid, patch) {
      if (!("label" in patch)) return;
      db.prepare(`UPDATE bookmarks SET label=?, updatedAt=? WHERE id=?`).run(patch.label ?? null, Date.now(), bid);
    },
    updateBookmarkLine(bid, line) {
      db.prepare(`UPDATE bookmarks SET line=?, updatedAt=? WHERE id=?`).run(line, Date.now(), bid);
    },
    deleteBookmark(bid) { db.prepare(`DELETE FROM bookmarks WHERE id=?`).run(bid); },
    clearFileBookmarks(folder, filePath) {
      db.prepare(`DELETE FROM bookmarks WHERE folder=? AND filePath=?`).run(folder, filePath);
    },
    clearFolderBookmarks(folder) { db.prepare(`DELETE FROM bookmarks WHERE folder=?`).run(folder); },
    createFavoriteGroup(g) {
      const now = Date.now();
      const row: FavoriteGroup = {
        id: id("fg_"), parentId: g.parentId, name: g.name,
        position: countSiblings("favorite_groups", "parentId", g.parentId), createdAt: now, updatedAt: now,
      };
      db.prepare(`INSERT INTO favorite_groups (id,parentId,name,position,createdAt,updatedAt)
        VALUES (@id,@parentId,@name,@position,@createdAt,@updatedAt)`).run(row);
      return row;
    },
    listFavoriteGroups() {
      return db.prepare(`SELECT * FROM favorite_groups ORDER BY position, createdAt`).all() as FavoriteGroup[];
    },
    getFavoriteGroup(gid) { return db.prepare(`SELECT * FROM favorite_groups WHERE id=?`).get(gid) as FavoriteGroup | undefined; },
    renameFavoriteGroup(gid, name) {
      db.prepare(`UPDATE favorite_groups SET name=?, updatedAt=? WHERE id=?`).run(name, Date.now(), gid);
    },
    createFavorite(f) {
      if (favDupExists(f.groupId, f.folder)) return undefined;
      const now = Date.now();
      const row: Favorite = {
        id: id("fv_"), groupId: f.groupId, folder: f.folder, label: f.label ?? null,
        position: countSiblings("favorites", "groupId", f.groupId), createdAt: now, updatedAt: now,
      };
      db.prepare(`INSERT INTO favorites (id,groupId,folder,label,position,createdAt,updatedAt)
        VALUES (@id,@groupId,@folder,@label,@position,@createdAt,@updatedAt)`).run(row);
      return row;
    },
    listFavorites() {
      return db.prepare(`SELECT * FROM favorites ORDER BY position, createdAt`).all() as Favorite[];
    },
    getFavorite(fid) { return db.prepare(`SELECT * FROM favorites WHERE id=?`).get(fid) as Favorite | undefined; },
    renameFavorite(fid, label) {
      db.prepare(`UPDATE favorites SET label=?, updatedAt=? WHERE id=?`).run(label, Date.now(), fid);
    },
    deleteFavorite(fid) {
      const cur = this.getFavorite(fid); if (!cur) return;
      db.transaction(() => {
        db.prepare(`DELETE FROM favorites WHERE id=?`).run(fid);
        renumberBucket("favorites", "groupId", cur.groupId);
      })();
    },
    moveFavorite(fid, groupId, index) {
      const cur = this.getFavorite(fid); if (!cur) return;
      // Keep the per-bucket folder-uniqueness invariant: refuse to land on a folder a different
      // favorite already holds in the destination.
      const clash = groupId === null
        ? db.prepare(`SELECT 1 FROM favorites WHERE groupId IS NULL AND folder=? AND id<>?`).get(cur.folder, fid)
        : db.prepare(`SELECT 1 FROM favorites WHERE groupId=? AND folder=? AND id<>?`).get(groupId, cur.folder, fid);
      if (clash) return;
      const from = cur.groupId;
      db.transaction(() => {
        db.prepare(`UPDATE favorites SET groupId=@groupId, updatedAt=@now WHERE id=@id`)
          .run({ groupId, now: Date.now(), id: fid });
        // Splice fid into the destination order at `index`, then write contiguous positions.
        const dest = (groupId === null
          ? db.prepare(`SELECT id FROM favorites WHERE groupId IS NULL AND id<>? ORDER BY position, createdAt`).all(fid)
          : db.prepare(`SELECT id FROM favorites WHERE groupId=? AND id<>? ORDER BY position, createdAt`).all(groupId, fid)) as { id: string }[];
        const ids = dest.map(r => r.id);
        ids.splice(Math.max(0, Math.min(index, ids.length)), 0, fid);
        const upd = db.prepare(`UPDATE favorites SET position=? WHERE id=?`);
        ids.forEach((id, i) => upd.run(i, id));
        if (from !== groupId) renumberBucket("favorites", "groupId", from);
      })();
    },
    deleteFavoriteGroup(gid, reassignTo) {
      const cur = this.getFavoriteGroup(gid); if (!cur) return;
      const doReassign = reassignTo !== undefined;     // undefined = cascade; null = to root; string = to group
      const target = (reassignTo ?? null) as string | null;
      db.transaction(() => {
        if (doReassign) {
          const direct = db.prepare(`SELECT id FROM favorites WHERE groupId=?`).all(gid) as { id: string }[];
          for (const f of direct) this.moveFavorite(f.id, target, Number.MAX_SAFE_INTEGER);
        }
        const ids = [gid, ...collectDescendantGroupIds(gid)];
        const ph = ids.map(() => "?").join(",");
        db.prepare(`DELETE FROM favorites WHERE groupId IN (${ph})`).run(...ids);
        db.prepare(`DELETE FROM favorite_groups WHERE id IN (${ph})`).run(...ids);
        renumberBucket("favorite_groups", "parentId", cur.parentId);
      })();
    },
    moveFavoriteGroup(gid, parentId, index) {
      const cur = this.getFavoriteGroup(gid); if (!cur) return false;
      if (parentId !== null && (parentId === gid || collectDescendantGroupIds(gid).has(parentId))) return false;
      const from = cur.parentId;
      db.transaction(() => {
        db.prepare(`UPDATE favorite_groups SET parentId=@parentId, updatedAt=@now WHERE id=@id`)
          .run({ parentId, now: Date.now(), id: gid });
        const dest = (parentId === null
          ? db.prepare(`SELECT id FROM favorite_groups WHERE parentId IS NULL AND id<>? ORDER BY position, createdAt`).all(gid)
          : db.prepare(`SELECT id FROM favorite_groups WHERE parentId=? AND id<>? ORDER BY position, createdAt`).all(parentId, gid)) as { id: string }[];
        const ids = dest.map(r => r.id);
        ids.splice(Math.max(0, Math.min(index, ids.length)), 0, gid);
        const upd = db.prepare(`UPDATE favorite_groups SET position=? WHERE id=?`);
        ids.forEach((id, i) => upd.run(i, id));
        if (from !== parentId) renumberBucket("favorite_groups", "parentId", from);
      })();
      return true;
    },
    listSkillInstalls() { return db.prepare(`SELECT * FROM skill_installs`).all() as SkillInstall[]; },
    getSkillInstall(installPath) {
      return db.prepare(`SELECT * FROM skill_installs WHERE installPath=?`).get(installPath) as SkillInstall | undefined;
    },
    upsertSkillInstall(row) {
      db.prepare(`INSERT INTO skill_installs
          (installPath,name,scope,sourceType,sourceUrl,skillPath,repoHeadHash,folderHash,installedAt,updatedAt)
        VALUES (@installPath,@name,@scope,@sourceType,@sourceUrl,@skillPath,@repoHeadHash,@folderHash,@installedAt,@updatedAt)
        ON CONFLICT(installPath) DO UPDATE SET
          name=excluded.name, scope=excluded.scope, sourceType=excluded.sourceType, sourceUrl=excluded.sourceUrl,
          skillPath=excluded.skillPath, repoHeadHash=excluded.repoHeadHash, folderHash=excluded.folderHash,
          installedAt=excluded.installedAt, updatedAt=excluded.updatedAt`).run(row);
    },
    moveSkillInstall(oldPath, newPath) {
      db.prepare(`UPDATE skill_installs SET installPath=?, updatedAt=? WHERE installPath=?`).run(newPath, Date.now(), oldPath);
    },
    deleteSkillInstall(installPath) { db.prepare(`DELETE FROM skill_installs WHERE installPath=?`).run(installPath); },

    createBlueprint(b) {
      const now = Date.now();
      const bp: Blueprint = { id: id("bp_"), name: b.name, graph: b.graph, chat: b.chat ?? null, createdAt: now, updatedAt: now };
      db.prepare(`INSERT INTO blueprints (id,name,graph,chat,createdAt,updatedAt)
        VALUES (@id,@name,@graph,@chat,@createdAt,@updatedAt)`).run(bp);
      return bp;
    },
    getBlueprint(bid) { return db.prepare(`SELECT * FROM blueprints WHERE id=?`).get(bid) as Blueprint | undefined; },
    listBlueprints() { return db.prepare(`SELECT * FROM blueprints ORDER BY updatedAt DESC`).all() as Blueprint[]; },
    updateBlueprint(bid, patch) {
      const cur = this.getBlueprint(bid); if (!cur) return;
      const next = { ...cur, ...patch, updatedAt: Date.now() };
      db.prepare(`UPDATE blueprints SET name=@name, graph=@graph, chat=@chat, updatedAt=@updatedAt WHERE id=@id`).run(next);
    },
    deleteBlueprint(bid) { db.prepare(`DELETE FROM blueprints WHERE id=?`).run(bid); },
    createAccessKey(a) {
      const row: AccessKey = {
        id: id("ak_"), label: a.label ?? "", secret: randomBytes(24).toString("base64url"),
        workspaceId: a.workspaceId ?? null, expiresAt: a.expiresAt ?? null,
        createdAt: Date.now(), lastUsedAt: null,
        mirror: a.mirror ?? false, lock: a.lock ?? false,
      };
      // booleans bind as 0/1 (better-sqlite3 rejects raw booleans); reads coerce back to booleans below.
      db.prepare(`INSERT INTO access_keys (id,label,secret,workspaceId,expiresAt,createdAt,lastUsedAt,mirror,"lock")
        VALUES (@id,@label,@secret,@workspaceId,@expiresAt,@createdAt,@lastUsedAt,@mirror,@lock)`)
        .run({ ...row, mirror: row.mirror ? 1 : 0, lock: row.lock ? 1 : 0 });
      return row;
    },
    listAccessKeys() {
      store.sweepAccessKeys();
      return (db.prepare(`SELECT * FROM access_keys ORDER BY createdAt DESC`).all() as AccessKey[]).map(rowToAccessKey);
    },
    getValidAccessKey(secret) {
      store.sweepAccessKeys();
      const row = db.prepare(`SELECT * FROM access_keys WHERE secret=? AND (expiresAt IS NULL OR expiresAt > ?)`)
        .get(secret, Date.now()) as AccessKey | undefined;
      return row ? rowToAccessKey(row) : undefined;
    },
    revokeAccessKey(akid) { db.prepare(`DELETE FROM access_keys WHERE id=?`).run(akid); },
    touchAccessKey(akid) {
      const now = Date.now();
      // Throttle: only bump lastUsedAt when it's unset or older than 60s, to avoid a DB write per request.
      db.prepare(`UPDATE access_keys SET lastUsedAt=? WHERE id=? AND (lastUsedAt IS NULL OR lastUsedAt <= ?)`)
        .run(now, akid, now - 60_000);
    },
    sweepAccessKeys() {
      return db.prepare(`DELETE FROM access_keys WHERE expiresAt IS NOT NULL AND expiresAt <= ?`).run(Date.now()).changes;
    },
    createNote(n) {
      const now = Date.now();
      const note: Note = { id: id("np_"), title: n.title, content: n.content, createdAt: now, updatedAt: now };
      db.prepare(`INSERT INTO notes (id,title,content,createdAt,updatedAt)
        VALUES (@id,@title,@content,@createdAt,@updatedAt)`).run(note);
      return note;
    },
    getNote(nid) { return db.prepare(`SELECT * FROM notes WHERE id=?`).get(nid) as Note | undefined; },
    listNotes() { return db.prepare(`SELECT * FROM notes ORDER BY updatedAt DESC, createdAt DESC`).all() as Note[]; },
    updateNote(nid, patch) {
      const cur = this.getNote(nid); if (!cur) return;
      const next = { ...cur, ...patch, updatedAt: Date.now() };
      db.prepare(`UPDATE notes SET title=@title, content=@content, updatedAt=@updatedAt WHERE id=@id`).run(next);
    },
    deleteNote(nid) { db.prepare(`DELETE FROM notes WHERE id=?`).run(nid); },
    listLinks() { return db.prepare(`SELECT * FROM links ORDER BY sort ASC, createdAt ASC`).all() as Link[]; },
    getLink(lid) { return db.prepare(`SELECT * FROM links WHERE id=?`).get(lid) as Link | undefined; },
    createLink(l) {
      const now = Date.now();
      const folderId = l.folderId ?? null;
      // Append to the end of its folder (or the ungrouped set). `folderId IS @folderId` matches null too.
      const { next } = db.prepare(`SELECT COALESCE(MAX(sort),-1)+1 AS next FROM links WHERE folderId IS @folderId`).get({ folderId }) as { next: number };
      const link: Link = { id: id("lk_"), folderId, title: l.title, url: l.url, description: l.description ?? "", color: null, sort: next, createdAt: now, updatedAt: now };
      db.prepare(`INSERT INTO links (id,folderId,title,url,description,color,sort,createdAt,updatedAt)
        VALUES (@id,@folderId,@title,@url,@description,@color,@sort,@createdAt,@updatedAt)`).run(link);
      return link;
    },
    updateLink(lid, patch) {
      const cur = this.getLink(lid); if (!cur) return undefined;
      const next: Link = { ...cur, ...patch, folderId: patch.folderId !== undefined ? patch.folderId : cur.folderId, updatedAt: Date.now() };
      db.prepare(`UPDATE links SET folderId=@folderId, title=@title, url=@url, description=@description, color=@color, sort=@sort, updatedAt=@updatedAt WHERE id=@id`).run(next);
      return next;
    },
    deleteLink(lid) { db.prepare(`DELETE FROM links WHERE id=?`).run(lid); },
    reorderLinks(items) {
      const now = Date.now();
      const upd = db.prepare(`UPDATE links SET folderId=@folderId, sort=@sort, updatedAt=@updatedAt WHERE id=@id`);
      db.transaction((rows: { id: string; folderId: string | null; sort: number }[]) => {
        for (const r of rows) upd.run({ id: r.id, folderId: r.folderId ?? null, sort: r.sort, updatedAt: now });
      })(items);
    },
    listLinkFolders() { return db.prepare(`SELECT * FROM link_folders ORDER BY sort ASC, createdAt ASC`).all() as LinkFolder[]; },
    getLinkFolder(fid) { return db.prepare(`SELECT * FROM link_folders WHERE id=?`).get(fid) as LinkFolder | undefined; },
    createLinkFolder(f) {
      const now = Date.now();
      const { next } = db.prepare(`SELECT COALESCE(MAX(sort),-1)+1 AS next FROM link_folders`).get() as { next: number };
      const folder: LinkFolder = { id: id("lf_"), name: f.name, color: null, sort: next, createdAt: now, updatedAt: now };
      db.prepare(`INSERT INTO link_folders (id,name,color,sort,createdAt,updatedAt) VALUES (@id,@name,@color,@sort,@createdAt,@updatedAt)`).run(folder);
      return folder;
    },
    updateLinkFolder(fid, patch) {
      const cur = this.getLinkFolder(fid); if (!cur) return undefined;
      const next: LinkFolder = { ...cur, ...patch, updatedAt: Date.now() };
      db.prepare(`UPDATE link_folders SET name=@name, color=@color, sort=@sort, updatedAt=@updatedAt WHERE id=@id`).run(next);
      return next;
    },
    deleteLinkFolder(fid) {
      // Non-destructive to the links inside: re-home them to the ungrouped (null) set, then drop the folder.
      db.prepare(`UPDATE links SET folderId=NULL, updatedAt=? WHERE folderId=?`).run(Date.now(), fid);
      db.prepare(`DELETE FROM link_folders WHERE id=?`).run(fid);
    },
    reorderLinkFolders(items) {
      const now = Date.now();
      const upd = db.prepare(`UPDATE link_folders SET sort=@sort, updatedAt=@updatedAt WHERE id=@id`);
      db.transaction((rows: { id: string; sort: number }[]) => {
        for (const r of rows) upd.run({ id: r.id, sort: r.sort, updatedAt: now });
      })(items);
    },
    createStickyNote(n) {
      const now = Date.now();
      const note: StickyNote = {
        id: id("sn_"), spaceId: n.spaceId ?? store.getHomeSpaceId() ?? null,
        content: n.content ?? "", color: n.color ?? null,
        x: n.x, y: n.y, w: n.w, h: n.h, pinned: false, createdAt: now, updatedAt: now,
      };
      db.prepare(`INSERT INTO sticky_notes (id,spaceId,content,color,x,y,w,h,pinned,createdAt,updatedAt)
        VALUES (@id,@spaceId,@content,@color,@x,@y,@w,@h,@pinned,@createdAt,@updatedAt)`)
        .run({ ...note, pinned: note.pinned ? 1 : 0 });
      return note;
    },
    getStickyNote(nid) {
      const r = db.prepare(`SELECT * FROM sticky_notes WHERE id=?`).get(nid) as (Omit<StickyNote, "pinned"> & { pinned: number }) | undefined;
      return r ? { ...r, pinned: r.pinned === 1 } : undefined;
    },
    listStickyNotes() {
      const rows = db.prepare(`SELECT * FROM sticky_notes ORDER BY createdAt`).all() as (Omit<StickyNote, "pinned"> & { pinned: number })[];
      return rows.map((r) => ({ ...r, pinned: r.pinned === 1 }));
    },
    updateStickyNote(nid, patch) {
      const cur = this.getStickyNote(nid); if (!cur) return;
      const next = { ...cur, ...patch, updatedAt: Date.now() };
      db.prepare(`UPDATE sticky_notes SET spaceId=@spaceId,content=@content,color=@color,x=@x,y=@y,w=@w,h=@h,pinned=@pinned,updatedAt=@updatedAt WHERE id=@id`)
        .run({ ...next, pinned: next.pinned ? 1 : 0 });
    },
    deleteStickyNote(nid) { db.prepare(`DELETE FROM sticky_notes WHERE id=?`).run(nid); },
    createSpaceWidget(n) {
      const now = Date.now();
      const widget: SpaceWidget = {
        id: id("sw_"), spaceId: n.spaceId ?? store.getHomeSpaceId() ?? null, kind: n.kind,
        x: n.x, y: n.y, w: n.w, h: n.h, config: n.config ?? null, createdAt: now, updatedAt: now,
      };
      db.prepare(`INSERT INTO space_widgets (id,spaceId,kind,x,y,w,h,config,createdAt,updatedAt)
        VALUES (@id,@spaceId,@kind,@x,@y,@w,@h,@config,@createdAt,@updatedAt)`)
        .run({ ...widget, config: widget.config ? JSON.stringify(widget.config) : null });
      return widget;
    },
    getSpaceWidget(wid) {
      const r = db.prepare(`SELECT * FROM space_widgets WHERE id=?`).get(wid) as (Omit<SpaceWidget, "config"> & { config: string | null }) | undefined;
      if (!r) return undefined;
      return { ...r, config: parseWidgetConfig(r.config) };
    },
    listSpaceWidgets() {
      const rows = db.prepare(`SELECT * FROM space_widgets ORDER BY createdAt`).all() as (Omit<SpaceWidget, "config"> & { config: string | null })[];
      return rows.map((r) => ({ ...r, config: parseWidgetConfig(r.config) }));
    },
    updateSpaceWidget(wid, patch) {
      const cur = this.getSpaceWidget(wid); if (!cur) return;
      const next = { ...cur, ...patch, updatedAt: Date.now() };
      db.prepare(`UPDATE space_widgets SET spaceId=@spaceId,kind=@kind,x=@x,y=@y,w=@w,h=@h,config=@config,updatedAt=@updatedAt WHERE id=@id`)
        .run({ ...next, config: next.config ? JSON.stringify(next.config) : null });
    },
    deleteSpaceWidget(wid) { db.prepare(`DELETE FROM space_widgets WHERE id=?`).run(wid); },
    getMeterBaseline(agent) {
      const r = db.prepare(`SELECT weekKey,dayKey,dayStartWeeklyPct FROM meter_baselines WHERE agent=?`).get(agent) as
        { weekKey: number | null; dayKey: string | null; dayStartWeeklyPct: number } | undefined;
      return r ?? null;
    },
    saveMeterBaseline(agent, b) {
      db.prepare(`INSERT INTO meter_baselines (agent,weekKey,dayKey,dayStartWeeklyPct,updatedAt) VALUES (?,?,?,?,?)
        ON CONFLICT(agent) DO UPDATE SET weekKey=excluded.weekKey, dayKey=excluded.dayKey, dayStartWeeklyPct=excluded.dayStartWeeklyPct, updatedAt=excluded.updatedAt`)
        .run(agent, b.weekKey, b.dayKey, b.dayStartWeeklyPct, Date.now());
    },
    createBoardCard(c) {
      const now = Date.now();
      const n = (db.prepare(`SELECT COUNT(*) n FROM board_cards WHERE "column"=?`).get(c.column) as { n: number }).n;
      const card: BoardCard = { id: id("bc_"), column: c.column, position: n, title: c.title, body: c.body, color: c.color, createdAt: now, updatedAt: now };
      db.prepare(`INSERT INTO board_cards (id,"column",position,title,body,color,createdAt,updatedAt)
        VALUES (@id,@column,@position,@title,@body,@color,@createdAt,@updatedAt)`).run(card);
      return card;
    },
    getBoardCard(cid) { return db.prepare(`SELECT * FROM board_cards WHERE id=?`).get(cid) as BoardCard | undefined; },
    listBoardCards() {
      return db.prepare(`SELECT * FROM board_cards
        ORDER BY CASE "column" WHEN 'todo' THEN 0 WHEN 'doing' THEN 1 ELSE 2 END, position`).all() as BoardCard[];
    },
    updateBoardCard(cid, patch) {
      const cur = this.getBoardCard(cid); if (!cur) return;
      const next = { ...cur, ...patch, updatedAt: Date.now() };
      db.prepare(`UPDATE board_cards SET title=@title, body=@body, color=@color, updatedAt=@updatedAt WHERE id=@id`)
        .run({ id: cid, title: next.title, body: next.body, color: next.color, updatedAt: next.updatedAt });
    },
    moveBoardCard(cid, column, position) {
      const cur = this.getBoardCard(cid); if (!cur) return;
      // Re-home the card, then renumber the affected column(s) so positions stay contiguous.
      db.prepare(`UPDATE board_cards SET "column"=@column, updatedAt=@now WHERE id=@id`).run({ column, now: Date.now(), id: cid });
      const setPos = db.prepare(`UPDATE board_cards SET position=? WHERE id=?`);
      const renumber = (col: BoardColumn) =>
        (db.prepare(`SELECT id FROM board_cards WHERE "column"=? ORDER BY position, createdAt`).all(col) as { id: string }[])
          .forEach((r, i) => setPos.run(i, r.id));
      // Target order = the other cards by position, with this card spliced in at `position`.
      const others = (db.prepare(`SELECT id FROM board_cards WHERE "column"=? AND id!=? ORDER BY position, createdAt`)
        .all(column, cid) as { id: string }[]).map((r) => r.id);
      others.splice(Math.max(0, Math.min(position, others.length)), 0, cid);
      others.forEach((rid, i) => setPos.run(i, rid));
      if (cur.column !== column) renumber(cur.column); // close the gap it left behind
    },
    deleteBoardCard(cid) {
      const cur = this.getBoardCard(cid); if (!cur) return;
      db.prepare(`DELETE FROM board_cards WHERE id=?`).run(cid);
      const setPos = db.prepare(`UPDATE board_cards SET position=? WHERE id=?`);
      (db.prepare(`SELECT id FROM board_cards WHERE "column"=? ORDER BY position, createdAt`).all(cur.column) as { id: string }[])
        .forEach((r, i) => setPos.run(i, r.id));
    },
    listTimeEntries(from, to) {
      // Entries started within the range, PLUS any still-running entry (so a live timer always shows).
      return (db.prepare(`SELECT * FROM tt_entries WHERE (startedAt >= @from AND startedAt < @to) OR stoppedAt IS NULL ORDER BY startedAt DESC`).all({ from, to }) as any[]).map(mapTimeEntry);
    },
    getTimeEntry(eid) {
      const r = db.prepare(`SELECT * FROM tt_entries WHERE id=?`).get(eid);
      return r ? mapTimeEntry(r) : undefined;
    },
    startTimeEntry(e) {
      const now = Date.now();
      ensureCatalog(e.client, e.project, e.task);
      const row: TimeEntry = {
        id: id("te_"), client: (e.client ?? "").trim(), project: (e.project ?? "").trim(),
        task: (e.task ?? "").trim(), notes: e.notes ?? "", startedAt: now, stoppedAt: null, createdAt: now, updatedAt: now,
      };
      db.prepare(`INSERT INTO tt_entries (id,client,project,task,notes,startedAt,stoppedAt,createdAt,updatedAt)
        VALUES (@id,@client,@project,@task,@notes,@startedAt,@stoppedAt,@createdAt,@updatedAt)`).run(row);
      return row;
    },
    createTimeEntry(e) {
      const now = Date.now();
      ensureCatalog(e.client, e.project, e.task);
      const row: TimeEntry = {
        id: id("te_"), client: (e.client ?? "").trim(), project: (e.project ?? "").trim(),
        task: (e.task ?? "").trim(), notes: e.notes ?? "", startedAt: e.startedAt, stoppedAt: e.stoppedAt ?? null, createdAt: now, updatedAt: now,
      };
      db.prepare(`INSERT INTO tt_entries (id,client,project,task,notes,startedAt,stoppedAt,createdAt,updatedAt)
        VALUES (@id,@client,@project,@task,@notes,@startedAt,@stoppedAt,@createdAt,@updatedAt)`).run(row);
      return row;
    },
    stopTimeEntry(opts) {
      const { id: eid, client, now } = opts;
      const stop = (r: any): TimeEntry => {
        db.prepare(`UPDATE tt_entries SET stoppedAt=@now, updatedAt=@now WHERE id=@id`).run({ now, id: r.id });
        return mapTimeEntry({ ...r, stoppedAt: now, updatedAt: now });
      };
      if (eid) {
        const r = db.prepare(`SELECT * FROM tt_entries WHERE id=? AND stoppedAt IS NULL`).get(eid);
        return r ? [stop(r)] : [];
      }
      if (client) {
        const rows = db.prepare(`SELECT * FROM tt_entries WHERE stoppedAt IS NULL AND client=? COLLATE NOCASE ORDER BY startedAt DESC`).all(client) as any[];
        return rows.map(stop);
      }
      const latest = db.prepare(`SELECT * FROM tt_entries WHERE stoppedAt IS NULL ORDER BY startedAt DESC LIMIT 1`).get();
      return latest ? [stop(latest)] : [];
    },
    updateTimeEntry(eid, patch) {
      const cur = store.getTimeEntry(eid); if (!cur) return undefined;
      const next = { ...cur, ...patch, updatedAt: Date.now() };
      db.prepare(`UPDATE tt_entries SET client=@client, project=@project, task=@task, notes=@notes, startedAt=@startedAt, stoppedAt=@stoppedAt, updatedAt=@updatedAt WHERE id=@id`)
        .run({ id: eid, client: next.client, project: next.project, task: next.task, notes: next.notes, startedAt: next.startedAt, stoppedAt: next.stoppedAt, updatedAt: next.updatedAt });
      return store.getTimeEntry(eid);
    },
    deleteTimeEntry(eid) { db.prepare(`DELETE FROM tt_entries WHERE id=?`).run(eid); },
    listTimeClients() { return (db.prepare(`SELECT * FROM tt_clients ORDER BY position, name COLLATE NOCASE`).all() as any[]).map(mapTimeCat); },
    createTimeClient(name) { return ensureClient(name)!; },
    updateTimeClient(cid, patch) {
      const cur = db.prepare(`SELECT * FROM tt_clients WHERE id=?`).get(cid) as any; if (!cur) return undefined;
      const next = { ...cur, ...patch, archived: patch.archived !== undefined ? (patch.archived ? 1 : 0) : cur.archived, updatedAt: Date.now() };
      db.prepare(`UPDATE tt_clients SET name=@name, archived=@archived, position=@position, updatedAt=@updatedAt WHERE id=@id`)
        .run({ id: cid, name: next.name, archived: next.archived, position: next.position, updatedAt: next.updatedAt });
      return mapTimeCat(db.prepare(`SELECT * FROM tt_clients WHERE id=?`).get(cid));
    },
    deleteTimeClient(cid) {
      db.transaction(() => {
        db.prepare(`DELETE FROM tt_projects WHERE clientId=?`).run(cid);
        db.prepare(`DELETE FROM tt_clients WHERE id=?`).run(cid);
      })();
    },
    listTimeProjects(clientId) {
      const rows = (clientId
        ? db.prepare(`SELECT * FROM tt_projects WHERE clientId=? ORDER BY position, name COLLATE NOCASE`).all(clientId)
        : db.prepare(`SELECT * FROM tt_projects ORDER BY position, name COLLATE NOCASE`).all()) as any[];
      return rows.map(mapTimeCat);
    },
    createTimeProject(clientId, name) { return ensureProject(clientId, name)!; },
    updateTimeProject(pid, patch) {
      const cur = db.prepare(`SELECT * FROM tt_projects WHERE id=?`).get(pid) as any; if (!cur) return undefined;
      const next = { ...cur, ...patch, archived: patch.archived !== undefined ? (patch.archived ? 1 : 0) : cur.archived, updatedAt: Date.now() };
      db.prepare(`UPDATE tt_projects SET name=@name, archived=@archived, position=@position, updatedAt=@updatedAt WHERE id=@id`)
        .run({ id: pid, name: next.name, archived: next.archived, position: next.position, updatedAt: next.updatedAt });
      return mapTimeCat(db.prepare(`SELECT * FROM tt_projects WHERE id=?`).get(pid));
    },
    deleteTimeProject(pid) { db.prepare(`DELETE FROM tt_projects WHERE id=?`).run(pid); },
    listTimeTasks() { return (db.prepare(`SELECT * FROM tt_tasks ORDER BY position, name COLLATE NOCASE`).all() as any[]).map(mapTimeCat); },
    createTimeTask(name) { return ensureTask(name)!; },
    updateTimeTask(tid, patch) {
      const cur = db.prepare(`SELECT * FROM tt_tasks WHERE id=?`).get(tid) as any; if (!cur) return undefined;
      const next = { ...cur, ...patch, archived: patch.archived !== undefined ? (patch.archived ? 1 : 0) : cur.archived, updatedAt: Date.now() };
      db.prepare(`UPDATE tt_tasks SET name=@name, archived=@archived, position=@position, updatedAt=@updatedAt WHERE id=@id`)
        .run({ id: tid, name: next.name, archived: next.archived, position: next.position, updatedAt: next.updatedAt });
      return mapTimeCat(db.prepare(`SELECT * FROM tt_tasks WHERE id=?`).get(tid));
    },
    deleteTimeTask(tid) { db.prepare(`DELETE FROM tt_tasks WHERE id=?`).run(tid); },
    createReminder(r) {
      const now = Date.now();
      const rem: Reminder = {
        id: id("rem_"), title: r.title, body: r.body ?? "", fireAt: r.fireAt,
        allDay: r.allDay ?? false, endAt: r.endAt ?? null, leadMinutes: r.leadMinutes ?? 0,
        color: r.color ?? null, imagePath: r.imagePath ?? null,
        channels: r.channels ?? { ...DEFAULT_CHANNELS }, level: r.level ?? "info",
        priority: r.priority ?? 0, recurrence: r.recurrence ?? null,
        status: "pending", snoozeUntil: null, firedAt: null, wasMissed: false, createdAt: now, updatedAt: now,
      };
      db.prepare(`INSERT INTO reminders (id,title,body,fireAt,allDay,endAt,leadMinutes,color,imagePath,channels,level,priority,recurrence,status,snoozeUntil,firedAt,wasMissed,createdAt,updatedAt)
        VALUES (@id,@title,@body,@fireAt,@allDay,@endAt,@leadMinutes,@color,@imagePath,@channels,@level,@priority,@recurrence,@status,@snoozeUntil,@firedAt,@wasMissed,@createdAt,@updatedAt)`)
        .run(reminderRow(rem));
      return rem;
    },
    getReminder(rid) {
      const row = db.prepare(`SELECT * FROM reminders WHERE id=?`).get(rid);
      return row ? mapReminder(row) : undefined;
    },
    listReminders(filter) {
      const where: string[] = [];
      const params: Record<string, unknown> = {};
      if (filter?.from != null) { where.push("fireAt >= @from"); params.from = filter.from; }
      if (filter?.to != null) { where.push("fireAt <= @to"); params.to = filter.to; }
      if (filter?.status?.length) {
        where.push(`status IN (${filter.status.map((_, i) => `@s${i}`).join(",")})`);
        filter.status.forEach((s, i) => { params[`s${i}`] = s; });
      }
      const sql = `SELECT * FROM reminders ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY fireAt`;
      return (db.prepare(sql).all(params) as any[]).map(mapReminder);
    },
    updateReminder(rid, patch) {
      const cur = store.getReminder(rid); if (!cur) return undefined;
      const next: Reminder = { ...cur, ...patch, updatedAt: Date.now() };
      db.prepare(`UPDATE reminders SET title=@title, body=@body, fireAt=@fireAt, allDay=@allDay, endAt=@endAt, leadMinutes=@leadMinutes, color=@color, imagePath=@imagePath, channels=@channels, level=@level, priority=@priority, recurrence=@recurrence, status=@status, snoozeUntil=@snoozeUntil, firedAt=@firedAt, wasMissed=@wasMissed, updatedAt=@updatedAt WHERE id=@id`)
        .run(reminderRow(next));
      return store.getReminder(rid);
    },
    deleteReminder(rid) {
      db.prepare(`DELETE FROM reminders WHERE id=?`).run(rid);
      db.prepare(`DELETE FROM reminder_images WHERE reminderId=?`).run(rid);
    },
    dueReminders(now) {
      return (db.prepare(
        `SELECT * FROM reminders
         WHERE (status='pending' AND (fireAt - leadMinutes*60000) <= @now)
            OR (status='snoozed' AND snoozeUntil IS NOT NULL AND snoozeUntil <= @now)
         ORDER BY fireAt`,
      ).all({ now }) as any[]).map(mapReminder);
    },
    markFired(rid, opts) {
      const cur = store.getReminder(rid); if (!cur) return;
      const wasMissed = opts.wasMissed ? 1 : 0;
      // A recurring reminder rolls forward to its next occurrence and stays pending; `count` (if set)
      // decrements each step and ends the series at zero. A one-time reminder just becomes 'fired'.
      // We advance until the next occurrence is strictly after `now`: in normal operation that's a
      // single step, but after downtime it fast-forwards past missed occurrences so the reminder
      // fires ONCE (the caller surfaces one "(missed)" ping), not once per skipped interval.
      if (cur.recurrence) {
        let rec: Recurrence = cur.recurrence;
        let fireAt = cur.fireAt;
        let next: number | null = null;
        while (true) {
          const n = computeNextOccurrence(rec, fireAt);
          if (rec.count != null) {
            const remaining = rec.count - 1;
            if (remaining <= 0) { next = null; break; }
            rec = { ...rec, count: remaining };
          }
          if (n == null) { next = null; break; }
          next = n; fireAt = n;
          if (n > opts.now) break;
        }
        if (next != null) {
          db.prepare(`UPDATE reminders SET fireAt=@fireAt, recurrence=@recurrence, status='pending', snoozeUntil=NULL, firedAt=@firedAt, wasMissed=@wasMissed, updatedAt=@now WHERE id=@id`)
            .run({ id: rid, fireAt: next, recurrence: JSON.stringify(rec), firedAt: opts.now, wasMissed, now: Date.now() });
          return;
        }
      }
      db.prepare(`UPDATE reminders SET status='fired', snoozeUntil=NULL, firedAt=@firedAt, wasMissed=@wasMissed, updatedAt=@now WHERE id=@id`)
        .run({ id: rid, firedAt: opts.now, wasMissed, now: Date.now() });
    },
    snoozeReminder(rid, until) {
      const cur = store.getReminder(rid); if (!cur) return undefined;
      db.prepare(`UPDATE reminders SET status='snoozed', snoozeUntil=@u, updatedAt=@now WHERE id=@id`)
        .run({ id: rid, u: until, now: Date.now() });
      return store.getReminder(rid);
    },
    createNotification(n) {
      const now = Date.now();
      const row: AppNotification = {
        id: id("nf_"), reminderId: n.reminderId ?? null, title: n.title, body: n.body ?? "",
        level: n.level ?? "info", category: n.category ?? "info", imagePath: n.imagePath ?? null,
        workspaceId: n.workspaceId ?? null, terminalId: n.terminalId ?? null, wasMissed: n.wasMissed ?? false,
        pushover: n.pushover ?? false, pushoverOk: n.pushoverOk ?? null, read: false,
        firedAt: n.firedAt ?? now, createdAt: now,
      };
      db.prepare(`INSERT INTO notifications (id,reminderId,title,body,level,category,imagePath,workspaceId,terminalId,wasMissed,pushover,pushoverOk,"read",firedAt,createdAt)
        VALUES (@id,@reminderId,@title,@body,@level,@category,@imagePath,@workspaceId,@terminalId,@wasMissed,@pushover,@pushoverOk,@read,@firedAt,@createdAt)`)
        .run({
          id: row.id, reminderId: row.reminderId, title: row.title, body: row.body, level: row.level,
          category: row.category, imagePath: row.imagePath, workspaceId: row.workspaceId, terminalId: row.terminalId,
          wasMissed: row.wasMissed ? 1 : 0, pushover: row.pushover ? 1 : 0,
          pushoverOk: row.pushoverOk === null ? null : row.pushoverOk ? 1 : 0, read: 0,
          firedAt: row.firedAt, createdAt: row.createdAt,
        });
      return row;
    },
    listNotifications(limit = 200) {
      return (db.prepare(`SELECT * FROM notifications ORDER BY firedAt DESC, createdAt DESC LIMIT ?`).all(limit) as any[]).map(mapNotification);
    },
    unreadNotificationCount() {
      return (db.prepare(`SELECT COUNT(*) AS c FROM notifications WHERE "read"=0`).get() as { c: number }).c;
    },
    markNotificationRead(nid) { db.prepare(`UPDATE notifications SET "read"=1 WHERE id=?`).run(nid); },
    markAllNotificationsRead() { db.prepare(`UPDATE notifications SET "read"=1 WHERE "read"=0`).run(); },
    deleteNotification(nid) { db.prepare(`DELETE FROM notifications WHERE id=?`).run(nid); },
    deleteNotificationsForTerminal(terminalId) {
      return db.prepare(`DELETE FROM notifications WHERE terminalId=?`).run(terminalId).changes;
    },
    clearNotifications() { db.prepare(`DELETE FROM notifications`).run(); },
    setReminderImage(reminderId, dataUrl) {
      db.prepare(`INSERT INTO reminder_images (reminderId,dataUrl,createdAt) VALUES (?,?,?)
        ON CONFLICT(reminderId) DO UPDATE SET dataUrl=excluded.dataUrl, createdAt=excluded.createdAt`)
        .run(reminderId, dataUrl, Date.now());
    },
    getReminderImage(reminderId) {
      return (db.prepare(`SELECT dataUrl FROM reminder_images WHERE reminderId=?`).get(reminderId) as { dataUrl: string } | undefined)?.dataUrl;
    },
    deleteReminderImage(reminderId) { db.prepare(`DELETE FROM reminder_images WHERE reminderId=?`).run(reminderId); },
    listCatalogSources() {
      return (db.prepare(`SELECT * FROM skill_catalog_source ORDER BY addedAt`).all() as (Omit<CatalogSource, "official"> & { official: number })[])
        .map((r) => ({ ...r, official: !!r.official }));
    },
    addCatalogSource(source, official = false) {
      db.prepare(`INSERT OR IGNORE INTO skill_catalog_source (source,addedAt,skillCount,official) VALUES (?,?,0,?)`)
        .run(source, Date.now(), official ? 1 : 0);
    },
    setCatalogSourceOfficial(source, official) {
      db.prepare(`UPDATE skill_catalog_source SET official=? WHERE source=?`).run(official ? 1 : 0, source);
    },
    removeCatalogSource(source) {
      const tx = db.transaction((s: string) => {
        db.prepare(`DELETE FROM skill_catalog WHERE source=?`).run(s);
        db.prepare(`DELETE FROM skill_catalog_source WHERE source=?`).run(s);
      });
      tx(source);
    },
    setCatalogSourceMeta(source, meta) {
      db.prepare(`UPDATE skill_catalog_source SET lastIndexedAt=?, skillCount=?, error=? WHERE source=?`)
        .run(meta.lastIndexedAt, meta.skillCount, meta.error, source);
    },
    replaceCatalogEntries(source, entries) {
      const tx = db.transaction((s: string, rows: Omit<CatalogEntry, "source" | "official">[]) => {
        db.prepare(`DELETE FROM skill_catalog WHERE source=?`).run(s);
        const ins = db.prepare(`INSERT OR REPLACE INTO skill_catalog (source,name,description,relPath) VALUES (?,?,?,?)`);
        for (const r of rows) ins.run(s, r.name, r.description, r.relPath);
      });
      tx(source, entries);
    },
    listCatalogEntries(filter) {
      if (filter && filter.trim()) {
        const like = `%${filter.trim().toLowerCase()}%`;
        return db.prepare(
          `SELECT * FROM skill_catalog WHERE lower(name) LIKE ? OR lower(coalesce(description,'')) LIKE ? ORDER BY name`,
        ).all(like, like) as Omit<CatalogEntry, "official">[];
      }
      return db.prepare(`SELECT * FROM skill_catalog ORDER BY name`).all() as Omit<CatalogEntry, "official">[];
    },
    upsertDriveAccount(a) {
      const existing = db.prepare(`SELECT id FROM drive_account WHERE email=?`).get(a.email) as { id: string } | undefined;
      const aid = existing?.id ?? id("da_");
      const createdAt = Date.now();
      db.prepare(`INSERT INTO drive_account (id,email,name,picture,refresh_token,access_token,expiry,scope,createdAt)
        VALUES (@id,@email,@name,@picture,@refreshToken,@accessToken,@expiry,@scope,@createdAt)
        ON CONFLICT(email) DO UPDATE SET
          name=@name, picture=@picture, refresh_token=@refreshToken,
          access_token=@accessToken, expiry=@expiry, scope=@scope`)
        .run({ id: aid, createdAt, ...a });
      return store.getDriveAccount(aid)!;
    },
    listDriveAccounts() {
      return db.prepare(`SELECT id,email,name,label,picture FROM drive_account ORDER BY createdAt`).all() as DriveAccountPublic[];
    },
    getDriveAccount(aid) {
      const r = db.prepare(`SELECT id,email,name,label,picture,refresh_token as refreshToken,access_token as accessToken,expiry,scope,createdAt FROM drive_account WHERE id=?`).get(aid);
      return (r as DriveAccount) ?? null;
    },
    updateDriveTokens(aid, t) {
      db.prepare(`UPDATE drive_account SET access_token=?, expiry=? WHERE id=?`).run(t.accessToken, t.expiry, aid);
    },
    renameDriveAccount(aid, label) {
      db.prepare(`UPDATE drive_account SET label=? WHERE id=?`).run(label && label.trim() ? label.trim() : null, aid);
    },
    deleteDriveAccount(aid) { db.prepare(`DELETE FROM drive_account WHERE id=?`).run(aid); },
    getDriveCredentials() {
      // Both halves live as internal settings keys (excluded from the public Settings type, like
      // homeSpaceId). Configured only when BOTH are non-empty; the secret is never read back to HTTP.
      const get = (key: string) => (db.prepare(`SELECT value FROM settings WHERE key=?`).get(key) as { value: string } | undefined)?.value;
      const clientId = get("drive.clientId")?.trim();
      const clientSecret = get("drive.clientSecret")?.trim();
      return clientId && clientSecret && clientId !== "null" && clientSecret !== "null"
        ? { clientId, clientSecret } : null;
    },
    setDriveCredentials(c) {
      const up = db.prepare(`INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
      up.run("drive.clientId", c.clientId);
      up.run("drive.clientSecret", c.clientSecret);
    },
    clearDriveCredentials() {
      // Removing the app config drops the redirect override with it — it only makes sense alongside creds.
      db.prepare(`DELETE FROM settings WHERE key IN ('drive.clientId','drive.clientSecret','drive.redirect')`).run();
    },
    getDriveRedirect() {
      const v = (db.prepare(`SELECT value FROM settings WHERE key=?`).get("drive.redirect") as { value: string } | undefined)?.value?.trim();
      return v ? v : null;
    },
    setDriveRedirect(url) {
      if (url && url.trim()) {
        db.prepare(`INSERT INTO settings (key,value) VALUES ('drive.redirect',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(url.trim());
      } else {
        db.prepare(`DELETE FROM settings WHERE key='drive.redirect'`).run();
      }
    },
  };

  // --- Spaces boot migration: idempotent, runs every boot. Creates the permanent Home space + the
  // Desktop catch-all card on first run, and backfills any spaceId-less workspace into Home. ---
  // `homeSpaceId` / `desktopWorkspaceId` are internal settings keys (not part of the public Settings
  // type, like aiConfig/betterComments), so they're written through the raw settings upsert here.
  const setSettingKey = db.prepare(`INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
  let homeId = store.getHomeSpaceId();
  if (!homeId || !store.getSpace(homeId)) {
    homeId = store.createSpace({ name: "Home" }).id;
    setSettingKey.run("homeSpaceId", homeId);
  }
  db.prepare(`UPDATE workspaces SET spaceId=? WHERE spaceId IS NULL`).run(homeId);
  let deskId = store.getDesktopWorkspaceId();
  if (!deskId || !store.getWorkspace(deskId)) {
    deskId = store.createWorkspace({
      name: "Desktop",
      folder: homedir(),
      launchCommand: store.getSettings().defaultLaunchCommand,
      color: null,
      spaceId: homeId,
    }).id;
    setSettingKey.run("desktopWorkspaceId", deskId);
  }

  // Self-heal a duplicate Home. An earlier build created the Home space without durably persisting
  // `homeSpaceId`, so a later boot didn't recognize it and made a SECOND "Home". Fold every other
  // space literally named "Home" into the canonical one: move its cards over (reassignWorkspaces
  // re-points spaceId only — no terminal/tmux touched), drop the now-empty shell, then renumber.
  // Idempotent: once only one "Home" remains this finds nothing.
  const dupHomes = db.prepare(`SELECT id FROM spaces WHERE name='Home' AND id<>?`).all(homeId) as { id: string }[];
  if (dupHomes.length) {
    db.transaction(() => {
      for (const d of dupHomes) {
        store.reassignWorkspaces(d.id, homeId!);
        db.prepare(`DELETE FROM spaces WHERE id=?`).run(d.id);
      }
      renumberSpaces();
    })();
  }

  // First-run: seed the default catalog sources so a fresh server ships with a browsable skills
  // catalog out of the box. Skipped for :memory: (tests / ephemeral). Once-only via the
  // `skillCatalogSeeded` flag, so removing a default later doesn't resurrect it on the next boot.
  // Rows only — git-clone indexing stays a manual Reindex, never at boot.
  if (path !== ":memory:") {
    const catalogSeeded = (db.prepare(`SELECT value FROM settings WHERE key='skillCatalogSeeded'`).get() as { value: string } | undefined)?.value;
    if (!catalogSeeded) {
      for (const d of DEFAULT_CATALOG_SOURCES) store.addCatalogSource(d.source, d.official);
      setSettingKey.run("skillCatalogSeeded", "1");
    }
  }

  return store;
}
