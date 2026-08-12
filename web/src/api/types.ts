import type { GuiConfig } from "./guiTypes";

// `mode` picks the surface: "tmux" is the classic pane, "gui" swaps it for the in-app chat (Claude or
// Codex, decided server-side from the launch command). `agentSessionId` is the agent session the
// conversation lives under, so flipping surfaces resumes the same thread. Mirrors
// server/src/types.ts Terminal; keep in sync.
export type TerminalMode = "tmux" | "gui";
export interface Terminal { id: string; workspaceId: string; title: string; color: string | null; icon: string | null; tmuxSession: string; launchCommandOverride: string | null; position: number; createdAt: number; titleAuto: boolean; systemPrompt: { text: string; includeParent: boolean } | null; mode: TerminalMode; agentSessionId: string | null; guiConfig: GuiConfig; alive?: boolean; }
export interface Workspace { id: string; name: string; folder: string; launchCommand: string; color: string | null; cardColor: string | null; layout: string | null; spaceId: string | null; folderId: string | null; config: SpaceConfig | null; systemPrompt: { text: string; includeGlobal: boolean } | null; x: number; y: number; createdAt: number; updatedAt: number; terminals?: Terminal[]; }
// A canvas folder: an iPhone-style group of workspace cards on one space's canvas. Holds the group's
// name + canvas position; member cards carry workspaces.folderId. Mirrors server/src/types.ts Folder.
export interface Folder { id: string; spaceId: string | null; name: string; x: number; y: number; createdAt: number; updatedAt: number; }
// The canvas/spaces backdrop config — reused for the global default (settings.canvasBackground) and
// per-space overrides (Space.background). Mirrors server/src/types.ts CanvasBackground; keep in sync.
export interface CanvasBackground {
  kind: "solid" | "wallpaper";
  color: string | null;     // solid: hex, or null = theme default canvas color
  wallpaper: string | null; // wallpaper: id (built-in slug, "gradient:<id>", or "upload:<id>"), or null
  overlay: boolean;         // solid: draw the dim scrim over the color
  dim: number;              // 0-100 scrim opacity
}
// The Stage Manager dock's frosted-glass panel (the macOS-Dock-style background behind the room
// thumbnails). Mirrors server/src/types.ts StageDock; keep in sync. opacity/borderOpacity of 0 = fully
// transparent (no fill / no border); a null color/borderColor tracks the theme's surface/edge colors.
export interface StageDock {
  enabled: boolean;           // draw the frosted panel (off = floating tiles, no panel)
  color: string | null;       // fill tint hex, or null to track the theme's elevated surface
  opacity: number;            // 0-100 fill opacity (0 = transparent background)
  blur: number;               // 0-40 px backdrop blur
  borderColor: string | null; // border tint hex, or null to track the theme's strong edge color
  borderOpacity: number;      // 0-100 border opacity (0 = transparent border)
}
// A space = a virtual desktop (mirrors server/src/types.ts Space; keep in sync by hand).
export interface Space { id: string; name: string; icon: string | null; color: string | null; background: CanvasBackground | null; config: SpaceConfig | null; position: number; createdAt: number; updatedAt: number; }

