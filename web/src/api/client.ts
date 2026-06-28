import type {
  Workspace, Folder, Space, SpaceConfig, SpaceCatalog, SpacePreset, SpaceSeedReport, SeedResult, InstalledSet, InstallKind, CanvasBackground, Wallpaper, WallpaperData, Terminal, FsListing, FsFile, FsFileBytes, DriveAccountPublic, DriveEntry, AgentsResponse, HeadroomStatus, HeadroomSavings, CustomAgent, ProcessInfo, PortInfo, AttentionResponse, WorkingResponse, ClaudeUsageResult, CodexUsageResult,
  GitInfo, GitStatus, GitCommit, GitBranch, GitWorktree, StashEntry, CommitFile, MergePreview, PrMergeMethod, GithubInfo, GithubOwners, GithubRepo, GithubAccount, GithubIdentity, GitignorePreview, PullRequest, ActionRun,
  SystemStats,
  AiProvider, AiProviderKind, AiProvidersResponse, PromptBuilderInputs, AiBuilderResponse, AiChatMessage, AiChatResponse, SettingsResponse, KeptVoice, Bookmark, FavoriteGroup, Favorite, Note, NoteGroup, Link, LinkFolder, StickyNote, SpaceWidget, SpaceWidgetKind, BoardCard, BoardColumn, TimeEntry, TimeClient, TimeProject, TimeTask, SttStatus, TranscribeResult,
  Blueprint, BlueprintSummary, BlueprintGraph,
  ClaudeAgent, ClaudeSessionsResponse, SessionMessagesResponse, SessionUsage, SessionEntryLite,
  SkillScope, InstalledSkill, SkillScanResult, SkillUpdateStatus, RegistrySkill, CatalogSource, CatalogEntry,
  LanguageServerInfo,
  SearchResponse, SearchReplaceTarget,
  Reminder, Recurrence, NotifyChannels, NotifyLevel, ReminderStatus, AppNotification, PushoverQuota,
  AccessKey, PresenceSession, TunnelStatus,
  CopilotSettings, CopilotConversation, CopilotMessage, CopilotSkillCard, CopilotSkillAccount, CopilotJob, CopilotReportMode,
  CopilotMcpServer, CopilotMcpImportable, CopilotMcpTransport,
} from "./types";

const TOKEN_KEY = "terminalhub_token";
export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t: string) { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken() { localStorage.removeItem(TOKEN_KEY); }

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const t = getToken(); if (t) headers["authorization"] = `Bearer ${t}`;
  // Only send a JSON content-type when there's actually a body — otherwise Fastify
  // rejects the bodyless DELETE/GET with FST_ERR_CTP_EMPTY_JSON_BODY (400).
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.json();
}

/** POST raw bytes (e.g. a zip archive) instead of JSON, with the auth header attached. The Blob
 *  wrapper carries the content-type and sidesteps fetch's BodyInit typing for a bare Uint8Array. */
async function reqBinary<T>(url: string, contentType: string, bytes: Uint8Array): Promise<T> {
  const headers: Record<string, string> = {};
  const t = getToken(); if (t) headers["authorization"] = `Bearer ${t}`;
  // fflate's output is always backed by a plain ArrayBuffer (never SharedArrayBuffer), so the cast
  // to satisfy BlobPart's ArrayBuffer-backed view requirement is sound and copy-free.
  const res = await fetch(url, { method: "POST", headers, body: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: contentType }) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.json();
}

/** Fetch a route that streams raw bytes (e.g. Drive's /api/drive/file) with the Bearer header
 *  attached, then wrap the body in an object URL for an <img>/<iframe> src. The codebase carries
 *  auth in the Authorization header — never on the URL — so a binary src goes through an authed
 *  fetch + blob: URL (same pattern as PdfView), not a token query string. Caller revokes the URL. */
async function authedBlobUrl(url: string): Promise<string> {
  const headers: Record<string, string> = {};
  const t = getToken(); if (t) headers["authorization"] = `Bearer ${t}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return URL.createObjectURL(await res.blob());
}

/** Fetch a byte-streaming route (Drive's /api/drive/file) as text, auth header attached — the File
 *  Browser editor reads a Drive text file's content this way (mirrors authedBlobUrl, but decoded). */
async function authedText(url: string): Promise<string> {
  const headers: Record<string, string> = {};
  const t = getToken(); if (t) headers["authorization"] = `Bearer ${t}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.text();
}

/** Send a raw body to a route with an explicit method (Drive content update PATCHes new file bytes
 *  as application/octet-stream). Returns the route's JSON. */
async function reqBinaryBody<T>(method: string, url: string, body: BodyInit): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/octet-stream" };
  const t = getToken(); if (t) headers["authorization"] = `Bearer ${t}`;
  const res = await fetch(url, { method, headers, body });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.json();
}

/** POST raw file bytes to a route that wants a binary body (Drive upload), with the auth header. The
 *  body is sent as application/octet-stream so the server's scoped buffer parser handles any file
 *  type; the real MIME is inferred from the name server-side. Returns the route's JSON. */
async function reqBinaryFile<T>(url: string, file: File): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/octet-stream" };
  const t = getToken(); if (t) headers["authorization"] = `Bearer ${t}`;
  const res = await fetch(url, { method: "POST", headers, body: await file.arrayBuffer() });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.json();
}

