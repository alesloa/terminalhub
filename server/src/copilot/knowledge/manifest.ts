// The Copilot's product knowledge — a curated capability manifest distilled from docs/FEATURES.md.
// Each entry is one feature: what it is + how to reach it. Injected (compactly) into the system
// prompt so the copilot "knows everything about the app", and searched by the knowledge tools for
// detail. KEEP IN SYNC with docs/FEATURES.md when features change (that file stays canonical).
export interface FeatureEntry {
  id: string;
  section: string;
  name: string;
  blurb: string;
  howToTrigger: string;
}

export const MANIFEST: FeatureEntry[] = [
  // ── Canvas & workspaces ──
  { id: "workspace-canvas", section: "Canvas & workspaces", name: "Workspace canvas", blurb: "A draggable surface of cards, one per host folder; positions persist, with an optional snap-to-grid.", howToTrigger: "The main screen. Drag cards to arrange; right-click the canvas for snap/tidy/background." },
  { id: "workspace-card", section: "Canvas & workspaces", name: "Workspace card", blurb: "Each card shows the folder, launch command, and a live status dot per terminal; Open enters the room.", howToTrigger: "Click a card's Open button. Right-click for its color picker." },
  { id: "new-workspace", section: "Canvas & workspaces", name: "New workspace", blurb: "Pick a host folder, choose an agent, optionally override the launch command, and drop it on a space.", howToTrigger: "Right-click the canvas → new workspace, or the + affordance." },
  { id: "clone-repo", section: "Canvas & workspaces", name: "Clone a repo into a workspace", blurb: "New Workspace can clone a git URL or a browsed GitHub repo into a chosen folder and open it.", howToTrigger: "New Workspace dialog → Clone repo toggle → paste URL or browse GitHub → Clone & Create." },
  { id: "github-browse", section: "Canvas & workspaces", name: "Browse your GitHub repos", blurb: "With gh installed and signed in, the clone dialog lists your repos (filterable, private/fork badges); supports multiple gh accounts.", howToTrigger: "Clone dialog → browse GitHub (needs gh auth login)." },
  { id: "workspace-folders", section: "Canvas & workspaces", name: "Workspace folders (iPhone-style)", blurb: "Group rarely-used cards into a folder so the canvas shows only current work; folders persist per space and sync across browsers.", howToTrigger: "Drag one card onto another, or multi-select → Group into folder. Click a folder to expand." },
  { id: "multi-select", section: "Canvas & workspaces", name: "Multi-select", blurb: "Rubber-band drag selects any mix of cards, sticky notes, and widgets; move or remove them together.", howToTrigger: "Drag a box on empty canvas; Shift/⌘-click to add/remove; Delete to remove." },
  { id: "non-destructive-delete", section: "Canvas & workspaces", name: "Non-destructive delete", blurb: "Deleting a card rehomes its terminals to a hidden Desktop catch-all instead of killing running agents.", howToTrigger: "Delete a card; its agents keep running." },

  // ── Spaces ──
  { id: "spaces-switcher", section: "Spaces", name: "Spaces (virtual desktops)", blurb: "Each space is its own canvas of cards; a top-bar pill switches spaces with per-space quick-jump dots.", howToTrigger: "Click the spaces pill in the top bar; the grid adds/renames/recolors/reorders spaces." },
  { id: "per-space-layout", section: "Spaces", name: "Per-space layout", blurb: "Which rooms are open, their geometry, and the focused room are scoped per space and restored on return.", howToTrigger: "Switch spaces; each remembers its open rooms." },
  { id: "cross-space-attention", section: "Spaces", name: "Cross-space attention", blurb: "A space's quick-jump dot pulses green when a terminal inside it needs attention while you're elsewhere.", howToTrigger: "Watch the top-bar space dots." },

  // ── Rooms & terminals ──
  { id: "room", section: "Rooms & terminals", name: "Room", blurb: "Opening a workspace gives a floating, resizable window with a code editor, file tree, git, and a terminal dock.", howToTrigger: "Open a workspace card." },
  { id: "durable-terminals", section: "Rooms & terminals", name: "Durable terminals", blurb: "Each terminal is a tmux session (tr_<ws>_<tm>); closing the browser detaches only — the agent keeps running and you reattach on return.", howToTrigger: "Just use terminals; they survive refresh, network drops, reconnects." },
  { id: "multiple-terminals", section: "Rooms & terminals", name: "Multiple terminals per room", blurb: "A tab strip of terminals: add, rename inline, recolor, set an icon, reorder, close; unnamed tabs auto-title from the prompt or first agent prompt.", howToTrigger: "Use the terminal tab strip in a room." },
  { id: "working-indicator", section: "Rooms & terminals", name: "Working indicator", blurb: "A card/terminal pulses with a KITT-style sweep while its AI agent is actively thinking/streaming.", howToTrigger: "Automatic when an agent is busy." },
  { id: "room-taskbar", section: "Rooms & terminals", name: "Room taskbar", blurb: "A Windows-style taskbar of pills, one per open room; click to jump to that room across spaces.", howToTrigger: "Bottom-left of the home stats bar." },
  { id: "buffer-viewer", section: "Rooms & terminals", name: "Buffer copy & viewer", blurb: "One-tap copy the whole terminal buffer, or open a selectable buffer window of the full tmux scrollback as real text.", howToTrigger: "Floating buttons on each terminal pane." },
  { id: "find-scrollback", section: "Rooms & terminals", name: "Find in scrollback", blurb: "Search the full terminal history via tmux copy-mode, highlighting matches in the live pane.", howToTrigger: "Right-click → Find…, or ⌘F / Ctrl+Shift+F." },

  // ── Agents ──
  { id: "agent-agnostic", section: "Agents", name: "Agent-agnostic launch", blurb: "Every terminal runs the workspace's launch command — claude by default, but anything (codex, a shell, a wrapper).", howToTrigger: "Set the launch command on the workspace or per terminal." },
  { id: "custom-agents", section: "Agents", name: "Custom agents", blurb: "Define named agents (command + icon) in the New-terminal picker, filed under a category.", howToTrigger: "New-terminal picker → add a custom agent." },
  { id: "claude-task", section: "Agents", name: "Add Claude Task (/goal, /loop)", blurb: "A wizard that builds Claude Code's /goal <condition> or /loop [interval] <task> primitives and starts them in a fresh session.", howToTrigger: "New-terminal picker → Add Claude Task." },
  { id: "headroom-launcher", section: "Agents", name: "Claude (Headroom) launcher", blurb: "Launches Claude through the Headroom context-compression proxy pinned to the 1M context window.", howToTrigger: "New-terminal picker → the teal Claude (Headroom) card (needs the headroom CLI)." },
  { id: "session-panel", section: "Agents", name: "Claude/Codex session panel", blurb: "Lists agent sessions in a workspace folder; pin, recolor, rename, view the conversation, resume, fork, or delete.", howToTrigger: "Open the session panel in a room." },
  { id: "name-sync", section: "Agents", name: "Two-way name sync", blurb: "Renaming a terminal tab renames the agent session inside it, and vice-versa — kept in lockstep by session id.", howToTrigger: "Rename a tab or a session." },

  // ── Editor & files ──
  { id: "explorer", section: "Editor & files", name: "Explorer", blurb: "A file tree rooted at the workspace folder with create/rename/delete/copy-path and keyboard shortcuts.", howToTrigger: "The room's left sidebar." },
  { id: "filter-files", section: "Editor & files", name: "Filter Files", blurb: "Indexed fuzzy filename search across the workspace; instant per-keystroke.", howToTrigger: "Filter Files panel; type to match." },
  { id: "find-in-files", section: "Editor & files", name: "Find in Files", blurb: "Full-text search with case/word/regex and include/exclude globs; results jump to the line. Replace-in-files too.", howToTrigger: "Find in Files panel." },
  { id: "editor", section: "Editor & files", name: "Syntax-highlighted editor", blurb: "CodeMirror with line numbers, minimap, word wrap, breadcrumbs, find & replace, multi-file tabs, configurable auto-save.", howToTrigger: "Click a file to open it in the editor." },
  { id: "go-to-def", section: "Editor & files", name: "Go to definition", blurb: "LSP-backed jump with Back/Forward history; language servers detected from $PATH.", howToTrigger: "Cmd/Ctrl-click a symbol or use go-to-definition." },
  { id: "diff-view", section: "Editor & files", name: "Diff view", blurb: "Split or unified diffs for changed files; images render as before|after; works for working-tree, staged, commit, and stash.", howToTrigger: "Click a changed file in the Git panel." },

  // ── Source control ──
  { id: "git-panel", section: "Source control", name: "Git panel", blurb: "Branch switcher, stage/commit box, grouped changes list; click a file for its diff. Multi-select stage/unstage/discard/stash.", howToTrigger: "The room's Source Control sidebar." },
  { id: "git-tabs", section: "Source control", name: "Graph / Branches / Worktrees / Stash / PRs", blurb: "Commit history graph (expand a commit to its files), branch ops, worktrees, stash view/restore, pull-request list.", howToTrigger: "Tabs at the bottom of the Git panel." },
  { id: "ai-commit", section: "Source control", name: "AI commit messages", blurb: "Generate a commit message via a configured AI provider (CLI, OpenAI-compatible, or Anthropic); keys stored server-side.", howToTrigger: "The commit box's generate button (configure providers in Settings)." },

  // ── Skills manager ──
  { id: "skills-manager", section: "Skills manager", name: "Skills manager", blurb: "Install, enable/disable, view, update, and remove Claude Code skills at workspace or global scope, with a searchable catalog. (Distinct from the Copilot's own skills.)", howToTrigger: "Skills tool in the launcher." },

  // ── Tools (launcher) ──
  { id: "favorites", section: "Tools", name: "Favorites", blurb: "A project switcher: saved host folders in nested reorderable groups, plus a filesystem browser; double-click to open as a workspace.", howToTrigger: "Launcher → Favorites." },
  { id: "stage-manager", section: "Tools", name: "Stage Manager", blurb: "A macOS-Stage-Manager edge dock of live room thumbnails for the current space; All-open switcher or Spotlight focus mode.", howToTrigger: "Launcher → Stage Manager; modes in Settings → Stage Manager." },
  { id: "files", section: "Tools", name: "Files", blurb: "A desktop-style file-manager window with tree, history, list/icon views, full file management, in-place editing, and live disk watching.", howToTrigger: "Launcher → Files." },
  { id: "google-drive", section: "Tools", name: "Google Drive", blurb: "Mount connected Google accounts inside Files as sources; browse, preview, and edit Drive files in place. OAuth secrets stay server-side.", howToTrigger: "Files → Connect Google Drive; configure in Settings → Connections → Google Drive." },
  { id: "notes", section: "Tools", name: "Notes", blurb: "A scratchpad of notes with a rich editor, auto-save, and optional dictation.", howToTrigger: "Launcher → Notes. (Copilot can write notes for you.)" },
  { id: "board", section: "Tools", name: "Board", blurb: "A server-backed kanban (To Do / In Progress / Done) you drag cards across; agents in terminals can read and move cards too.", howToTrigger: "Launcher → Board. (Copilot can add/move cards.)" },
  { id: "prompt-builder", section: "Tools", name: "Prompt builder", blurb: "A Quick Prompt wizard and a Blueprint Canvas node-graph that compiles a program map into an implementation prompt.", howToTrigger: "Launcher → Prompt builder." },
  { id: "secret", section: "Tools", name: "Secret", blurb: "Mint one-time, encrypted burnable links; ciphertext only leaves the host (gpg-encrypted). Needs gpg + a Yopass instance.", howToTrigger: "Launcher → Secret." },
  { id: "monitor", section: "Tools", name: "Monitor", blurb: "A system monitor: Processes (PID, CPU%, RAM%, kill) and Ports (listening ports + owning processes).", howToTrigger: "Launcher → Monitor, or click the stats bar." },
  { id: "localhost", section: "Tools", name: "Localhost", blurb: "A built-in browser for host-local dev servers; auto-detects ports and reverse-proxies them so they work even over a tunnel.", howToTrigger: "Launcher → Localhost, or ⌘-click a localhost link in a terminal." },
  { id: "share", section: "Tools", name: "Share", blurb: "Add a teammate with a temporary, revocable access link; optional mirror-my-view and lock-input; one-click Cloudflare quick tunnel.", howToTrigger: "Launcher → Share." },

  // ── Calendar / reminders / Pushover (BUILT — FEATURES.md still files these under Planned) ──
  { id: "calendar", section: "Calendar & reminders", name: "Calendar & reminders", blurb: "An Apple-Calendar-style window to schedule dated reminders (title, body, time, recurrence, image); times stored UTC, shown local.", howToTrigger: "Launcher/top-bar → Calendar. (Copilot can set reminders for you.)" },
  { id: "scheduled-delivery", section: "Calendar & reminders", name: "Scheduled delivery", blurb: "A server-side scheduler fires each reminder at its time as a toast/TTS and optional Pushover push; missed-while-down fire late on boot.", howToTrigger: "Automatic once a reminder is set." },
  { id: "pushover", section: "Calendar & reminders", name: "Pushover", blurb: "Add a Pushover app token + user key (Settings, server-side) to get reminders/alerts pushed to your phone.", howToTrigger: "Settings → Pushover token + user key." },

  // ── Widgets ──
  { id: "widgets", section: "Widgets", name: "Widgets gallery", blurb: "A top-bar gallery of live widget tiles you drag onto the canvas as draggable, resizable, per-space cards.", howToTrigger: "The Widgets button in the top bar (between the bell and Settings)." },
  { id: "claude-meter", section: "Widgets", name: "Claude usage meter", blurb: "Your Anthropic rate-limit utilization: 5-hour + weekly ring gauges plus a Today pacing panel.", howToTrigger: "Widgets gallery → Claude usage meter." },
  { id: "codex-meter", section: "Widgets", name: "Codex usage meter", blurb: "The OpenAI Codex twin of the Claude meter, using your ChatGPT login.", howToTrigger: "Widgets gallery → Codex usage meter." },
  { id: "world-clock", section: "Widgets", name: "World clock", blurb: "Analog + digital clocks for multiple cities, DST-correct.", howToTrigger: "Widgets gallery → World clock." },
  { id: "agent-activity", section: "Widgets", name: "Agent activity", blurb: "How many agents are running, workspaces active, and awaiting input, with a short list.", howToTrigger: "Widgets gallery → Agent activity." },
  { id: "today-widget", section: "Widgets", name: "Today", blurb: "Today's calendar reminders, recurrences expanded, sorted by time.", howToTrigger: "Widgets gallery → Today." },
  { id: "sticky-note", section: "Widgets", name: "Sticky note", blurb: "A quick post-it on the canvas (separate from the Notes scratchpad), recolorable and pinnable.", howToTrigger: "Widgets gallery → sticky note, or canvas right-click → new sticky note." },

  // ── Agent integration APIs ──
  { id: "notify-api", section: "Agent integration", name: "Notifications / messaging API", blurb: "POST /api/notify fires a toast on every dashboard with message, level, and sending session; clicking deep-links to that terminal.", howToTrigger: "Agents curl POST /api/notify on loopback. (Copilot's send_alert uses this.)" },
  { id: "notification-center", section: "Agent integration", name: "Notification center", blurb: "The top-bar bell is a synced inbox; notifications fire once server-side and stream to every browser; ignore a toast and it lands here.", howToTrigger: "Click the bell in the top bar." },
  { id: "board-api", section: "Agent integration", name: "Task board API", blurb: "GET /api/board, POST /api/board/cards, PATCH/DELETE for cards — terminals (and the copilot) drive the board over loopback.", howToTrigger: "Agents call /api/board. (Copilot's board tools use the store directly.)" },

  // ── Voice & dictation ──
  { id: "dictation", section: "Voice & dictation", name: "Dictation", blurb: "A mic button transcribes speech into the active terminal or selected note via browser STT or OpenAI Whisper.", howToTrigger: "The mic button; rebindable shortcut in Settings → Voice & Speech." },
  { id: "spoken-notifications", section: "Voice & dictation", name: "Spoken notifications", blurb: "Optionally speak agent messages aloud, with a voice picker, rate/volume, and an optional beep.", howToTrigger: "Settings → voice; per-notification speak flag." },

  // ── Appearance ──
  { id: "themes", section: "Appearance", name: "Themes", blurb: "Built-in editor/UI themes (Dracula, Nord, Tokyo Night, Catppuccin, Gruvbox, …) plus custom Terminal Hub themes.", howToTrigger: "Settings → Appearance → theme." },
  { id: "sidebar-position", section: "Appearance", name: "Sidebar position", blurb: "Place the activity bar left, right, top, or bottom.", howToTrigger: "Settings → Appearance." },
  { id: "toast-position", section: "Appearance", name: "Toast position", blurb: "Anchor notifications to any cell of a 3×3 grid.", howToTrigger: "Settings → toast position." },

  // ── Remote access & security ──
  { id: "local-first", section: "Remote access & security", name: "Local-first + token when exposed", blurb: "Binds to loopback with no token; a non-loopback bind or tunnel headers require TERMINALHUB_TOKEN. Fails closed on boot if exposed without a token.", howToTrigger: "Set TERMINALHUB_TOKEN when exposing; loopback needs nothing." },
  { id: "cloudflare-tunnel", section: "Remote access & security", name: "Cloudflare tunnel ready", blurb: "Designed to sit behind a Cloudflare tunnel + Access, with the token as backstop; Share can spin up a quick tunnel.", howToTrigger: "Use a tunnel or Share → Make a public link." },

  // ── Persistence ──
  { id: "persistence", section: "Persistence", name: "SQLite + tmux durability", blurb: "Metadata persists in SQLite and terminals live in tmux, so a refresh or reconnect reattaches to everything still running.", howToTrigger: "Automatic; open rooms also survive refresh per-machine." },
];

// Case-insensitive keyword scan over name + blurb + howToTrigger + section. Ranks by how many query
// words hit, then returns the top `limit`. Empty result for no match (callers report that honestly).
export function searchFeatures(query: string, limit = 5): FeatureEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return [];
  const scored = MANIFEST.map((e) => {
    const hay = `${e.name} ${e.blurb} ${e.howToTrigger} ${e.section}`.toLowerCase();
    const score = words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
    return { e, score };
  }).filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.e);
}