// --- Space Creation Wizard (mirrors server/src/spaces/types.ts; keep in sync by hand) ---
// The per-space wizard selections, seeded into every workspace in the space (skills/commands/MCP/
// env/rules). `env` is PLAINTEXT by user consent; only the var NAMES reach the rules file.
export interface SpaceConfig {
  skills: string[];      // global skill folder names (~/.claude/skills/<name>)
  commands: string[];    // global slash-command names (~/.claude/commands/<name>.md)
  mcpServers: string[];  // global MCP server names (~/.claude.json)
  env: string;           // raw pasted .env text
  claudeMd: { mode: "pin" | "append"; content: string };
  seedTarget: "AGENTS.md" | "CLAUDE.md" | "both";
  presetId: string | null;
  version: 1;
}
export const EMPTY_SPACE_CONFIG: SpaceConfig = {
  skills: [], commands: [], mcpServers: [], env: "",
  claudeMd: { mode: "append", content: "" }, seedTarget: "both", presetId: null, version: 1,
};
/** A reusable named template — a saved COPY of a SpaceConfig. */
export interface SpacePreset { id: string; name: string; icon: string | null; config: SpaceConfig; createdAt: number; updatedAt: number; }
// Catalog cards (the user's global skills/commands/MCP the wizard offers to add). `category` is the
// heuristic topic bucket the wizard's left rail groups by (server: spaces/classify.ts).
export interface SkillCard { name: string; displayName: string; description: string | null; category: string; }
export interface CommandCard { name: string; description: string | null; category: string; }
export interface McpCard { name: string; description: string | null; transport: "stdio" | "sse" | "http"; category: string; }
export interface SpaceCatalog { skills: SkillCard[]; commands: CommandCard[]; mcpServers: McpCard[]; }
/** What one workspace's seed run produced (POST /api/spaces/:id/seed). */
export interface SeedResult { skills: string[]; commands: string[]; mcpServers: string[]; envWritten: boolean; rulesFiles: string[]; }
export interface SpaceSeedReport { workspaceId: string; name: string; folder: string; result: SeedResult | null; }
// What's active for the agent in a workspace (GET /api/workspaces/:id/installed), each item tagged by
// scope: "local" = pinned to this folder (<folder>/.claude, <folder>/.mcp.json, local-scope MCP),
// "global" = user-scope (~/.claude) active everywhere. MCP is always reported "local". Ground truth
// for the modal's "Installed" section (local under "In this workspace", global under "Active globally").
// Mirrors server/src/spaces/installed.ts; keep in sync by hand.
export type InstallScope = "local" | "global";
export interface InstalledItem { name: string; scope: InstallScope; }
export interface InstalledSet { skills: InstalledItem[]; commands: InstalledItem[]; mcpServers: InstalledItem[]; }
export type InstallKind = "skill" | "command" | "mcp";
// An uploaded canvas wallpaper (mirrors server/src/types.ts Wallpaper; keep in sync by hand). The
// list omits the bytes; GET /api/wallpapers/:id returns `dataUrl` for rendering.
export interface Wallpaper { id: string; name: string; createdAt: number; }
export interface WallpaperData extends Wallpaper { dataUrl: string; }
export interface FsEntry { name: string; path: string; type: "dir" | "file"; readable: boolean; mtime: number; size: number; }
export interface FsListing { path: string; parent: string | null; entries: FsEntry[]; }
// --- Google Drive mounted in the File Browser (mirrors server/src/db/store.ts DriveAccountPublic +
// server/src/drive/map.ts DriveEntry; keep in sync by hand). Tokens never reach the browser. ---
// `label` is the user's custom name for this Drive (null = fall back to email) — shown in the Places bar.
export interface DriveAccountPublic { id: string; email: string; name: string | null; label: string | null; picture: string | null; }
export interface DriveEntry {
  id: string; name: string; type: "dir" | "file"; mimeType: string; google: boolean;
  size: number | null; modifiedTime: string | null; webViewLink: string | null;
}
export interface FsFile { path: string; content?: string; binary: boolean; tooLarge: boolean; size: number; }
// Raw bytes of a binary file (docx, …) as base64, for the rich editors (mirrors server FsFileBytes).
export interface FsFileBytes { path: string; dataBase64?: string; tooLarge: boolean; size: number; }
// A detected editor language server (mirrors server/src/lsp/registry.ts DetectedLanguageServer; keep
// in sync by hand). `installed` reflects $PATH detection; `installHint` drives the missing-server toast.
export interface LanguageServerInfo { id: string; name: string; languageIds: string[]; installHint: string; installed: boolean; }
// Line-level bookmark (mirrors server/src/types.ts Bookmark; keep in sync by hand).
export interface Bookmark { id: string; folder: string; filePath: string; line: number; label: string | null; preview: string | null; createdAt: number; updatedAt: number; }
// Favorites project-switcher (mirrors server/src/types.ts; keep in sync by hand).
export interface FavoriteGroup { id: string; parentId: string | null; name: string; position: number; createdAt: number; updatedAt: number; }
export interface Favorite { id: string; groupId: string | null; folder: string; label: string | null; position: number; createdAt: number; updatedAt: number; }
// Scratchpad note + its group (mirrors server/src/types.ts; keep in sync by hand). `groupId` files a
// note into a NoteGroup collection (null = ungrouped).
export interface Note { id: string; groupId: string | null; title: string; content: string; createdAt: number; updatedAt: number; }
export interface NoteGroup { id: string; name: string; color: string | null; sort: number; createdAt: number; updatedAt: number; }
// Saved web link + its folder (the top-bar Links dropdown). Mirrors server/src/types.ts; sync by hand.
export interface LinkFolder { id: string; name: string; color: string | null; sort: number; createdAt: number; updatedAt: number; }
export interface Link { id: string; folderId: string | null; title: string; url: string; description: string; color: string | null; sort: number; createdAt: number; updatedAt: number; }
// Canvas sticky note (mirrors server/src/types.ts StickyNote; keep in sync by hand).
export interface StickyNote { id: string; spaceId: string | null; content: string; color: string | null; x: number; y: number; w: number; h: number; pinned: boolean; createdAt: number; updatedAt: number; }
// Task-board (kanban) card (mirrors server/src/types.ts; keep in sync by hand).
export type BoardColumn = "todo" | "doing" | "done";
export interface BoardCard { id: string; column: BoardColumn; position: number; title: string; body: string; color: string | null; createdAt: number; updatedAt: number; }

