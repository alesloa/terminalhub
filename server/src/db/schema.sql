CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  folder TEXT NOT NULL,
  launchCommand TEXT NOT NULL DEFAULT '',
  color TEXT,
  cardColor TEXT,
  layout TEXT,
  spaceId TEXT,
  folderId TEXT,
  config TEXT,
  systemPrompt TEXT,
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
-- Canvas folders: iPhone-style groups of workspace cards on a space's canvas. A folder holds the
-- group's name + canvas position (x/y); its member cards carry workspaces.folderId and leave the
-- canvas to live inside it. `spaceId` scopes the folder to one space (null = Home), like a card.
-- Deleting a folder dissolves it (members' folderId cleared, so they drop back onto the canvas).
CREATE TABLE IF NOT EXISTS folders (
  id        TEXT PRIMARY KEY,
  spaceId   TEXT,
  name      TEXT NOT NULL DEFAULT '',
  x         REAL NOT NULL DEFAULT 0,
  y         REAL NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_folders_space ON folders(spaceId);
CREATE TABLE IF NOT EXISTS terminals (
  id TEXT PRIMARY KEY,
  workspaceId TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  color TEXT,
  icon TEXT,
  tmuxSession TEXT NOT NULL,
  launchCommandOverride TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  titleAuto INTEGER NOT NULL DEFAULT 1,
  systemPrompt TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS custom_agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  command TEXT NOT NULL,
  icon TEXT,
  category TEXT NOT NULL DEFAULT 'Other',
  createdAt INTEGER NOT NULL
);
-- Remembers the last accent color chosen for a folder so terminating a workspace and
-- re-adding the same folder restores its color. Keyed by folder, outlives the row.
CREATE TABLE IF NOT EXISTS workspace_colors (
  folder TEXT PRIMARY KEY,
  color TEXT NOT NULL,
  updatedAt INTEGER NOT NULL
);
-- Per-session UI prefs for the Claude/Codex session manager. The CLIs don't store pins or
-- colors, so Terminal Hub keeps them here, keyed by the CLI's own sessionId (a UUID).
CREATE TABLE IF NOT EXISTS claude_session_prefs (
  sessionId TEXT PRIMARY KEY,
  pinned INTEGER NOT NULL DEFAULT 0,
  color TEXT
);
-- Line-level bookmarks (VS Code "Bookmarks" feature). Keyed by workspace folder, not
-- workspaceId, so they survive terminating + re-adding a workspace on the same folder (same
-- durability choice as workspace_colors). `preview` is the trimmed line text captured at toggle
-- time, shown in the bookmark browser without re-reading files.
CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY,
  folder TEXT NOT NULL,
  filePath TEXT NOT NULL,
  line INTEGER NOT NULL,
  label TEXT,
  preview TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bookmarks_folder ON bookmarks(folder);
-- Provenance for skills installed through the Skills panel. Disk (the .claude/skills folders)
-- is the source of truth for what's installed; this table only records where each skill came
-- from and its last-seen hashes, so updates can be detected. Keyed by the skill folder's
-- absolute path (rekeyed on enable/disable moves). Hand-made skills have no row here.
CREATE TABLE IF NOT EXISTS skill_installs (
  installPath  TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  scope        TEXT NOT NULL,
  sourceType   TEXT,
  sourceUrl    TEXT,
  skillPath    TEXT,
  repoHeadHash TEXT,
  folderHash   TEXT,
  installedAt  INTEGER NOT NULL,
  updatedAt    INTEGER NOT NULL
);

-- Catalog: configured sources (git/owner-repo/local path) scanned for SKILL.md folders to
-- build a browsable local index, mirroring the VS Code extension's catalogSources setting.
CREATE TABLE IF NOT EXISTS skill_catalog_source (
  source        TEXT PRIMARY KEY,
  addedAt       INTEGER NOT NULL,
  lastIndexedAt INTEGER,
  skillCount    INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  official      INTEGER NOT NULL DEFAULT 0   -- user-set: skills from this source show the ✓ Official badge
);
-- One discovered skill per (source, name). Rebuilt wholesale per source on reindex.
CREATE TABLE IF NOT EXISTS skill_catalog (
  source       TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT,
  relPath      TEXT,
  PRIMARY KEY (source, name)
);

-- Favorites: the project-switcher panel. Save host folders ("favorites") and organize them
-- into a tree of named groups. Groups nest via parentId (null = root); favorites live in a
-- group or at the root (groupId null). `position` orders siblings within a bucket. Like
-- `bookmarks`, parentId/groupId are plain columns (no FK REFERENCES) so the store keeps full
-- control of cascade-vs-reassign on group delete despite foreign_keys=ON.
CREATE TABLE IF NOT EXISTS favorite_groups (
  id        TEXT PRIMARY KEY,
  parentId  TEXT,
  name      TEXT NOT NULL,
  position  INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_favorite_groups_parent ON favorite_groups(parentId);
CREATE TABLE IF NOT EXISTS favorites (
  id        TEXT PRIMARY KEY,
  groupId   TEXT,
  folder    TEXT NOT NULL,
  label     TEXT,
  position  INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_favorites_group ON favorites(groupId);

-- Program blueprints: the node-canvas maps built in the Prompt Builder. `graph` is the React-Flow
-- graph (nodes + edges) as opaque JSON — the server stores and returns it verbatim, never parsing
-- its structure. `chat` is the AI-assistant transcript for that prompt session ([{role,content}]
-- as opaque JSON; NULL when none was saved). Both are saved so a blueprint reopens exactly as left.
CREATE TABLE IF NOT EXISTS blueprints (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  graph     TEXT NOT NULL,
  chat      TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

-- Scratchpad notes: the Notes panel. Free-form text notes the user jots and edits; the list is
-- their history, newest-edited first. `title` may be empty (the UI falls back to the first line).
-- `groupId` files a note into a note_groups collection (NULL = ungrouped); deleting that group
-- re-homes the note to NULL. Mirrors links.folderId.
CREATE TABLE IF NOT EXISTS notes (
  id        TEXT PRIMARY KEY,
  groupId   TEXT,
  title     TEXT NOT NULL DEFAULT '',
  content   TEXT NOT NULL DEFAULT '',
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
-- NOTE: the idx_notes_group index is created in store.ts's migration, AFTER the groupId column is
-- ensured — NOT here. On an existing DB this CREATE TABLE IF NOT EXISTS is a no-op (no groupId yet),
-- so a schema-time CREATE INDEX ON notes(groupId) would throw "no such column" before the ALTER runs.

-- Note groups: Mac-Notes-style collections for the scratchpad notes above, shown in the Notes panel's
-- left rail. A note with groupId = NULL is ungrouped (the implicit top level). `sort` orders the rail;
-- deleting a group re-homes its notes to NULL (the notes survive). Mirrors the link_folders table.
CREATE TABLE IF NOT EXISTS note_groups (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL DEFAULT '',
  color     TEXT,                              -- custom group-name / dot color (NULL = theme default)
  sort      INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

-- Web links ("important websites" the user saves in the top-bar Links dropdown) and the folders that
-- group them. Distinct from the `bookmarks` table above (which is line-level code bookmarks). A link
-- with folderId = NULL is ungrouped (top level). `sort` is the manual order within a folder (or within
-- the ungrouped set); folders carry their own `sort`. Deleting a folder re-homes its links to NULL.
CREATE TABLE IF NOT EXISTS link_folders (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL DEFAULT '',
  color     TEXT,                              -- custom folder-name text color (NULL = theme default)
  sort      INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS links (
  id          TEXT PRIMARY KEY,
  folderId    TEXT,
  title       TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  color       TEXT,                            -- custom text color: title at full, description dimmed (NULL = theme default)
  sort        INTEGER NOT NULL DEFAULT 0,
  createdAt   INTEGER NOT NULL,
  updatedAt   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_links_folder ON links(folderId);

-- Canvas sticky notes: quick throwaway post-its floating on a space's canvas (distinct from the
-- `notes` scratchpad above). `spaceId` scopes a note to one space like a workspace card (null =
-- Home). `color` is a hex tint from the shared ColorPicker (null = default yellow). x/y/w/h are
-- viewport-pixel geometry; `pinned` (0/1) floats the note above an open workspace room.
CREATE TABLE IF NOT EXISTS sticky_notes (
  id        TEXT PRIMARY KEY,
  spaceId   TEXT,
  content   TEXT NOT NULL DEFAULT '',
  color     TEXT,
  x         REAL NOT NULL DEFAULT 0,
  y         REAL NOT NULL DEFAULT 0,
  w         REAL NOT NULL DEFAULT 0,
  h         REAL NOT NULL DEFAULT 0,
  pinned    INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sticky_notes_space ON sticky_notes(spaceId);

-- Space widgets: glanceable cards dropped onto a space's canvas (Claude usage meter, world clock,
-- agent activity, today). Like sticky notes but typed by `kind`; `config` is opaque per-instance JSON
-- (e.g. a world clock's chosen cities). x/y/w/h are canvas geometry. Mirrors sticky_notes.
CREATE TABLE IF NOT EXISTS space_widgets (
  id        TEXT PRIMARY KEY,
  spaceId   TEXT,
  kind      TEXT NOT NULL,
  x         REAL NOT NULL DEFAULT 0,
  y         REAL NOT NULL DEFAULT 0,
  w         REAL NOT NULL DEFAULT 0,
  h         REAL NOT NULL DEFAULT 0,
  config    TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_space_widgets_space ON space_widgets(spaceId);

-- Usage-meter daily pacing baselines (TokenGauge model — see server/src/meters/baseline.ts). One row
-- per agent ('claude' | 'codex'): `dayStartWeeklyPct` is the weekly % captured at the start of the
-- current local day, so "used today" = current weekly % − this, surviving restarts. `weekKey` is the
-- epoch-day the 7-day window resets (flips a new week); `dayKey` is the local YYYY-MM-DD it was taken.
CREATE TABLE IF NOT EXISTS meter_baselines (
  agent             TEXT PRIMARY KEY,
  weekKey           INTEGER,
  dayKey            TEXT,
  dayStartWeeklyPct REAL NOT NULL DEFAULT 0,
  updatedAt         INTEGER NOT NULL
);

-- Spaces: virtual desktops. Each space is its own canvas of workspace cards (workspaces.spaceId).
-- `position` orders them in the switcher, contiguous 0..n-1. The permanent Home space + Desktop
-- catch-all card are created by the boot migration in store.ts and tracked via the settings keys
-- `homeSpaceId` / `desktopWorkspaceId`. `icon` is a codicon name (null = default glyph); `color`
-- is an accent/tint (null = default --tr-accent). `background` is the per-space canvas backdrop
-- override (CanvasBackground as opaque JSON; null = inherit the global `canvasBackground` setting).
CREATE TABLE IF NOT EXISTS spaces (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  icon       TEXT,
  color      TEXT,
  background TEXT,
  config     TEXT,
  position   INTEGER NOT NULL DEFAULT 0,
  createdAt  INTEGER NOT NULL,
  updatedAt  INTEGER NOT NULL
);

-- Space Creation Wizard config: the per-space SpaceConfig (skills/commands/MCP/env/rules the user
-- picked) is stored as the opaque JSON `config` column above. Every workspace created in (or a
-- terminal launched under) the space is seeded from it — see server/src/spaces/seeder.ts. `config`
-- is null on the Home space + any space made before the wizard existed (boot migration adds the
-- column; null = seed nothing).

-- Space presets: reusable named templates (React project, Python data, …). A preset is a saved COPY
-- of a SpaceConfig; creating a space from one copies the config into the space (presetId records
-- provenance only — editing either side never cross-contaminates). `config` is the same JSON blob.
CREATE TABLE IF NOT EXISTS space_presets (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  icon      TEXT,
  config    TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

-- Uploaded "bring your own" wallpapers for the canvas backdrop. The image rides as a data URL
-- (`data:image/…;base64,…`), the same approach as custom-agent icons, so it serves back through the
-- authed API and works as a CSS background even over a tunnel. Built-in wallpapers ship as static
-- assets (web/public/wallpapers) and are NOT stored here — this table is only the user's uploads.
CREATE TABLE IF NOT EXISTS wallpapers (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  dataUrl   TEXT NOT NULL,
  createdAt INTEGER NOT NULL
);

-- Task board: the floating kanban. A single global board whose cards move between three columns
-- (`column` = todo | doing | done). `position` orders cards within a column, ascending and
-- contiguous (renumbered on move/delete). `color` is an optional accent (hex; null = neutral).
-- The board is server-backed (not browser-local) so terminal agents can read and move cards
-- through the REST API on loopback. `column` is quoted in SQL because it is a reserved word.
CREATE TABLE IF NOT EXISTS board_cards (
  id        TEXT PRIMARY KEY,
  "column"  TEXT NOT NULL DEFAULT 'todo',
  position  INTEGER NOT NULL DEFAULT 0,
  title     TEXT NOT NULL DEFAULT '',
  body      TEXT NOT NULL DEFAULT '',
  color     TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

-- Calendar reminders / scheduled notifications. One row = one scheduled ping; the calendar is a view
-- over these. `fireAt`/`endAt`/`snoozeUntil`/`firedAt` are epoch-ms UTC instants (absolute moments,
-- never naive local) so the server timezone is irrelevant — the browser renders them in the viewer's
-- local zone. `channels` and `recurrence` are JSON blobs. The polling scheduler (server/src/scheduler)
-- selects due rows by (status, fireAt) — see the index. Server-backed so a loopback agent can create
-- reminders via POST /api/reminders, same as the board.
CREATE TABLE IF NOT EXISTS reminders (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  fireAt      INTEGER NOT NULL,
  allDay      INTEGER NOT NULL DEFAULT 0,
  endAt       INTEGER,
  leadMinutes INTEGER NOT NULL DEFAULT 0,
  color       TEXT,
  imagePath   TEXT,
  channels    TEXT NOT NULL DEFAULT '{"inApp":true,"pushover":false,"speak":true}',
  level       TEXT NOT NULL DEFAULT 'info',
  priority    INTEGER NOT NULL DEFAULT 0,
  recurrence  TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  snoozeUntil INTEGER,
  firedAt     INTEGER,
  wasMissed   INTEGER NOT NULL DEFAULT 0,
  createdAt   INTEGER NOT NULL,
  updatedAt   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(status, fireAt);

-- Persisted notification history backing the notification center. The live notify bus is
-- fire-and-forget, so every fire ALSO writes a row here — the inbox + unread badge survive restarts
-- and browser-closed gaps. `read` (0/1) drives the unread count. Newest-first by firedAt.
CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  reminderId  TEXT,
  title       TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  level       TEXT NOT NULL DEFAULT 'info',
  category    TEXT NOT NULL DEFAULT 'info',  -- center bucket: agent | error | info
  imagePath   TEXT,
  workspaceId TEXT,                          -- deep-link target (agent notifications)…
  terminalId  TEXT,                          -- …and the terminal to focus
  wasMissed   INTEGER NOT NULL DEFAULT 0,
  pushover    INTEGER NOT NULL DEFAULT 0,
  pushoverOk  INTEGER,
  read        INTEGER NOT NULL DEFAULT 0,
  firedAt     INTEGER NOT NULL,
  createdAt   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_fired ON notifications(firedAt);

-- Optional image attached to a reminder, stored as a data URL (`data:image/…;base64,…`) keyed by the
-- reminder id — the same in-DB approach as `wallpapers` and custom-agent icons, so it serves back
-- through the authed API and rides a Pushover attachment. Split from the reminders table so listing
-- reminders for the calendar never drags the image bytes along.
CREATE TABLE IF NOT EXISTS reminder_images (
  reminderId TEXT PRIMARY KEY,
  dataUrl    TEXT NOT NULL,
  createdAt  INTEGER NOT NULL
);

-- Connected Google Drive accounts for the File Browser's Drive mount. One row per Google
-- account. refresh_token/access_token are server-only secrets — NEVER returned to the browser
-- (listDriveAccounts projects the public columns). Keyed by email for idempotent re-connect.
CREATE TABLE IF NOT EXISTS drive_account (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT,
  label         TEXT,               -- user-chosen display name for this Drive (null = fall back to email)
  picture       TEXT,
  refresh_token TEXT NOT NULL,
  access_token  TEXT,
  expiry        INTEGER,
  scope         TEXT NOT NULL,
  createdAt     INTEGER NOT NULL
);

-- Temp access links ("add a teammate"). A link carries `secret` in the URL; using it grants FULL
-- access (same as the owner) and auto-opens `workspaceId`. Revoke = DELETE the row (the link dies
-- forever). Expiry: a row past `expiresAt` is treated invalid immediately and swept from the table
-- (so expired links delete themselves even if the manager is never opened). `secret` is stored
-- plaintext on purpose — the manager re-builds and re-copies the link later, the same in-DB-secret
-- approach the app already uses for the OpenAI key / Pushover / Drive refresh tokens.
CREATE TABLE IF NOT EXISTS access_keys (
  id          TEXT PRIMARY KEY,          -- ak_*
  label       TEXT NOT NULL DEFAULT '',  -- e.g. "Bob - frontend review" (also the presence name)
  secret      TEXT NOT NULL,             -- random URL credential, stored plaintext (re-copyable)
  workspaceId TEXT,                      -- room to auto-open on arrival (null = land on the canvas)
  expiresAt   INTEGER,                   -- epoch ms; null = never
  createdAt   INTEGER NOT NULL,
  lastUsedAt  INTEGER,                   -- updated on successful auth, throttled to ~1/min
  mirror      INTEGER NOT NULL DEFAULT 0, -- 1 = push the owner's UI nav (space/rooms/fullscreen/panels) to this viewer
  "lock"      INTEGER NOT NULL DEFAULT 0  -- 1 = viewer is a passive spectator (mouse + terminal typing disabled)
);
CREATE INDEX IF NOT EXISTS idx_access_keys_secret ON access_keys(secret);

-- Copilot conversations + their message transcripts. The in-app Copilot persists chats so they
-- survive refresh (the app's durability ethos). `content` is an opaque JSON array of canonical
-- content blocks (text / tool_use / tool_result) — the server stores and replays it verbatim.
-- Messages cascade-delete with their conversation; `rowid` preserves insertion order for replay.
CREATE TABLE IF NOT EXISTS copilot_conversations (
  id        TEXT PRIMARY KEY,
  title     TEXT NOT NULL DEFAULT '',
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS copilot_messages (
  id             TEXT PRIMARY KEY,
  conversationId TEXT NOT NULL REFERENCES copilot_conversations(id) ON DELETE CASCADE,
  role           TEXT NOT NULL,          -- 'user' | 'assistant'
  content        TEXT NOT NULL,          -- JSON ContentBlock[]
  createdAt      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_copilot_messages_conv ON copilot_messages(conversationId);

-- Per-skill enable state + settings for the Copilot's assignable skills. The built-in 'core' skill
-- is always on and has no row here; rows exist only for optional skills (e.g. 'email') the user
-- toggles. `settings` is an opaque JSON blob the skill interprets.
CREATE TABLE IF NOT EXISTS copilot_skills (
  id       TEXT PRIMARY KEY,
  enabled  INTEGER NOT NULL DEFAULT 0,
  settings TEXT NOT NULL DEFAULT '{}'
);

-- Connected accounts a copilot skill manages (e.g. the email skill's mailboxes). `secret` (an IMAP
-- app-password / OAuth token) is SERVER-ONLY and NEVER returned to the browser — the public listing
-- projects everything except it (mirrors drive_account / the AI key pattern). `config` is non-secret
-- JSON (imap user/host/port). Keyed `ca_*`.
CREATE TABLE IF NOT EXISTS copilot_skill_accounts (
  id        TEXT PRIMARY KEY,
  skillId   TEXT NOT NULL,
  label     TEXT NOT NULL,
  provider  TEXT NOT NULL,
  config    TEXT NOT NULL DEFAULT '{}',
  secret    TEXT NOT NULL DEFAULT '',
  createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_copilot_accounts_skill ON copilot_skill_accounts(skillId);

-- Scheduled copilot loops: run a single tool on an interval and report findings. `tool`+`args` is
-- what runs (e.g. email_check {provider:'gmail'}); `reportMode` decides when to ping the user
-- (always | on-change | on-find). `nextRun` drives the polling scheduler (see idx); `lastSummary`
-- is kept so on-change can compare. Dangerous tools are never auto-run by the scheduler.
CREATE TABLE IF NOT EXISTS copilot_jobs (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT '',
  tool        TEXT NOT NULL,
  args        TEXT NOT NULL DEFAULT '{}',
  intervalSec INTEGER NOT NULL,
  reportMode  TEXT NOT NULL DEFAULT 'on-change',
  enabled     INTEGER NOT NULL DEFAULT 1,
  nextRun     INTEGER NOT NULL,
  lastRun     INTEGER,
  lastSummary TEXT,
  createdAt   INTEGER NOT NULL,
  updatedAt   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_copilot_jobs_due ON copilot_jobs(enabled, nextRun);

-- MCP (Model Context Protocol) tool servers the Copilot connects to for extra tools. `transport` is
-- 'stdio' (spawn `command` argv on the host with `env`) or 'http' (connect to `url`). `tools` caches
-- the schemas discovered at connect time so the agent's tool list can be rebuilt without every server
-- being live; `run` connects on demand. `env` may hold secrets (API keys) so it's NEVER returned to
-- the browser — routes expose only the key NAMES. `status`/`lastError` record the last connect.
CREATE TABLE IF NOT EXISTS copilot_mcp_servers (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  transport  TEXT NOT NULL DEFAULT 'stdio',
  command    TEXT NOT NULL DEFAULT '[]',
  url        TEXT,
  env        TEXT NOT NULL DEFAULT '{}',
  enabled    INTEGER NOT NULL DEFAULT 1,
  tools      TEXT NOT NULL DEFAULT '[]',
  status     TEXT NOT NULL DEFAULT 'unknown',
  lastError  TEXT,
  createdAt  INTEGER NOT NULL,
  updatedAt  INTEGER NOT NULL
);

-- Timesheet: Harvest-style work-time tracking. `tt_entries` is one work session, started/stopped
-- either by a terminal agent over the loopback REST API or by hand in the Timesheet panel. The
-- client / project / task NAMES are stored denormalised on the entry (NOT foreign keys), so renaming
-- or deleting a catalog item never rewrites history; the tt_clients / tt_projects / tt_tasks tables
-- exist only to populate the dropdowns + the Settings tab. `stoppedAt` NULL = the timer is still
-- running (several may run at once). Duration is always DERIVED (stoppedAt − startedAt, or
-- now − startedAt while running) — never stored, so edits + live timers stay correct.
CREATE TABLE IF NOT EXISTS tt_clients (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  archived  INTEGER NOT NULL DEFAULT 0,   -- hidden from dropdowns when 1 (history keeps the name)
  position  INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tt_projects (
  id        TEXT PRIMARY KEY,
  clientId  TEXT NOT NULL,                -- owning client (plain column, no FK — store owns the cascade)
  name      TEXT NOT NULL,
  archived  INTEGER NOT NULL DEFAULT 0,
  position  INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tt_projects_client ON tt_projects(clientId);
CREATE TABLE IF NOT EXISTS tt_tasks (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,                -- task type, e.g. Programming, Creating ads, Generating images
  archived  INTEGER NOT NULL DEFAULT 0,
  position  INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tt_entries (
  id        TEXT PRIMARY KEY,
  client    TEXT NOT NULL DEFAULT '',     -- snapshot names (denormalised on purpose — see above)
  project   TEXT NOT NULL DEFAULT '',
  task      TEXT NOT NULL DEFAULT '',
  notes     TEXT NOT NULL DEFAULT '',
  startedAt INTEGER NOT NULL,
  stoppedAt INTEGER,                       -- NULL = still running
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tt_entries_started ON tt_entries(startedAt);