// Build the /api/drive/list query string (account + a folder id OR a special root).
function driveListUrl(account: string, opts: { folder?: string; root?: string }): string {
  const p = new URLSearchParams({ account });
  if (opts.folder) p.set("folder", opts.folder);
  if (opts.root) p.set("root", opts.root);
  return `/api/drive/list?${p}`;
}
export const api = {
  listWorkspaces: () => req<{ workspaces: Workspace[] }>("GET", "/api/workspaces"),
  createWorkspace: (b: { name: string; folder: string; launchCommand?: string; color?: string | null; x?: number; y?: number; spaceId?: string }) =>
    req<{ workspace: Workspace }>("POST", "/api/workspaces", b),
  updateWorkspace: (id: string, b: Partial<{ name: string; folder: string; launchCommand: string; color: string | null; cardColor: string | null; layout: string | null; spaceId: string; folderId: string | null; config: SpaceConfig | null; systemPrompt: { text: string; includeGlobal: boolean } | null; x: number; y: number }>) =>
    req<{ workspace: Workspace }>("PATCH", `/api/workspaces/${id}`, b),
  deleteWorkspace: (id: string) => req<{ ok: true }>("DELETE", `/api/workspaces/${id}`),
  // Canvas folders (iPhone-style card groups). `create` can seed members in one shot (the group
  // gesture); `remove` dissolves the folder server-side (members' folderId cleared → back to canvas).
  folders: {
    list: () => req<{ folders: Folder[] }>("GET", "/api/folders"),
    create: (b: { spaceId?: string | null; name?: string; x: number; y: number; memberIds?: string[] }) =>
      req<{ folder: Folder }>("POST", "/api/folders", b),
    update: (id: string, patch: Partial<{ spaceId: string | null; name: string; x: number; y: number }>) =>
      req<{ folder: Folder }>("PATCH", `/api/folders/${id}`, patch),
    remove: (id: string) => req<{ ok: true }>("DELETE", `/api/folders/${id}`),
  },
  // Per-workspace wizard: apply this workspace's effective (space ⊕ own) config to its folder now.
  seedWorkspace: (id: string) => req<{ result: SeedResult | null }>("POST", `/api/workspaces/${id}/seed`),
  // What's actually installed in a workspace folder right now (disk truth for the setup modal).
  installed: (id: string) => req<{ installed: InstalledSet }>("GET", `/api/workspaces/${id}/installed`),
  // Install one global skill/command/MCP server into a workspace folder; returns the re-read installed
  // set so the UI only promotes the item once disk confirms it landed.
  installItem: (id: string, b: { kind: InstallKind; name: string }) =>
    req<{ installed: InstalledSet; result: SeedResult }>("POST", `/api/workspaces/${id}/install`, b),
  listSpaces: () => req<{ spaces: Space[]; homeSpaceId: string | null; desktopWorkspaceId: string | null }>("GET", "/api/spaces"),
  createSpace: (b: { name: string; icon?: string | null; color?: string | null; config?: SpaceConfig | null }) =>
    req<{ space: Space }>("POST", "/api/spaces", b),
  updateSpace: (id: string, b: Partial<{ name: string; icon: string | null; color: string | null; background: CanvasBackground | null; config: SpaceConfig | null }>) =>
    req<{ space: Space }>("PATCH", `/api/spaces/${id}`, b),
  moveSpace: (id: string, index: number) => req<{ ok: true }>("POST", `/api/spaces/${id}/move`, { index }),
  deleteSpace: (id: string) => req<{ ok: true }>("DELETE", `/api/spaces/${id}`),
  // Space Creation Wizard: the global catalog the wizard offers, an explicit re-seed of a space's
  // workspaces, and the reusable preset templates.
  spaceCatalog: () => req<SpaceCatalog>("GET", "/api/space-catalog"),
  seedSpace: (id: string) => req<{ results: SpaceSeedReport[] }>("POST", `/api/spaces/${id}/seed`),
  spacePresets: {
    list: () => req<{ presets: SpacePreset[] }>("GET", "/api/space-presets"),
    create: (b: { name: string; icon?: string | null; config: SpaceConfig }) =>
      req<{ preset: SpacePreset }>("POST", "/api/space-presets", b),
    update: (id: string, b: Partial<{ name: string; icon: string | null; config: SpaceConfig }>) =>
      req<{ preset: SpacePreset }>("PATCH", `/api/space-presets/${id}`, b),
    remove: (id: string) => req<{ ok: true }>("DELETE", `/api/space-presets/${id}`),
  },
  createTerminal: (wsId: string, b: { title?: string; color?: string | null; launchCommandOverride?: string | null; agentId?: string | null; systemPrompt?: { text: string; includeParent: boolean } | null; kickoff?: string | null }) =>
    req<{ terminal: Terminal }>("POST", `/api/workspaces/${wsId}/terminals`, b),
  // `auto: true` flags an auto-titler update (leaves the tab unlocked); omit it for a user rename,
  // which pins the name so the auto-titler won't overwrite it.
  updateTerminal: (id: string, b: Partial<{ title: string; color: string | null; icon: string | null; auto: boolean }>) =>
    req<{ terminal: Terminal }>("PATCH", `/api/terminals/${id}`, b),
  // Reorder a terminal within its workspace's list. `index` = target slot in the rendered order.
  moveTerminal: (id: string, index: number) =>
    req<{ terminal: Terminal }>("POST", `/api/terminals/${id}/move`, { index }),
  deleteTerminal: (id: string) => req<{ ok: true }>("DELETE", `/api/terminals/${id}`),
  // Full scrollback of a terminal's tmux pane as plain text (history + live screen), for the buffer
  // viewer + copy-all. `lines` optionally caps to the last N history lines; omitted = the whole buffer.
  terminalScrollback: (id: string, lines?: number) =>
    req<{ text: string }>("GET", `/api/terminals/${id}/scrollback${lines ? `?lines=${lines}` : ""}`),
  // Colored "thumbnail" of a terminal's current screen (ANSI preserved), for the Stage Manager dock.
  // Point-in-time; works even when no PTY is attached (capture is server-side).
  terminalPreview: (id: string) =>
    req<{ content: string }>("GET", `/api/terminals/${id}/preview`),
  // Wipe a terminal's tmux scrollback history (the off-screen buffer). The live screen is untouched.
  // Irreversible — callers confirm first.
  clearTerminalScrollback: (id: string) => req<{ ok: true }>("POST", `/api/terminals/${id}/clear-history`),
  // Clean auto-title for a terminal running a Claude session, derived from its transcript's first
  // prompt (same source as the session browser). null when no Claude session is detected yet.
  terminalAgentTitle: (id: string) =>
    req<{ title: string | null }>("GET", `/api/terminals/${id}/agent-title`),
  // Resolve a Cmd/Ctrl-clicked terminal path token to an absolute path + kind (relative tokens
  // resolve against the pane's live cwd; ~ expands to the host home). Drives the terminal link opener.
  resolveTerminalPath: (wsId: string, tid: string, text: string) =>
    req<{ path: string; type: "file" | "dir" | "missing" }>(
      "GET", `/api/workspaces/${wsId}/terminals/${tid}/resolve-path?text=${encodeURIComponent(text)}`),
  // Upload a pasted clipboard image to the host; returns the workspace-relative path and the
  // ready-to-insert text (@-mention for Claude, plain path otherwise).
  clipImage: (wsId: string, terminalId: string, b: { imageBase64: string; mimeType: string }) =>
    req<{ path: string; insert: string }>("POST", `/api/workspaces/${wsId}/terminals/${terminalId}/clip-image`, b),
  fsVolumes: () => req<{ volumes: { name: string; path: string }[] }>("GET", "/api/fs/volumes"),
  fsList: (path: string, all = false) => req<FsListing>("GET", `/api/fs/list?path=${encodeURIComponent(path)}${all ? "&all=true" : ""}`),
  // Flat filename index for the "Filter Files" tab — fetched once per root, fuzzy-filtered client-side.
  fsFiles: (root: string) => req<{ files: string[]; truncated: boolean }>("GET", `/api/fs/files?root=${encodeURIComponent(root)}`),
  fsReadFile: (path: string) => req<FsFile>("GET", `/api/fs/file?path=${encodeURIComponent(path)}`),
  // Direct streaming URL for a host video file — feeds a <video src> with HTTP byte-range support, the
  // only path 4K/large files can take (the base64 file-bytes route holds the whole file in memory and
  // caps at 25 MiB). Auth on an exposed instance rides the preview cookie (call previewSession() first,
  // like the iframe preview); loopback needs none. See server/src/routes/media.ts.
  mediaFileUrl: (path: string) => `/api/media/file?path=${encodeURIComponent(path)}`,
  fsWriteFile: (path: string, content: string) => req<{ path: string; size: number }>("PUT", "/api/fs/file", { path, content }),
  // Raw bytes for the rich (binary) editors — docx, etc. — base64 in/out.
  fsReadFileBytes: (path: string) => req<FsFileBytes>("GET", `/api/fs/file-bytes?path=${encodeURIComponent(path)}`),
  fsWriteFileBytes: (path: string, dataBase64: string) => req<{ path: string; size: number }>("PUT", "/api/fs/file-bytes", { path, dataBase64 }),
  // Render the Word editor's HTML to a .docx on the server (Node) and write it.
  fsWriteDocx: (path: string, html: string) => req<{ path: string; size: number }>("POST", "/api/fs/docx", { path, html }),
  fsCreateFile: (path: string) => req<{ path: string }>("POST", "/api/fs/create", { path }),
  fsMkdir: (path: string) => req<{ path: string }>("POST", "/api/fs/mkdir", { path }),
  fsRename: (from: string, to: string) => req<{ path: string }>("POST", "/api/fs/rename", { from, to }),
  fsCopy: (from: string, to: string) => req<{ path: string }>("POST", "/api/fs/copy", { from, to }),
  // Drag/paste a real OS file into a folder. `name` may include subdirs (a dropped folder's tree);
  // bytes are base64 (binary-safe). Server creates missing parents and rejects names escaping `dir`.
  fsUpload: (dir: string, name: string, dataBase64: string) =>
    req<{ path: string; size: number }>("POST", "/api/fs/upload", { dir, name, dataBase64 }),
  // Desktop-style Paste (local only): copy whatever files/folders are on the host OS clipboard into
  // `dir` with a real recursive cp. Returns the created destination paths (empty = clipboard had no
  // files). 403s when the request is exposed (a tunnel mustn't read the host's clipboard).
  fsPasteClipboard: (dir: string) => req<{ pasted: string[] }>("POST", "/api/fs/paste-clipboard", { dir }),
  // Upload a folder / multiple files as one zip — the server unpacks it into `dir`. One round-trip
  // for a whole tree (the workable path on a remote VPS, where the host can't read your clipboard).
  fsUploadZip: (dir: string, archive: Uint8Array) =>
    reqBinary<{ pasted: string[]; files: number }>(`/api/fs/upload-zip?dir=${encodeURIComponent(dir)}`, "application/zip", archive),
  fsDelete: (path: string) => req<{ path: string }>("POST", "/api/fs/delete", { path }),
  // --- Google Drive mounted in the File Browser. Read routes (Phase 1) + write routes (Phase 3).
  // 501 "not configured" when Google creds are unset; the browser only ever sees mapped entries +
  // bytes — refresh tokens stay server-side. ---
  // Client-credential config (set from Settings). The secret is write-only: driveSetConfig POSTs it,
  // but driveGetConfig never returns it — only `configured`, the public clientId, where it came from,
  // and the (non-secret) redirect-URI override.
  driveGetConfig: () => req<{ configured: boolean; clientId: string | null; source: "settings" | "env" | null; redirect: string | null }>("GET", "/api/drive/config"),
  driveSetConfig: (b: { clientId: string; clientSecret: string }) => req<{ ok: true }>("POST", "/api/drive/config", b),
  driveSetRedirect: (redirect: string) => req<{ ok: true }>("POST", "/api/drive/redirect", { redirect }),
  driveClearConfig: () => req<{ ok: true }>("DELETE", "/api/drive/config"),
  driveAccounts: () => req<{ accounts: DriveAccountPublic[] }>("GET", "/api/drive/accounts"),
  driveConnectUrl: () => req<{ url: string }>("GET", "/api/drive/connect"),
  driveRenameAccount: (id: string, label: string) => req<{ ok: true }>("PATCH", `/api/drive/accounts/${id}`, { label }),
  driveDisconnect: (id: string) => req<{ ok: true }>("DELETE", `/api/drive/accounts/${id}`),
  driveList: (account: string, opts: { folder?: string; root?: string }) =>
    req<{ entries: DriveEntry[] }>("GET", driveListUrl(account, opts)),
  // QuickLook bytes: the server streams the right Content-Type (PDF for native docs); we fetch them
  // authed and hand back a blob: URL for the <img>/<iframe> src (caller revokes it).
  driveFileUrl: (account: string, id: string): Promise<string> =>
    authedBlobUrl(`/api/drive/file?account=${encodeURIComponent(account)}&id=${encodeURIComponent(id)}`),
  // The File Browser editor: read a Drive text/code file's content, and save edited content back
  // (overwrites the same file id — never creates a copy). Both go through the streaming bytes route.
  driveReadText: (account: string, id: string): Promise<string> =>
    authedText(`/api/drive/file?account=${encodeURIComponent(account)}&id=${encodeURIComponent(id)}`),
  driveWriteText: (account: string, id: string, content: string) =>
    reqBinaryBody<{ id: string }>("PATCH", `/api/drive/file?account=${encodeURIComponent(account)}&id=${encodeURIComponent(id)}`, content),
  driveMkdir: (account: string, parentId: string, name: string) =>
    req<{ id: string }>("POST", "/api/drive/mkdir", { account, parentId, name }),
  driveRename: (account: string, id: string, name: string) =>
    req<{ id: string }>("POST", "/api/drive/rename", { account, id, name }),
  driveMove: (account: string, id: string, opts: { addParents?: string; removeParents?: string }) =>
    req<{ id: string }>("POST", "/api/drive/move", { account, id, ...opts }),
  driveDelete: (account: string, id: string) => req<{ id: string }>("POST", "/api/drive/delete", { account, id }),
  driveUpload: (account: string, parentId: string, name: string, file: File) =>
    reqBinaryFile<{ id: string }>(
      `/api/drive/upload?account=${encodeURIComponent(account)}&parent=${encodeURIComponent(parentId)}&name=${encodeURIComponent(name)}`,
      file),
  // Find-in-files for the Explorer Search tab.
  search: (b: { root: string; query: string; caseSensitive?: boolean; wholeWord?: boolean; regexp?: boolean; include?: string; exclude?: string; excludeBuild?: boolean; excludeSystem?: boolean }) =>
    req<SearchResponse>("POST", "/api/search", b),
  searchReplace: (b: { query: string; replace: string; caseSensitive?: boolean; wholeWord?: boolean; regexp?: boolean; targets: SearchReplaceTarget[] }) =>
    req<{ replaced: number; files: number }>("POST", "/api/search/replace", b),
  lspServers: () => req<{ servers: LanguageServerInfo[] }>("GET", "/api/lsp/servers"),
  listAgents: () => req<AgentsResponse>("GET", "/api/agents"),
  headroomStatus: () => req<HeadroomStatus>("GET", "/api/agents/headroom"),
  headroomSavings: () => req<HeadroomSavings>("GET", "/api/agents/headroom/savings"),
  createAgent: (b: { name: string; command: string; icon?: string | null; category?: string }) =>
    req<{ agent: CustomAgent }>("POST", "/api/agents", b),
  deleteAgent: (id: string) => req<{ ok: true }>("DELETE", `/api/agents/${id}`),
  listAttention: () => req<AttentionResponse>("GET", "/api/attention"),
  // Ping when an open terminal's agent rings the bell while its pane isn't focused — fires the same
  // needs-attention toast you'd get with the room closed (deduped server-side). See useTerminalSocket.
  notifyTerminalAttention: (terminalId: string, message?: string) =>
    req<{ ok: true; fired: boolean }>("POST", `/api/terminals/${terminalId}/attention`, message ? { message } : undefined),
  listWorking: () => req<WorkingResponse>("GET", "/api/working"),
  getClaudeUsage: (force?: boolean) => req<ClaudeUsageResult>("GET", `/api/claude-usage${force ? "?force=1" : ""}`),
  getCodexUsage: (force?: boolean) => req<CodexUsageResult>("GET", `/api/codex-usage${force ? "?force=1" : ""}`),
  systemStats: () => req<{ stats: SystemStats }>("GET", "/api/system/stats"),
  listProcesses: () => req<{ processes: ProcessInfo[] }>("GET", "/api/system/processes"),
  listPorts: () => req<{ ports: PortInfo[] }>("GET", "/api/system/ports"),
  killProcess: (pid: number, signal?: "TERM" | "KILL") => req<{ ok: true }>("POST", "/api/system/kill", { pid, signal }),
  revealPath: (path: string) => req<{ ok: true }>("POST", "/api/system/reveal", { path }),
  openPath: (path: string) => req<{ ok: true }>("POST", "/api/system/open", { path }),
  // Establish the localhost-preview cookie (HttpOnly) so iframe sub-resource requests carry auth on
  // a remote/exposed instance. Bearer-authed like the rest of /api/*; 204 on a tokenless instance.
  previewSession: async (): Promise<void> => {
    const headers: Record<string, string> = {};
    const t = getToken(); if (t) headers["authorization"] = `Bearer ${t}`;
    await fetch("/api/preview-session", { method: "POST", headers });
  },
  getSettings: () => req<SettingsResponse>("GET", "/api/settings"),
  updateSettings: (b: Partial<Omit<SettingsResponse, "tokenSet" | "openaiKeySet" | "pushoverConfigured">> & { openaiApiKey?: string; pushoverToken?: string; pushoverUser?: string }) =>
    req<{ ok: true }>("PATCH", "/api/settings", b),
  // User-uploaded canvas wallpapers. list() omits the bytes; get() returns the data URL for
  // rendering (the renderer caches it). create() takes base64 + mime, like clip-image / fs upload.
  wallpapers: {
    list: () => req<{ wallpapers: Wallpaper[] }>("GET", "/api/wallpapers"),
    get: (id: string) => req<{ wallpaper: WallpaperData }>("GET", `/api/wallpapers/${id}`),
    create: (b: { name: string; mimeType: string; dataBase64: string }) =>
      req<{ wallpaper: Wallpaper }>("POST", "/api/wallpapers", b),
    remove: (id: string) => req<{ ok: true }>("DELETE", `/api/wallpapers/${id}`),
  },
  // The curated voice roster (see /api/voices). list() is also what notifying agents read to pick
  // a voice; save() pushes the trimmed set after the user manages it in Settings.
  voices: {
    list: () => req<{ voices: KeptVoice[] }>("GET", "/api/voices"),
    save: (voices: KeptVoice[]) => req<{ ok: true }>("PUT", "/api/voices", { voices }),
  },
  stt: {
    status: () => req<SttStatus>("GET", "/api/stt/status"),
    transcribe: (b: { provider: "local" | "openai"; model?: string; audioBase64: string; mimeType: string }) =>
      req<TranscribeResult>("POST", "/api/stt/transcribe", b),
  },
  bookmarks: {
    list: (wsId: string) => req<{ bookmarks: Bookmark[] }>("GET", `/api/workspaces/${wsId}/bookmarks`),
    create: (wsId: string, b: { filePath: string; line: number; label?: string | null; preview?: string | null }) =>
      req<{ bookmark: Bookmark }>("POST", `/api/workspaces/${wsId}/bookmarks`, b),
    update: (id: string, b: { label?: string | null; line?: number }) =>
      req<{ bookmark: Bookmark }>("PATCH", `/api/bookmarks/${id}`, b),
    remove: (id: string) => req<{ ok: true }>("DELETE", `/api/bookmarks/${id}`),
    clearFile: (wsId: string, filePath: string) =>
      req<{ ok: true }>("DELETE", `/api/workspaces/${wsId}/bookmarks?filePath=${encodeURIComponent(filePath)}`),
    clearAll: (wsId: string) => req<{ ok: true }>("DELETE", `/api/workspaces/${wsId}/bookmarks`),
  },
  git: {
    info: (p: string) => req<GitInfo>("GET", `/api/git/info?path=${encodeURIComponent(p)}`),
    // Plain init, or scoped to a signed-in GitHub `account` (sets the repo-local commit identity),
    // optionally writing a stack-aware default `.gitignore` and making an initial `commit` (stages
    // everything + commits) — all in one server step.
    init: (p: string, opts?: { account?: string; host?: string; gitignore?: boolean; commit?: { message: string } }) =>
      req<{ ok: true }>("POST", "/api/git/init", { path: p, ...opts }),
    // Detected stacks + whether a .gitignore already exists, for the Initialize dialog's preview.
    gitignorePreview: (p: string) => req<GitignorePreview>("GET", `/api/git/gitignore-preview?path=${encodeURIComponent(p)}`),
    // Clone a remote repo into <parent>/<name> on the host; returns the new folder's path, which
    // the New Workspace flow then opens as a workspace.
    clone: (b: { url: string; parent: string; name: string }) => req<{ path: string }>("POST", "/api/git/clone", b),
    status: (p: string) => req<GitStatus>("GET", `/api/git/status?path=${encodeURIComponent(p)}`),
    ignored: (p: string) => req<{ ignored: string[] }>("GET", `/api/git/ignored?path=${encodeURIComponent(p)}`),
    diff: (p: string, file: string, o: { staged?: boolean; untracked?: boolean } = {}) =>
      req<{ diff: string }>("GET", `/api/git/diff?path=${encodeURIComponent(p)}&file=${encodeURIComponent(file)}${o.staged ? "&staged=true" : ""}${o.untracked ? "&untracked=true" : ""}`),
    commitDiff: (p: string, hash: string) =>
      req<{ diff: string }>("GET", `/api/git/commit-diff?path=${encodeURIComponent(p)}&hash=${encodeURIComponent(hash)}`),
    // One side of a side-by-side diff: a file's content at a rev (empty rev = the index).
    showFile: (p: string, rev: string, file: string) =>
      req<{ content: string }>("GET", `/api/git/show-file?path=${encodeURIComponent(p)}&file=${encodeURIComponent(file)}${rev ? `&rev=${encodeURIComponent(rev)}` : ""}`),
    // The same, but raw bytes (base64) — for image/binary diffs, where utf8 would corrupt the blob.
    // `dataBase64` is null when the file is absent at that rev (the empty side of an add/delete).
    showFileBytes: (p: string, rev: string, file: string) =>
      req<{ dataBase64: string | null; size: number }>("GET", `/api/git/show-file-bytes?path=${encodeURIComponent(p)}&file=${encodeURIComponent(file)}${rev ? `&rev=${encodeURIComponent(rev)}` : ""}`),
    commitFiles: (p: string, hash: string) =>
      req<{ files: CommitFile[] }>("GET", `/api/git/commit-files?path=${encodeURIComponent(p)}&hash=${encodeURIComponent(hash)}`),
    log: (p: string, limit?: number) =>
      req<{ commits: GitCommit[] }>("GET", `/api/git/log?path=${encodeURIComponent(p)}${limit ? `&limit=${limit}` : ""}`),
    branches: (p: string) => req<{ branches: GitBranch[] }>("GET", `/api/git/branches?path=${encodeURIComponent(p)}`),
    defaultBranch: (p: string) => req<{ branch: string | null }>("GET", `/api/git/default-branch?path=${encodeURIComponent(p)}`),
    stashList: (p: string) => req<{ stashes: StashEntry[] }>("GET", `/api/git/stash?path=${encodeURIComponent(p)}`),
    stashFiles: (p: string, ref: string) => req<{ files: CommitFile[] }>("GET", `/api/git/stash-files?path=${encodeURIComponent(p)}&ref=${encodeURIComponent(ref)}`),
    worktrees: (p: string) => req<{ worktrees: GitWorktree[] }>("GET", `/api/git/worktrees?path=${encodeURIComponent(p)}`),
    worktreeAdd: (p: string, worktreePath: string, branch: string, newBranch?: boolean) => req<{ ok: true }>("POST", "/api/git/worktree", { path: p, worktreePath, branch, newBranch }),
    worktreeRemove: (p: string, worktreePath: string, force?: boolean) => req<{ ok: true }>("POST", "/api/git/worktree/remove", { path: p, worktreePath, force }),
    stage: (p: string, files: string[]) => req<{ ok: true }>("POST", "/api/git/stage", { path: p, files }),
    unstage: (p: string, files: string[]) => req<{ ok: true }>("POST", "/api/git/unstage", { path: p, files }),
    discard: (p: string, files: string[]) => req<{ ok: true }>("POST", "/api/git/discard", { path: p, files }),
    clean: (p: string) => req<{ ok: true }>("POST", "/api/git/clean", { path: p }),
    stageAll: (p: string) => req<{ ok: true }>("POST", "/api/git/stage-all", { path: p }),
    unstageAll: (p: string) => req<{ ok: true }>("POST", "/api/git/unstage-all", { path: p }),
    commit: (p: string, message: string) => req<{ ok: true }>("POST", "/api/git/commit", { path: p, message }),
    uncommit: (p: string) => req<{ ok: true }>("POST", "/api/git/uncommit", { path: p }),
    checkout: (p: string, branch: string) => req<{ ok: true }>("POST", "/api/git/checkout", { path: p, branch }),
    createBranch: (p: string, name: string) => req<{ ok: true }>("POST", "/api/git/branch", { path: p, name }),
    renameBranch: (p: string, name: string, newName: string) => req<{ ok: true }>("POST", "/api/git/branch/rename", { path: p, name, newName }),
    deleteBranch: (p: string, name: string, force?: boolean) => req<{ ok: true }>("POST", "/api/git/branch/delete", { path: p, name, force }),
    merge: (p: string, branch: string) => req<{ message: string }>("POST", "/api/git/merge", { path: p, branch }),
    mergePreview: (p: string, branch: string) => req<MergePreview>("GET", `/api/git/merge-preview?path=${encodeURIComponent(p)}&branch=${encodeURIComponent(branch)}`),
    fetch: (p: string) => req<{ message: string }>("POST", "/api/git/fetch", { path: p }),
    pull: (p: string) => req<{ message: string }>("POST", "/api/git/pull", { path: p }),
    push: (p: string, setUpstream?: boolean) => req<{ message: string }>("POST", "/api/git/push", { path: p, setUpstream }),
    forcePush: (p: string, setUpstream?: boolean) => req<{ message: string }>("POST", "/api/git/force-push", { path: p, setUpstream }),
    sync: (p: string) => req<{ message: string }>("POST", "/api/git/sync", { path: p }),
    stashSave: (p: string, message: string, includeUntracked: boolean) => req<{ ok: true }>("POST", "/api/git/stash", { path: p, message, includeUntracked }),
    stashFile: (p: string, file: string | string[], message?: string) => req<{ ok: true }>("POST", "/api/git/stash/file", { path: p, file, message }),
    stashApply: (p: string, ref: string) => req<{ ok: true }>("POST", "/api/git/stash/apply", { path: p, ref }),
    stashPop: (p: string, ref: string) => req<{ ok: true }>("POST", "/api/git/stash/pop", { path: p, ref }),
    stashDrop: (p: string, ref: string) => req<{ ok: true }>("POST", "/api/git/stash/drop", { path: p, ref }),
    // Add `file` (repo-relative) to the local exclude or the shared .gitignore, then untrack it.
    ignore: (p: string, file: string, scope: "local" | "repo", isDir = false) =>
      req<{ line: string; added: boolean }>("POST", "/api/git/ignore", { path: p, file, scope, isDir }),
    github: {
      info: (p: string) => req<GithubInfo>("GET", `/api/git/github/info?path=${encodeURIComponent(p)}`),
      // `account` (+ host) scopes the owner list to a specific signed-in account, so the publish
      // picker shows that account's login + orgs instead of only the active account's.
      owners: (p: string, account?: { account: string; host?: string }) => {
        const q = new URLSearchParams({ path: p });
        if (account) { q.set("account", account.account); if (account.host) q.set("host", account.host); }
        return req<GithubOwners>("GET", `/api/git/github/owners?${q.toString()}`);
      },
      // Path-less: every signed-in gh account (active flagged) + whether gh is installed. Drives the
      // New Workspace GitHub picker's browse gate AND its account switcher when more than one is connected.
      accounts: () => req<{ installed: boolean; accounts: GithubAccount[] }>("GET", "/api/git/github/accounts"),
      // The git commit identity (name + email) a chosen account would commit under — for the
      // Initialize-repo dialog's "commits as …" preview.
      identity: (account: string, host?: string) => {
        const q = new URLSearchParams({ account });
        if (host) q.set("host", host);
        return req<GithubIdentity>("GET", `/api/git/github/identity?${q.toString()}`);
      },
      // The signed-in user's repos (or a given owner's) for the New Workspace "browse my GitHub" picker.
      // `account` (+ host) scopes to a specific signed-in account so its private repos show up.
      repos: (opts: { owner?: string; limit?: number; account?: string; host?: string } = {}) => {
        const p = new URLSearchParams();
        if (opts.owner) p.set("owner", opts.owner);
        if (opts.limit) p.set("limit", String(opts.limit));
        if (opts.account) p.set("account", opts.account);
        if (opts.host) p.set("host", opts.host);
        const qs = p.toString();
        return req<{ repos: GithubRepo[] }>("GET", `/api/git/github/repos${qs ? `?${qs}` : ""}`);
      },
      // Clone a picked GitHub repo (owner/repo slug) into <parent>/<name> via gh (private repos work).
      // `account` (+ host) scopes the clone to the account it was browsed under.
      clone: (b: { repo: string; parent: string; name: string; account?: string; host?: string }) =>
        req<{ path: string }>("POST", "/api/git/github/clone", b),
      // `account` (+ host) creates the repo under a specific signed-in account, not the active one.
      publish: (p: string, b: { name: string; owner: string; visibility: "private" | "public"; description?: string; account?: string; host?: string }) =>
        req<{ url: string }>("POST", "/api/git/github/publish", { path: p, ...b }),
      prs: (p: string) => req<{ prs: PullRequest[] }>("GET", `/api/git/github/prs?path=${encodeURIComponent(p)}`),
      prCreate: (p: string, b: { title: string; body?: string; base?: string; draft?: boolean }) =>
        req<{ url: string }>("POST", "/api/git/github/pr/create", { path: p, ...b }),
      runs: (p: string) => req<{ runs: ActionRun[] }>("GET", `/api/git/github/runs?path=${encodeURIComponent(p)}`),
      prComment: (p: string, number: number, body: string) => req<{ ok: true }>("POST", "/api/git/github/pr/comment", { path: p, number, body }),
      prMerge: (p: string, number: number, method: PrMergeMethod) => req<{ ok: true }>("POST", "/api/git/github/pr/merge", { path: p, number, method }),
      prClose: (p: string, number: number) => req<{ ok: true }>("POST", "/api/git/github/pr/close", { path: p, number }),
    },
  },
  ai: {
    providers: () => req<AiProvidersResponse>("GET", "/api/ai/providers"),
    // commitPrompt/prPrompt: omit to keep the stored one (e.g. when only switching the active
    // provider); "" resets to the built-in default; a string sets custom instructions.
    saveProviders: (providers: AiProvider[], defaultProviderId: string | null, commitPrompt?: string, prPrompt?: string) =>
      req<{ ok: true }>("PUT", "/api/ai/providers", { providers, defaultProviderId, commitPrompt, prPrompt }),
    commitMessage: (path: string) => req<{ message: string }>("POST", "/api/ai/commit-message", { path }),
    // The first-commit message for a brand-new repo, summarized from its top-level files (no staging).
    initialCommitMessage: (path: string) => req<{ message: string }>("POST", "/api/ai/initial-commit-message", { path }),
    // Generate a PR title + body for the current branch (vs `base`, default = the repo default branch)
    // from its commits + changed files, via the editable PR prompt + the active provider.
    prDescription: (path: string, base?: string) => req<{ title: string; body: string }>("POST", "/api/ai/pr-description", { path, base }),
    // Fetch a provider's available models for the settings dropdown. Pass `apiKey` for a just-typed
    // key that isn't saved yet; omit it to use the server's stored key (or the env-var fallback).
    models: (body: { id?: string; kind: AiProviderKind; label?: string; baseUrl?: string; apiKey?: string; apiKeyEnv?: string; command?: string[] }) =>
      req<{ models: string[] }>("POST", "/api/ai/models", body),
    builder: () => req<AiBuilderResponse>("GET", "/api/ai/builder"),
    buildPrompt: (inputs: PromptBuilderInputs, engineId?: string) =>
      req<{ prompt: string }>("POST", "/api/ai/build-prompt", { inputs, engineId }),
    // Polish a serialized program blueprint into an implementation prompt for the target tool.
    buildFromBlueprint: (spec: string, targetTool: string, engineId?: string) =>
      req<{ prompt: string }>("POST", "/api/ai/build-prompt-from-blueprint", { spec, targetTool, engineId }),
    // Multi-turn chat for the floating canvas assistant; spec/targetTool/graph/selected ground the
    // model in the live blueprint, engineId overrides the codex-first default pick. Returns the reply
    // bubble text plus any canvas ops the model asked for (empty when it's only talking).
    chat: (messages: AiChatMessage[], opts?: { spec?: string; targetTool?: string; engineId?: string; graph?: BlueprintGraph; selected?: string[] }) =>
      req<AiChatResponse>("POST", "/api/ai/chat", { messages, ...opts }),
  },
  blueprints: {
    list: () => req<{ blueprints: BlueprintSummary[] }>("GET", "/api/blueprints"),
    get: (id: string) => req<{ blueprint: Blueprint }>("GET", `/api/blueprints/${id}`),
    create: (name: string, graph: BlueprintGraph, chat?: AiChatMessage[]) =>
      req<{ blueprint: Blueprint }>("POST", "/api/blueprints", { name, graph, chat }),
    update: (id: string, patch: { name?: string; graph?: BlueprintGraph; chat?: AiChatMessage[] }) =>
      req<{ blueprint: Blueprint }>("PUT", `/api/blueprints/${id}`, patch),
    remove: (id: string) => req<{ ok: true }>("DELETE", `/api/blueprints/${id}`),
  },
  claude: {
    sessions: (projectPath: string) =>
      req<ClaudeSessionsResponse>("GET", `/api/claude/sessions?path=${encodeURIComponent(projectPath)}`),
    messages: (jsonlPath: string, agent: ClaudeAgent, limit = 50, offset = 0) =>
      req<SessionMessagesResponse>("GET", `/api/claude/messages?jsonlPath=${encodeURIComponent(jsonlPath)}&agent=${agent}&limit=${limit}&offset=${offset}`),
    entries: (jsonlPath: string, agent: ClaudeAgent) =>
      req<{ entries: SessionEntryLite[] }>("GET", `/api/claude/entries?jsonlPath=${encodeURIComponent(jsonlPath)}&agent=${agent}`),
    usage: (jsonlPath: string, agent: ClaudeAgent) =>
      req<SessionUsage>("GET", `/api/claude/usage?jsonlPath=${encodeURIComponent(jsonlPath)}&agent=${agent}`),
    setPref: (sessionId: string, patch: { pinned?: boolean; color?: string | null }) =>
      req<{ ok: true }>("POST", "/api/claude/prefs", { sessionId, ...patch }),
    rename: (agent: ClaudeAgent, sessionId: string, projectPath: string, name: string) =>
      req<{ ok: true }>("POST", "/api/claude/rename", { agent, sessionId, projectPath, name }),
    delete: (agent: ClaudeAgent, sessionId: string, projectPath: string) =>
      req<{ ok: true; deleted: string[] }>("POST", "/api/claude/delete", { agent, sessionId, projectPath }),
    fork: (agent: ClaudeAgent, sessionId: string, projectPath: string) =>
      req<{ newSessionId: string }>("POST", "/api/claude/fork", { agent, sessionId, projectPath }),
    forkFromLine: (agent: ClaudeAgent, sessionId: string, projectPath: string, lineIndex: number) =>
      req<{ newSessionId: string }>("POST", "/api/claude/fork-from-line", { agent, sessionId, projectPath, lineIndex }),
    forkCross: (agent: ClaudeAgent, sessionId: string, projectPath: string) =>
      req<{ newSessionId: string; targetCli: ClaudeAgent; messageCount: number }>("POST", "/api/claude/fork-cross", { agent, sessionId, projectPath }),
    deleteEntries: (jsonlPath: string, agent: ClaudeAgent, ranges: [number, number][]) =>
      req<{ ok: true; removed: number }>("POST", "/api/claude/entries/delete", { jsonlPath, agent, ranges }),
    summarizeEntries: (jsonlPath: string, agent: ClaudeAgent, startLine: number, endLine: number, providerId?: string) =>
      req<{ ok: true }>("POST", "/api/claude/entries/summarize", { jsonlPath, agent, startLine, endLine, providerId }),
    forkFromTerminal: (terminalId: string) =>
      req<{ sessionId: string | null; newSessionId: string | null }>("POST", "/api/claude/fork-from-terminal", { terminalId }),
  },
  skills: {
    list: (scope: SkillScope, workspace?: string) =>
      req<{ skills: InstalledSkill[] }>("GET", `/api/skills?scope=${scope}${workspace ? `&workspace=${encodeURIComponent(workspace)}` : ""}`),
    content: (path: string, workspace?: string) =>
      req<{ content: string }>("GET", `/api/skills/content?path=${encodeURIComponent(path)}${workspace ? `&workspace=${encodeURIComponent(workspace)}` : ""}`),
    scan: (source: string) => req<SkillScanResult>("POST", "/api/skills/scan", { source }),
    install: (tmpId: string, names: string[], scope: SkillScope, workspace?: string) =>
      req<{ skills: InstalledSkill[] }>("POST", "/api/skills/install", { tmpId, names, scope, workspace }),
    remove: (path: string, workspace?: string) => req<{ ok: true }>("POST", "/api/skills/remove", { path, workspace }),
    setEnabled: (path: string, enabled: boolean, workspace?: string) =>
      req<{ path: string }>("POST", "/api/skills/enabled", { path, enabled, workspace }),
    checkUpdates: (scope: SkillScope, workspace?: string) =>
      req<{ updates: SkillUpdateStatus[] }>("POST", "/api/skills/check-updates", { scope, workspace }),
    update: (path: string, workspace?: string) => req<{ skill: InstalledSkill }>("POST", "/api/skills/update", { path, workspace }),
    search: (q: string) => req<{ results: RegistrySkill[] }>("GET", `/api/skills/search?q=${encodeURIComponent(q)}`),
    catalog: (filter?: string) =>
      req<{ entries: CatalogEntry[]; sources: CatalogSource[] }>("GET", `/api/skills/catalog${filter ? `?filter=${encodeURIComponent(filter)}` : ""}`),
    addCatalogSource: (source: string, official?: boolean) => req<{ sources: CatalogSource[] }>("POST", "/api/skills/catalog/source", { source, official }),
    setCatalogSourceOfficial: (source: string, official: boolean) =>
      req<{ sources: CatalogSource[] }>("POST", "/api/skills/catalog/source/official", { source, official }),
    removeCatalogSource: (source: string) => req<{ sources: CatalogSource[] }>("POST", "/api/skills/catalog/source/remove", { source }),
    reindexCatalog: () => req<{ sources: CatalogSource[] }>("POST", "/api/skills/catalog/reindex", {}),
  },
  favorites: {
    list: () => req<{ groups: FavoriteGroup[]; favorites: Favorite[] }>("GET", "/api/favorites"),
    createGroup: (name: string, parentId: string | null = null) =>
      req<{ group: FavoriteGroup }>("POST", "/api/favorites/groups", { name, parentId }),
    renameGroup: (id: string, name: string) =>
      req<{ group: FavoriteGroup }>("PATCH", `/api/favorites/groups/${id}`, { name }),
    // reassignTo: undefined = cascade-delete; null = move favorites to root; string = into that group.
    deleteGroup: (id: string, reassignTo?: string | null) =>
      req<{ ok: true }>("DELETE", `/api/favorites/groups/${id}${reassignTo === undefined ? "" : `?reassignTo=${reassignTo === null ? "root" : encodeURIComponent(reassignTo)}`}`),
    create: (folder: string, groupId: string | null = null, label?: string | null) =>
      req<{ favorite: Favorite }>("POST", "/api/favorites", { folder, groupId, label }),
    rename: (id: string, label: string | null) =>
      req<{ favorite: Favorite }>("PATCH", `/api/favorites/${id}`, { label }),
    remove: (id: string) => req<{ ok: true }>("DELETE", `/api/favorites/${id}`),
    move: (kind: "favorite" | "group", id: string, targetParentId: string | null, index: number) =>
      req<{ ok: true }>("POST", "/api/favorites/move", { kind, id, targetParentId, index }),
  },
  notes: {
    list: () => req<{ notes: Note[] }>("GET", "/api/notes"),
    create: (b: { title?: string; content?: string; groupId?: string | null } = {}) =>
      req<{ note: Note }>("POST", "/api/notes", b),
    update: (id: string, patch: { title?: string; content?: string; groupId?: string | null }) =>
      req<{ note: Note }>("PATCH", `/api/notes/${id}`, patch),
    remove: (id: string) => req<{ ok: true }>("DELETE", `/api/notes/${id}`),
  },
  noteGroups: {
    list: () => req<{ groups: NoteGroup[] }>("GET", "/api/note-groups"),
    create: (b: { name?: string }) => req<{ group: NoteGroup }>("POST", "/api/note-groups", b),
    update: (id: string, patch: { name?: string; color?: string | null; sort?: number }) =>
      req<{ group: NoteGroup }>("PATCH", `/api/note-groups/${id}`, patch),
    remove: (id: string) => req<{ ok: true }>("DELETE", `/api/note-groups/${id}`),
  },
  links: {
    list: () => req<{ links: Link[]; folders: LinkFolder[] }>("GET", "/api/links"),
    create: (b: { title?: string; url?: string; description?: string; folderId?: string | null }) =>
      req<{ link: Link }>("POST", "/api/links", b),
    update: (id: string, patch: { title?: string; url?: string; description?: string; folderId?: string | null; color?: string | null; sort?: number }) =>
      req<{ link: Link }>("PATCH", `/api/links/${id}`, patch),
    remove: (id: string) => req<{ ok: true }>("DELETE", `/api/links/${id}`),
    reorder: (items: { id: string; folderId: string | null; sort: number }[]) =>
      req<{ ok: true }>("PUT", "/api/links/order", { items }),
  },
  linkFolders: {
    create: (b: { name?: string }) => req<{ folder: LinkFolder }>("POST", "/api/link-folders", b),
    update: (id: string, patch: { name?: string; color?: string | null; sort?: number }) =>
      req<{ folder: LinkFolder }>("PATCH", `/api/link-folders/${id}`, patch),
    remove: (id: string) => req<{ ok: true }>("DELETE", `/api/link-folders/${id}`),
    reorder: (items: { id: string; sort: number }[]) =>
      req<{ ok: true }>("PUT", "/api/link-folders/order", { items }),
  },
  stickyNotes: {
    list: () => req<{ stickyNotes: StickyNote[] }>("GET", "/api/sticky-notes"),
    create: (b: { spaceId?: string | null; content?: string; color?: string | null; x: number; y: number; w: number; h: number }) =>
      req<{ stickyNote: StickyNote }>("POST", "/api/sticky-notes", b),
    update: (id: string, patch: Partial<{ spaceId: string | null; content: string; color: string | null; x: number; y: number; w: number; h: number; pinned: boolean }>) =>
      req<{ stickyNote: StickyNote }>("PATCH", `/api/sticky-notes/${id}`, patch),
    remove: (id: string) => req<{ ok: true }>("DELETE", `/api/sticky-notes/${id}`),
  },
  spaceWidgets: {
    list: () => req<{ spaceWidgets: SpaceWidget[] }>("GET", "/api/space-widgets"),
    create: (b: { spaceId?: string | null; kind: SpaceWidgetKind; x: number; y: number; w: number; h: number; config?: Record<string, unknown> | null }) =>
      req<{ spaceWidget: SpaceWidget }>("POST", "/api/space-widgets", b),
    update: (id: string, patch: Partial<{ spaceId: string | null; x: number; y: number; w: number; h: number; config: Record<string, unknown> | null }>) =>
      req<{ spaceWidget: SpaceWidget }>("PATCH", `/api/space-widgets/${id}`, patch),
    remove: (id: string) => req<{ ok: true }>("DELETE", `/api/space-widgets/${id}`),
  },
  board: {
    list: () => req<{ cards: BoardCard[] }>("GET", "/api/board"),
    create: (b: { column?: BoardColumn; title?: string; body?: string; color?: string | null } = {}) =>
      req<{ card: BoardCard }>("POST", "/api/board/cards", b),
    update: (id: string, patch: { title?: string; body?: string; color?: string | null; column?: BoardColumn; position?: number }) =>
      req<{ card: BoardCard }>("PATCH", `/api/board/cards/${id}`, patch),
    remove: (id: string) => req<{ ok: true }>("DELETE", `/api/board/cards/${id}`),
  },
  // Timesheet (Harvest-style tracker). Entries are range-scoped; catalog drives the dropdowns. The
  // server auto-adds unknown client/project/task names on start/create. See server/src/routes/time.ts.
  time: {
    entries: (from?: number, to?: number) => {
      const qs = [from !== undefined ? `from=${from}` : "", to !== undefined ? `to=${to}` : ""].filter(Boolean).join("&");
      return req<{ entries: TimeEntry[] }>("GET", `/api/time/entries${qs ? `?${qs}` : ""}`);
    },
    start: (b: { client: string; project?: string; task?: string; notes?: string }) =>
      req<{ entry: TimeEntry }>("POST", "/api/time/start", b),
    stop: (b: { id?: string; client?: string } = {}) =>
      req<{ entries: TimeEntry[]; entry: TimeEntry | null }>("POST", "/api/time/stop", b),
    create: (b: { client: string; project?: string; task?: string; notes?: string; startedAt: number; stoppedAt?: number | null }) =>
      req<{ entry: TimeEntry }>("POST", "/api/time/entries", b),
    update: (id: string, patch: { client?: string; project?: string; task?: string; notes?: string; startedAt?: number; stoppedAt?: number | null }) =>
      req<{ entry: TimeEntry }>("PATCH", `/api/time/entries/${id}`, patch),
    remove: (id: string) => req<{ ok: true }>("DELETE", `/api/time/entries/${id}`),
    clients: () => req<{ clients: TimeClient[] }>("GET", "/api/time/clients"),
    createClient: (name: string) => req<{ client: TimeClient }>("POST", "/api/time/clients", { name }),
    updateClient: (id: string, patch: { name?: string; archived?: boolean; position?: number }) =>
      req<{ client: TimeClient }>("PATCH", `/api/time/clients/${id}`, patch),
    removeClient: (id: string) => req<{ ok: true }>("DELETE", `/api/time/clients/${id}`),
    projects: (clientId?: string) =>
      req<{ projects: TimeProject[] }>("GET", `/api/time/projects${clientId ? `?clientId=${clientId}` : ""}`),
    createProject: (clientId: string, name: string) => req<{ project: TimeProject }>("POST", "/api/time/projects", { clientId, name }),
    updateProject: (id: string, patch: { name?: string; archived?: boolean; position?: number }) =>
      req<{ project: TimeProject }>("PATCH", `/api/time/projects/${id}`, patch),
    removeProject: (id: string) => req<{ ok: true }>("DELETE", `/api/time/projects/${id}`),
    tasks: () => req<{ tasks: TimeTask[] }>("GET", "/api/time/tasks"),
    createTask: (name: string) => req<{ task: TimeTask }>("POST", "/api/time/tasks", { name }),
    updateTask: (id: string, patch: { name?: string; archived?: boolean; position?: number }) =>
      req<{ task: TimeTask }>("PATCH", `/api/time/tasks/${id}`, patch),
    removeTask: (id: string) => req<{ ok: true }>("DELETE", `/api/time/tasks/${id}`),
  },
  // Calendar reminders / scheduled notifications. `image` is a base64 data URL (sent on create/patch);
  // patching `image:null` clears it. The calendar passes from/to (epoch ms) to fetch a visible range.
  reminders: {
    list: (q: { from?: number; to?: number; status?: ReminderStatus[] } = {}) => {
      const p = new URLSearchParams();
      if (q.from != null) p.set("from", String(q.from));
      if (q.to != null) p.set("to", String(q.to));
      if (q.status?.length) p.set("status", q.status.join(","));
      const qs = p.toString();
      return req<{ reminders: Reminder[] }>("GET", `/api/reminders${qs ? `?${qs}` : ""}`);
    },
    create: (b: ReminderInput) => req<{ reminder: Reminder }>("POST", "/api/reminders", b),
    update: (id: string, patch: Partial<Omit<ReminderInput, "image">> & { status?: ReminderStatus; image?: string | null }) =>
      req<{ reminder: Reminder }>("PATCH", `/api/reminders/${id}`, patch),
    remove: (id: string) => req<{ ok: true }>("DELETE", `/api/reminders/${id}`),
    snooze: (id: string, b: { minutes: number } | { until: number }) =>
      req<{ reminder: Reminder }>("POST", `/api/reminders/${id}/snooze`, b),
    imageUrl: (id: string) => `/api/reminders/${id}/image`,
  },
  notifications: {
    list: (limit?: number) =>
      req<{ notifications: AppNotification[]; unread: number }>("GET", `/api/notifications${limit ? `?limit=${limit}` : ""}`),
    markRead: (id: string) => req<{ ok: true }>("POST", `/api/notifications/${id}/read`),
    markAllRead: () => req<{ ok: true }>("POST", "/api/notifications/read-all"),
    remove: (id: string) => req<{ ok: true }>("DELETE", `/api/notifications/${id}`),
    clear: () => req<{ ok: true }>("DELETE", "/api/notifications"),
    // Handle a pending (toast-only) agent notification so it never persists to the center.
    dismissPending: (id: string) => req<{ ok: true }>("POST", "/api/notifications/dismiss", { id }),
    // Clear every center entry for a terminal — fired when you open/view it.
    clearTerminal: (terminalId: string) => req<{ ok: true; removed: number }>("DELETE", `/api/notifications/terminal/${terminalId}`),
  },
  pushover: {
    test: () => req<{ ok: boolean; errors: string[] }>("POST", "/api/pushover/test"),
    quota: () => req<{ configured: boolean; quota: PushoverQuota | null }>("GET", "/api/pushover/quota"),
  },
  // Temp access links ("add a teammate") + the live roster. Owner-only on the server (a teammate's
  // key gets 403). create() returns the secret so the manager can build the shareable link.
  accessKeys: {
    list: () => req<{ keys: AccessKey[]; sessions: PresenceSession[] }>("GET", "/api/access-keys"),
    create: (b: { label?: string; workspaceId?: string | null; expiresAt?: number | null; mirror?: boolean; lock?: boolean }) =>
      req<{ key: AccessKey }>("POST", "/api/access-keys", b),
    revoke: (id: string) => req<{ ok: true }>("DELETE", `/api/access-keys/${id}`),
    kick: (sid: string) => req<{ ok: true }>("POST", `/api/access-keys/sessions/${sid}/kick`),
    admit: (sessionId: string, decision: "accept" | "decline") =>
      req<{ ok: true }>("POST", "/api/access-keys/admit", { sessionId, decision }),
  },
  // Owner-only public Cloudflare Quick Tunnel. start() takes the port the browser is served from so the
  // tunnel targets the right layer (5173 dev / 8189 prod). Returns the throwaway trycloudflare.com URL.
  tunnel: {
    status: () => req<TunnelStatus>("GET", "/api/tunnel"),
    start: (port: number) => req<TunnelStatus>("POST", "/api/tunnel", { port }),
    stop: () => req<TunnelStatus>("DELETE", "/api/tunnel"),
  },
  // The in-app Copilot. settings is a singleton; conversations persist server-side; send() is the
  // non-streaming fallback (the live UI streams over /ws/copilot instead).
  copilot: {
    getSettings: () => req<{ settings: CopilotSettings }>("GET", "/api/copilot/settings"),
    patchSettings: (patch: Partial<CopilotSettings>) => req<{ settings: CopilotSettings }>("PATCH", "/api/copilot/settings", patch),
    listConversations: () => req<{ conversations: CopilotConversation[] }>("GET", "/api/copilot/conversations"),
    createConversation: (title?: string) => req<{ conversation: CopilotConversation }>("POST", "/api/copilot/conversations", { title }),
    getConversation: (id: string) => req<{ conversation: CopilotConversation; messages: CopilotMessage[] }>("GET", `/api/copilot/conversations/${id}`),
    deleteConversation: (id: string) => req<{ ok: true }>("DELETE", `/api/copilot/conversations/${id}`),
    send: (id: string, text: string) => req<{ reply: string; tools: { name: string; ok: boolean; summary: string }[] }>("POST", `/api/copilot/conversations/${id}/messages`, { text }),
    listSkills: () => req<{ skills: CopilotSkillCard[] }>("GET", "/api/copilot/skills"),
    patchSkill: (id: string, patch: { enabled?: boolean; settings?: Record<string, unknown> }) => req<{ skill: CopilotSkillCard }>("PATCH", `/api/copilot/skills/${id}`, patch),
    listAccounts: (skillId: string) => req<{ accounts: CopilotSkillAccount[] }>("GET", `/api/copilot/skills/${skillId}/accounts`),
    createAccount: (skillId: string, b: { label: string; provider: string; config: Record<string, unknown>; secret: string }) =>
      req<{ account: CopilotSkillAccount }>("POST", `/api/copilot/skills/${skillId}/accounts`, b),
    updateAccount: (skillId: string, aid: string, b: { label?: string; config?: Record<string, unknown>; secret?: string }) =>
      req<{ account: CopilotSkillAccount }>("PATCH", `/api/copilot/skills/${skillId}/accounts/${aid}`, b),
    deleteAccount: (skillId: string, aid: string) => req<{ ok: true }>("DELETE", `/api/copilot/skills/${skillId}/accounts/${aid}`),
    listTools: () => req<{ tools: { name: string; description: string; skillId: string }[] }>("GET", "/api/copilot/tools"),
    listJobs: () => req<{ jobs: CopilotJob[] }>("GET", "/api/copilot/jobs"),
    createJob: (b: { title?: string; tool: string; args?: Record<string, unknown>; intervalSec: number; reportMode?: CopilotReportMode }) =>
      req<{ job: CopilotJob }>("POST", "/api/copilot/jobs", b),
    patchJob: (id: string, patch: { title?: string; args?: Record<string, unknown>; intervalSec?: number; reportMode?: CopilotReportMode; enabled?: boolean }) =>
      req<{ job: CopilotJob }>("PATCH", `/api/copilot/jobs/${id}`, patch),
    deleteJob: (id: string) => req<{ ok: true }>("DELETE", `/api/copilot/jobs/${id}`),
    listMcp: () => req<{ servers: CopilotMcpServer[] }>("GET", "/api/copilot/mcp"),
    importableMcp: () => req<{ servers: CopilotMcpImportable[] }>("GET", "/api/copilot/mcp/importable"),
    createMcp: (b: { label: string; transport: CopilotMcpTransport; command: string[]; url?: string | null; env?: Record<string, string> }) =>
      req<{ server: CopilotMcpServer }>("POST", "/api/copilot/mcp", b),
    patchMcp: (id: string, patch: { label?: string; command?: string[]; url?: string | null; env?: Record<string, string>; enabled?: boolean }) =>
      req<{ server: CopilotMcpServer }>("PATCH", `/api/copilot/mcp/${id}`, patch),
    refreshMcp: (id: string) => req<{ server: CopilotMcpServer }>("POST", `/api/copilot/mcp/${id}/refresh`),
    deleteMcp: (id: string) => req<{ ok: true }>("DELETE", `/api/copilot/mcp/${id}`),
  },
};

/** WebSocket URL for the live Copilot stream, carrying the auth token as ?token= (the WS upgrade
 *  can't send an Authorization header). Mirrors the terminal/notification socket URL building. */
export function copilotSocketUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const t = getToken();
  return `${proto}//${location.host}/ws/copilot${t ? `?token=${encodeURIComponent(t)}` : ""}`;
}

/** Body accepted by POST /api/reminders (and, all-optional, by PATCH). The browser sends `fireAt` as
 *  epoch ms; `fireInMinutes`/`fireAtISO` are agent conveniences the server also accepts. */
export interface ReminderInput {
  title: string;
  fireAt?: number;
  fireAtISO?: string;
  fireInMinutes?: number;
  body?: string;
  allDay?: boolean;
  endAt?: number | null;
  leadMinutes?: number;
  color?: string | null;
  channels?: NotifyChannels;
  level?: NotifyLevel;
  priority?: number;
  recurrence?: Recurrence | null;
  image?: string;
}