// Timesheet (mirrors server/src/types.ts; keep in sync by hand). `stoppedAt` null = still running.
export interface TimeEntry { id: string; client: string; project: string; task: string; notes: string; startedAt: number; stoppedAt: number | null; createdAt: number; updatedAt: number; }
export interface TimeClient { id: string; name: string; archived: boolean; position: number; createdAt: number; updatedAt: number; }
export interface TimeProject { id: string; clientId: string; name: string; archived: boolean; position: number; createdAt: number; updatedAt: number; }
export interface TimeTask { id: string; name: string; archived: boolean; position: number; createdAt: number; updatedAt: number; }
export interface BuiltinAgent { id: string; name: string; command: string; blurb: string; installed: boolean; }
/** `workspaceId` null = shared by every workspace; set = offered only inside that one. */
export interface CustomAgent { id: string; name: string; command: string; icon: string | null; category: string; workspaceId: string | null; createdAt: number; }
export interface AgentsResponse { builtin: BuiltinAgent[]; custom: CustomAgent[]; }
/** A ready-made launch command offered by the add-a-command form. `script` = read from the
 *  workspace's own package.json; `common` = a usual suspect that folder doesn't define. */
export interface CommandPreset { label: string; command: string; source: "script" | "common"; detail?: string }

// A temp access link ("add a teammate"). `secret` is the URL credential, returned to the owner so the
// manager can re-copy the link. `workspaceId` = the room to auto-open on arrival (null = canvas).
// Mirrors server/src/types.ts AccessKey — keep in sync by hand.
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
// A live teammate connection in the admin roster. Mirrors server/src/presence/sessions.ts.
export interface PresenceSession {
  sessionId: string;
  keyId: string;
  name: string;
  status: "pending" | "admitted";
}
// Public Cloudflare Quick Tunnel state. Mirrors server/src/tunnel/controller.ts.
export type TunnelStatus =
  | { status: "idle" }
  | { status: "starting"; port: number }
  | { status: "running"; port: number; url: string }
  | { status: "error"; message: string };
export interface ProcessInfo { pid: number; ppid: number; cpu: number; mem: number; rss: number; name: string; command: string; }
// Listening TCP socket from the port monitor (mirrors server/src/types.ts; keep in sync by hand).
export interface PortInfo { port: number; protocol: string; address: string; pid: number; name: string; }
// Live host metrics for the system-monitor bar (mirrors server/src/types.ts; keep in sync by hand).
// Bytes for memory; bytes/sec for network (rx = download/↓, tx = upload/↑).
export interface SystemStats {
  cpu: { percent: number };
  mem: { used: number; total: number; percent: number };
  net: { rxBytesPerSec: number; txBytesPerSec: number };
}
export interface AttentionItem { terminalId: string; workspaceId: string; workspaceName: string; title: string; }
export interface AttentionResponse { attention: AttentionItem[]; }
// Agents actively working/thinking right now (mirrors server/src/activity/working.ts; keep in sync).
export interface WorkingItem { terminalId: string; workspaceId: string; }
export interface WorkingResponse { working: WorkingItem[]; }
// Claude usage meter widget (mirrors server/src/claude/meter.ts; keep in sync by hand).
export interface ClaudeUsageWindow { pct: number; resetsAt: string | null; }
export type MeterLevel = "ok" | "warn" | "over";
// Forward-looking pacing payload the meters render (mirrors server/src/meters/pace.ts PaceResult;
// keep in sync by hand). Drives the "Today" panel + week-ring color + footer projection.
export interface MeterPace {
  perDay: number;
  todayBudget: number;      // % the day's forward budget allows
  usedToday: number;        // % of the weekly limit spent since local midnight
  todayRemaining: number;   // todayBudget − usedToday (negative = over budget)
  paceDelta: number;        // + ahead of the even weekly split, − under it
  projectedWeekEnd: number; // where the week ends if today's rate holds (%)
  level: MeterLevel;        // today's pressure → fill/dot color
  weekLevel: MeterLevel;    // week posture → weekly-ring color
}
// The fields a usage poll gains server-side (server/src/meters/decorate.ts).
export interface MeterDecoration {
  at: number;               // epoch-ms the pace was computed (drives the "updated HH:MM" footer)
  sessionResetMins: number;
  weeklyResetMins: number;
  pace: MeterPace;
}
export type ClaudeUsageResult =
  | ({ available: true; fetchedAt: string; session: ClaudeUsageWindow; weekly: ClaudeUsageWindow; status: string } & MeterDecoration)
  | { available: false; reason: string };
// Codex usage meter widget (mirrors server/src/codex/meter.ts; keep in sync by hand). Same window
// shape as Claude — `session` is Codex's `primary` (5h), `weekly` is `secondary` — plus the plan tier.
export type CodexUsageResult =
  | ({ available: true; fetchedAt: string; session: ClaudeUsageWindow; weekly: ClaudeUsageWindow; status: string; planType: string | null } & MeterDecoration)
  | { available: false; reason: string };
// A widget dropped onto a space's canvas (mirrors server/src/types.ts SpaceWidget; keep in sync by
// hand). `kind` selects which widget renders; `config` is opaque per-instance JSON. x/y/w/h are
// canvas geometry like a StickyNote.
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
// "Better Comments" tag config (mirrors server/src/types.ts; keep in sync by hand).
export interface CommentTag {
  tag: string; color: string; bold: boolean; italic: boolean; underline: boolean; strikethrough: boolean; backgroundColor: string;
}
export interface BetterCommentsConfig { enabled: boolean; tags: CommentTag[]; }

// Break / stand-up enforcer config (mirrors server/src/types.ts BreakSettings; keep in sync by
// hand). Client-side feature: the timer + overlay live in the browser; the server only persists
// this blob under the `breaks` settings key.
export interface BreakSettings {
  enabled: boolean;         // master on/off
  intervalMinutes: number;  // how often a break fires
  durationMinutes: number;  // how long the break lasts / the overlay counts down
  pauseWhenHidden: boolean; // don't accrue time while the tab is hidden (user away)
  preWarnSeconds: number;   // heads-up countdown before the screen locks (0 = lock immediately)
  allowSkip: boolean;       // show the mandatory "skip / keep working" escape button
  speak: boolean;           // read the break prompt aloud when it starts
}

// One entry in the curated voice roster (mirrors server/src/types.ts KeptVoice; keep in sync by
// hand). The browser enumerates the OS voices; the user trims them; the kept set is mirrored on the
// server so the picker AND notifying agents (GET /api/voices) can read it.
export interface KeptVoice { name: string; lang: string }

export interface SettingsResponse {
  defaultLaunchCommand: string;
  defaultShell: string;
  tokenSet: boolean;
  autoSave: boolean;
  autoSaveDelaySeconds: number;
  minimap: boolean;
  wordWrap: boolean;
  lineNumbers: boolean;
  diffSplit: boolean;
  sidebarPosition: "bottom" | "left" | "right" | "top";
  theme: string; // active theme id (roster in web/src/theme)
  sttProvider: "local" | "openai";
  openaiSttModel: string;
  openaiKeySet: boolean; // whether an OpenAI key is stored (the key itself is never sent)
  pushoverConfigured: boolean; // whether BOTH Pushover keys are stored (the keys themselves are never sent)
  micMode: "toggle" | "hold"; // mic button: click-to-toggle vs hold-to-talk (push-to-talk)
  attentionMode: "layered" | "explicit" | "silence"; // DORMANT — attention is bell-only now, not user-controlled
  silenceSeconds: number; // DORMANT — quiet-window (s); silence no longer fires attention (flooded every idle agent)
  headroomLauncherHidden: boolean; // user dismissed the "Claude (Headroom)" launcher card in the picker
  focusBarColor: string; // hex color of the focused-terminal bar (rendered client-side via a CSS var)
  tmuxStatusFg: string;  // hex foreground color of each terminal's tmux status bar (applied server-side)
  stageManagerEnabled: boolean; // master on/off for the Stage Manager feature
  stageManagerPosition: "left" | "right" | "top" | "bottom"; // which edge the Stage Manager dock anchors to
  betterComments: BetterCommentsConfig;
  canvasBackground: CanvasBackground; // global canvas/spaces backdrop default
  stageDock: StageDock; // Stage Manager dock frosted-panel background
  breaks: BreakSettings; // recurring full-screen break enforcer config
  agentSystemPrompts: Record<string, string>; // per-agent global system prompts (agent id → prompt text)
  removedAgents: string[]; // built-in agent ids the user removed from the New-terminal picker (re-addable)
}

/** Status for the special "Claude (Headroom)" launcher (GET /api/agents/headroom). */
export interface HeadroomStatus {
  installed: boolean;  // the `headroom` CLI is available
  running: boolean;    // the compression proxy is answering on the loopback port
  port: number;
  command: string;     // launch command (headroom wrap claude)
  installHint: string; // one-liner to install the CLI
  repoUrl: string;     // install / docs link
}

/** Live compression savings from the Headroom proxy (GET /api/agents/headroom/savings). Powers the
 *  "Headroom Savings" widget. `available:false` carries a reason (CLI absent / proxy down / no traffic). */
export type HeadroomSavings =
  | {
      available: true;
      tokensSaved: number;
      tokensBefore: number;
      tokensAfter: number;
      tokenSavingsPct: number;
      usdSaved: number;
      usdSavingsPct: number;
      cacheSavedUsd: number;
      avgCompressionPct: number;
      bestCompressionPct: number;
      requestsCompressed: number;
      apiRequests: number;
      primaryModel: string | null;
      at: number;
    }
  | { available: false; reason: string };

// --- speech-to-text (mirrors server/src/stt/controller.ts) ---
export type SttProvider = "local" | "openai";
export interface SttStatus {
  local: { running: boolean; ffmpeg: boolean };
  openai: { configured: boolean };
}
export interface TranscribeResult { text: string; providerUsed: SttProvider }

// --- git (mirrors server/src/git/types.ts + github.ts; keep in sync by hand) ---
export interface GitFileEntry { path: string; orig?: string; index: string; worktree: string; }
/** A submodule/gitlink with inner dirt — a drill-in target (commit inside its own repo). See server. */
export interface SubmoduleEntry { path: string; commitChanged: boolean; hasModifications: boolean; hasUntracked: boolean; }
export interface GitStatus {
  branch: string | null; upstream: string | null; ahead: number; behind: number; detached: boolean;
  staged: GitFileEntry[]; unstaged: GitFileEntry[]; untracked: string[]; conflicted: GitFileEntry[];
  remotes: string[]; // configured remote names; empty = repo has never been published
  submodules: SubmoduleEntry[]; // dirty submodules surfaced for drill-in (kept out of the change lists)
}
export interface GitRef { name: string; kind: "branch" | "remote" | "tag" | "head"; current: boolean; }
export interface GitCommit { hash: string; parents: string[]; author: string; email: string; date: number; refs: GitRef[]; subject: string; body: string; }
export interface GitBranch { name: string; current: boolean; upstream: string | null; }
export interface GitInfo { installed: boolean; version: string | null; isRepo: boolean; root: string | null; }
export interface GitWorktree { path: string; head: string | null; branch: string | null; bare: boolean; detached: boolean; locked: boolean; main: boolean; }
export interface StashEntry { ref: string; message: string; }
export interface CommitFile { status: string; path: string; }
/** Result of a non-destructive `git merge-tree` preview: clean, or the list of clashing paths. */
export interface MergePreview { clean: boolean; conflicts: string[]; }
/** How a PR is merged via `gh pr merge` (mirrors server PrMergeMethod). */
export type PrMergeMethod = "merge" | "squash" | "rebase";
export interface GithubInfo { installed: boolean; authed: boolean; }
export interface GithubOwners { login: string; orgs: string[]; }
/** One repo from `gh repo list`, for the New Workspace "browse my GitHub" picker (mirrors server). */
export interface GithubRepo { nameWithOwner: string; name: string; description: string; isPrivate: boolean; isFork: boolean; url: string; sshUrl: string; updatedAt: string; }
/** One signed-in `gh` account (gh can hold several — personal + work, even across hosts). */
export interface GithubAccount { host: string; login: string; active: boolean; }
/** An in-flight (or just-finished) async repo clone (mirrors server git/cloneJobs). `ws` is where the
 *  finished workspace card lands — the canvas renders the placeholder card at those coords meanwhile. */
export interface CloneJob {
  id: string; name: string; parent: string; path: string;
  source: "url" | "github"; url?: string; repo?: string;
  status: "running" | "done" | "error"; error?: string; createdAt: number;
  ws: { spaceId: string | null; x: number; y: number };
}
/** A signed-in account's resolved git commit identity (mirrors server). `email` is the account's
 *  noreply address when its GitHub profile email is private, so it's never blank. */
export interface GithubIdentity { login: string; name: string; email: string; }
/** Detected stacks + whether a `.gitignore` already exists, for the Initialize-repo dialog's preview. */
export interface GitignorePreview { ecosystems: { key: string; label: string }[]; exists: boolean }
export interface PullRequest { number: number; title: string; author: string; branch: string; state: string; url: string; draft: boolean; }
/** One PR with the fields an edit form needs. `body` is off the list shape on purpose — that list is
 *  polled every 30s and thirty descriptions is a lot of payload for a chip. */
export interface PullRequestDetail extends PullRequest { body: string; base: string; }
export interface ActionRun { id: number; name: string; title: string; status: string; conclusion: string | null; branch: string; event: string; createdAt: string; url: string; }

// --- claude/codex sessions (mirrors server/src/claude/types.ts; keep in sync by hand) ---
export type ClaudeAgent = "claude" | "codex";
export interface ClaudeSession {
  id: string; agentType: ClaudeAgent; title: string; firstPrompt?: string;
  messageCount: number; created: string; modified: string; gitBranch?: string;
  projectPath: string; isSidechain: boolean; jsonlPath: string; isRunning: boolean; parentSessionId?: string;
}
export interface SessionPref { pinned: boolean; color: string | null; }
export interface ClaudeSessionsResponse {
  claude: ClaudeSession[]; codex: ClaudeSession[]; prefs: Record<string, SessionPref>;
}
export type SessionActivityState = "active" | "waiting" | "finished" | "idle";
export type SessionEntryType = "User" | "Assistant" | "System" | "Progress" | "Other";
export interface SessionEntryLite { lineIndex: number; entryType: SessionEntryType; preview: string; timestamp?: string; checkable: boolean; }
export interface SessionMessage { role: "user" | "assistant"; content: string; }
export interface SessionMessagesResponse { messages: SessionMessage[]; total: number; }
export interface SessionUsage {
  inputTokens: number; outputTokens: number; cacheWrite5mTokens: number; cacheWrite1hTokens: number;
  cacheReadTokens: number; totalTokens: number; estimatedCostUSD: number; messageCount: number;
  models: Record<string, number>;
  perModel: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number }>;
}

// --- skills (mirrors server/src/skills/types.ts; keep in sync by hand) ---
export type SkillScope = "workspace" | "global";
export type SkillSourceType = "git" | "github" | "gitlab" | "direct-url" | "local" | "registry";
export interface InstalledSkill {
  installPath: string;
  name: string;          // folder name = install identity
  displayName: string;   // frontmatter name (falls back to folder name)
  description: string | null;
  scope: SkillScope;
  enabled: boolean;
  sourceType: SkillSourceType | null;
  sourceUrl: string | null;
  updateAvailable: boolean | null;
}
export interface SkillCandidate { name: string; description: string; relPath: string; }
export interface SkillScanResult { tmpId: string; candidates: SkillCandidate[]; }
export interface SkillUpdateStatus { installPath: string; updateAvailable: boolean | null; }
export interface RegistrySkill { id: string; skillId: string; name: string; installs: number; source: string; }
export interface CatalogSource { source: string; addedAt: number; lastIndexedAt: number | null; skillCount: number; error: string | null; official: boolean; }
export interface CatalogEntry { source: string; name: string; description: string | null; relPath: string | null; official: boolean; }

// --- ai providers (mirrors server/src/ai/types.ts) ---
export type AiProviderKind = "cli" | "openai-compatible" | "anthropic";
export interface AiProvider {
  id: string; kind: AiProviderKind; label: string; enabled: boolean;
  model?: string; baseUrl?: string; apiKey?: string; apiKeyEnv?: string; command?: string[];
}
/** What GET /api/ai/providers returns: the secret is stripped, replaced by booleans. */
export interface AiProviderPublic extends Omit<AiProvider, "apiKey"> { apiKeySet: boolean; apiKeyFromEnv: boolean; }
export interface AiProvidersResponse {
  providers: AiProviderPublic[]; defaultProviderId: string | null;
  commitPrompt: string | null; // custom commit-message instructions; null = using defaultCommitPrompt
  defaultCommitPrompt: string; // the built-in default, for display + "reset to default"
  prPrompt: string | null; // custom PR-description instructions; null = using defaultPrPrompt
  defaultPrPrompt: string; // the built-in PR prompt, for display + "reset to default"
  detectedClis: { id: string; label: string; command: string[] }[]; // installed coding CLIs to offer in "Add:"
}
/** Prompt Builder wizard inputs (mirrors server/src/ai/promptBuilder.ts). */
export interface PromptBuilderInputs {
  idea: string; targetTool: string;
  outputFormat?: string; constraints?: string; audience?: string;
}
/** One build-with engine: a configured provider, or a detected CLI (id `builtin:<agent>`). */
export interface BuilderEngine { id: string; label: string; tool: string; }
/** GET /api/ai/builder — only the engines/tools the user actually has. */
export interface AiBuilderResponse {
  engines: BuilderEngine[]; targetTools: string[]; defaultEngineId: string | null;
  defaultChatEngineId: string | null; // the canvas chat box's default pick (codex-first priority)
}
/** One turn of the floating canvas chat (mirrors server/src/ai/chat.ts). */
export interface AiChatMessage { role: "user" | "assistant"; content: string }
/** A canvas edit the AI assistant asks for (mirrors server/src/ai/chatOps.ts BlueprintOp). New
 *  nodes are referenced by a model-invented `tempId`; existing nodes/edge endpoints by their real
 *  id. `branch` is a fork's source handle (yes/no, body/done, ok/fail, c0…/else). */
export type BlueprintOp =
  | { op: "add"; tempId: string; kind: BlueprintNodeKind; label?: string; description?: string; cases?: string[] }
  | { op: "update"; id: string; label?: string; description?: string; kind?: BlueprintNodeKind; cases?: string[] }
  | { op: "delete"; id: string }
  | { op: "connect"; from: string; to: string; branch?: string | null }
  | { op: "disconnect"; from: string; to: string; branch?: string | null };
/** What POST /api/ai/chat returns: the reply bubble text + canvas ops to apply (empty when the AI
 *  is only talking). */
export interface AiChatResponse { reply: string; ops: BlueprintOp[] }

// --- Program blueprints: the Prompt Builder's node canvas. Mirrors server/src/types.ts; the graph
// is React-Flow-native so the canvas stores/loads it without mapping. The server treats it opaquely.
export type BlueprintNodeKind =
  | "start" | "action" | "condition" | "loop" | "switch"
  | "parallel" | "try" | "param" | "group" | "end";
export interface BlueprintNode {
  id: string;
  type: BlueprintNodeKind;
  position: { x: number; y: number };
  data: { label: string; description?: string; cases?: string[] }; // cases: the labels of a switch node's branches
}
export interface BlueprintEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null; // branch handle: yes/no (condition), body/done (loop), ok/fail (try), c0…/else (switch); null otherwise
}
export interface BlueprintGraph { nodes: BlueprintNode[]; edges: BlueprintEdge[]; }
export interface BlueprintSummary { id: string; name: string; createdAt: number; updatedAt: number; }
// `chat` is the saved AI-assistant transcript for this prompt session (empty when none was saved).
export interface Blueprint extends BlueprintSummary { graph: BlueprintGraph; chat: AiChatMessage[]; }

// --- Find-in-files (Explorer Search tab). Mirrors server/src/fs/search.ts. ---
/** One match in a file. `col` is the 0-based column in the FULL line (jump + replace target); `text`
 *  is the line clipped for display and `matchStart` is the match's index within that clipped text. */
export interface SearchMatch { line: number; col: number; length: number; text: string; matchStart: number; }
export interface SearchFileResult { path: string; name: string; matches: SearchMatch[]; }
export interface SearchResponse { results: SearchFileResult[]; total: number; fileCount: number; truncated: boolean; error?: string; }
/** A replace target: a file, optionally narrowed to specific (line,col) matches (else all in the file). */
export interface SearchReplaceTarget { path: string; matches?: { line: number; col: number }[]; }

// --- Calendar reminders + scheduled notifications (mirrors server/src/types.ts; keep in sync by
// hand). Every instant is epoch-ms UTC — an absolute moment; the browser converts to/from the
// viewer's local zone for display and the date/time pickers. ---
export type NotifyLevel = "info" | "success" | "warn" | "error";
/** The notification center's filter + color bucket (mirrors server NotifyCategory). */
export type NotifyCategory = "agent" | "error" | "info";
export type ReminderStatus = "pending" | "snoozed" | "fired" | "cancelled" | "missed";
export type RecurrenceFreq = "daily" | "weekly" | "monthly" | "yearly";
/** Which channels fire when a reminder comes due. inApp = toast/notify bus; speak = read it aloud
 *  (TTS); pushover = push to the phone (only if Pushover is configured). */
export interface NotifyChannels { inApp: boolean; pushover: boolean; speak: boolean }
/** A repeat rule. interval = every N units; until caps by instant (epoch ms), count by occurrence
 *  count; both null = open-ended. */
export interface Recurrence { freq: RecurrenceFreq; interval: number; until: number | null; count: number | null }
export interface Reminder {
  id: string;
  title: string;
  body: string;                  // description ("" = none)
  fireAt: number;                // epoch ms — event start / where the calendar chip sits
  allDay: boolean;
  endAt: number | null;          // epoch ms — optional span end; null = point event
  leadMinutes: number;           // alert this many minutes BEFORE fireAt (0 = at fireAt)
  color: string | null;          // calendar-chip accent (hex); null = default
  imagePath: string | null;      // GET /api/reminders/:id/image URL when an image is attached; else null
  channels: NotifyChannels;
  level: NotifyLevel;
  priority: number;              // Pushover priority -2..2 (2 = emergency); ignored in-app
  recurrence: Recurrence | null; // repeat rule; null = one-time
  status: ReminderStatus;
  snoozeUntil: number | null;    // epoch ms a snoozed reminder re-fires at; null unless snoozed
  firedAt: number | null;        // epoch ms of the last fire; null until first fired
  wasMissed: boolean;            // fired late by boot catch-up
  createdAt: number;
  updatedAt: number;
}
/** A persisted notification — the durable record the notification center reads (mirrors server). */
export interface AppNotification {
  id: string;
  reminderId: string | null;
  title: string;
  body: string;
  level: NotifyLevel;
  category: NotifyCategory;     // center bucket: "agent" | "error" | "info"
  imagePath: string | null;
  workspaceId: string | null;  // deep-link target: clicking opens this room…
  terminalId: string | null;   // …and focuses this terminal (agent notifications carry both)
  wasMissed: boolean;
  pushover: boolean;          // a Pushover send was attempted for this fire
  pushoverOk: boolean | null; // true = delivered, false = failed, null = not attempted
  read: boolean;
  firedAt: number;
  createdAt: number;
}
/** Pushover monthly message quota (from the X-Limit-App-* response headers). `reset` is epoch SECONDS
 *  (Pushover's own unit) when the monthly counter rolls over. */
export interface PushoverQuota { limit: number; remaining: number; reset: number }

// ── Copilot ── (mirror of server/src/types.ts — keep in sync by hand)
export type CopilotReportChannel = "toast" | "voice" | "pushover";
export type CopilotOrbPosition = "bottom-right" | "bottom-left" | "top-right" | "top-left";
export interface CopilotSettings {
  enabled: boolean;
  defaultEngine: string | null;
  reportChannels: CopilotReportChannel[];
  confirmDangerous: boolean;
  orbEnabled: boolean;
  orbPosition: CopilotOrbPosition;
}
export interface CopilotConversation { id: string; title: string; createdAt: number; updatedAt: number; }
export type CopilotTextBlock = { type: "text"; text: string };
export type CopilotToolUseBlock = { type: "tool_use"; id: string; name: string; input: unknown };
export type CopilotToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string };
export type CopilotContentBlock = CopilotTextBlock | CopilotToolUseBlock | CopilotToolResultBlock;
export interface CopilotMessage { id: string; role: "user" | "assistant"; content: CopilotContentBlock[]; createdAt: number }
// Frames the /ws/copilot gateway streams to the client (mirror of the server's CopilotEvent + done).
export type CopilotFrame =
  | { type: "token"; delta: string }
  | { type: "tool_call"; callId: string; name: string; args: unknown }
  | { type: "tool_result"; callId: string; ok: boolean; summary: string }
  | { type: "confirm_request"; callId: string; name: string; args: unknown }
  | { type: "assistant_message"; message: { role: "user" | "assistant"; content: CopilotContentBlock[] } }
  | { type: "final"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };
export interface CopilotSkillCard {
  id: string; name: string; description: string; icon: string;
  builtin: boolean; accountsProvider: boolean; examples: string[]; enabled: boolean;
}
// A connected skill account as the browser sees it — never the secret (just whether one is stored).
export interface CopilotSkillAccount { id: string; skillId: string; label: string; provider: string; config: Record<string, unknown>; hasSecret: boolean; createdAt: number; }
// An MCP tool server the Copilot connects to (env values are never sent — only the key names).
export type CopilotMcpTransport = "stdio" | "http";
export interface CopilotMcpToolInfo { name: string; description: string; inputSchema: Record<string, unknown>; }
export interface CopilotMcpServer {
  id: string; label: string; transport: CopilotMcpTransport;
  command: string[]; url: string | null; envKeys: string[];
  enabled: boolean; tools: CopilotMcpToolInfo[];
  status: "ok" | "error" | "unknown"; lastError: string | null;
  createdAt: number; updatedAt: number;
}
export interface CopilotMcpImportable { name: string; transport: CopilotMcpTransport; command: string[]; url: string | null; envKeys: string[]; }
// A scheduled loop: one tool run on an interval, reported per reportMode.
export type CopilotReportMode = "always" | "on-change" | "on-find";
export interface CopilotJob {
  id: string; title: string; tool: string; args: Record<string, unknown>;
  intervalSec: number; reportMode: CopilotReportMode; enabled: boolean;
  nextRun: number; lastRun: number | null; lastSummary: string | null;
  createdAt: number; updatedAt: number;
}

// ── TV / Media tool ── (mirrors server/src/tv/normalize.ts + routes/tv.ts — keep in sync by hand)
export type TvSource = "tv" | "radio" | "youtube";
export interface TvStream { url: string; quality: string | null; referrer: string | null; userAgent: string | null }
export interface TvChannel {
  id: string; name: string; logo: string | null; categories: string[];
  country: { code: string; name: string; flag: string } | null;
  languages: string[]; isNsfw: boolean; streams: TvStream[];
}
export interface TvFacets {
  categories: { id: string; name: string; count: number }[];
  countries: { code: string; name: string; flag: string; count: number }[];
  languages: { code: string; name: string; count: number }[];
}
export interface TvCatalog { channels: TvChannel[]; facets: TvFacets }
export interface RadioStation { id: string; name: string; favicon: string; url: string; codec: string; bitrate: number; country: string; tags: string[] }
export interface RadioFacets {
  tags: { name: string; stationcount?: number }[];
  countries: { name: string; iso_3166_1?: string; stationcount?: number }[];
}
export interface YouTubeItem { videoId: string; title: string; channelTitle: string; thumbnail: string; publishedAt: string }
export interface YouTubeSearchResult { items: YouTubeItem[]; nextPageToken?: string }
export interface YouTubePlaylistResult { items: YouTubeItem[]; nextPageToken?: string }
export interface YouTubePlaylistInfo { id: string; title: string; channelTitle: string; thumbnail: string }
// YouTube persistent deletions. playlistId "" = banned everywhere; a real playlist id = removed from
// that playlist only. The snapshot fields render the restore lists without re-fetching from YouTube.
export interface YtHidden { videoId: string; playlistId: string; title: string; channelTitle: string; thumbnail: string; hiddenAt: number }
export interface YtHideInput { videoId: string; title: string; channelTitle: string; thumbnail: string }
export interface TvFavorite { id: string; source: TvSource; ref: string; name: string; logo: string | null; meta: string | null; createdAt: number }
export interface TvRecent { id: string; source: TvSource; ref: string; name: string; logo: string | null; playedAt: number }
export interface TvSettings { hasYoutubeKey: boolean; nsfw: boolean; volume: number }
