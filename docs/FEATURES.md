# Terminal Hub — Features

A reference list of what Terminal Hub actually does today. Terminal Hub is an **agent manager**: a
draggable canvas of folder-backed workspace cards, each opening into a full room — code editor,
file tree, git, and durable terminals that auto-launch a coding agent. The terminals are backed by
tmux, so they survive refreshes, network drops, and reconnects.

This file is the "what ships now" list. For the spec see [`PRD.md`](PRD.md); for the build plan see
[`IMPLEMENTATION-PLAN.md`](IMPLEMENTATION-PLAN.md).

---

## Canvas & workspaces

- **Workspace canvas** — a draggable surface of cards, one per host folder. Positions persist; an
  optional "Snap to grid" toggle aligns cards as you move them.
- **Touch / iPad gestures** — one-finger swipe pans the board; press-and-hold a card (~0.2s) to pick it
  up and drag it with your finger (a quick swipe over a card pans instead, so the two never fight). The
  same press-and-hold-to-drag applies to every in-app reorderable list (terminal list, board cards,
  favorites tree, links menu), so a finger swipe scrolls them natively instead of grabbing an item.
- **Pan the canvas** — the whole board is one infinite canvas driven by a single per-space camera (the
  Figma/tldraw model — no scroll container, no scrollbars). Hold the middle mouse button and drag, or
  two-finger-scroll a trackpad, to push it around: it tracks your pointer 1:1 **at any zoom and from
  anywhere on screen** — start the drag over a card, a panel, an open room, or empty canvas. Panning is
  **unbounded** (no edge, no bounce); the Fit button snaps the whole board back if you wander off. A
  stationary middle-click never pans; middle-drag pans **over the terminal grid too** (the hand cursor shows
  there), and only a middle-click that starts in a text field is left to its native paste. A **floating IDE
  window pans with the board** — it stays glued to its spot over its card
  as you drag the canvas (it keeps a readable fixed size; zoom doesn't scale it). A **maximized** room is
  fullscreen and stays put. Middle-dragging the window's title bar pans the canvas (the hand tool wins over
  the window move, which stays on left-drag).
- **Canvas zoom** — pinch on iPad, ⌘/Ctrl-scroll on desktop (trackpad pinch counts), or the bottom-right
  zoom pill (Fit, −, the live %, +; click the % to reset to 100%). Zooms toward the pointer/pinch midpoint,
  ranges 25–200%. ⌘/Ctrl-scroll and pinch zoom the board **from anywhere on screen** — including over an
  open IDE room (a plain wheel there still scrolls the terminal/editor natively). **Each space keeps its own
  pan AND zoom**, remembered per browser across reloads. Cards
  drag, group, and right-click-drop at the correct spot at any zoom. **Sticky notes and widgets are board
  citizens** — they pan AND zoom in lockstep with the cards (place a note beside a card and it stays beside
  it), drop at the world point you click, and move freely with no edge clamp. Peer cursors stay aligned
  because they travel in shared world coordinates and re-project through each viewer's own camera.
- **Fit to view** — the frame button in the zoom pill recenters and zooms the camera to frame every card and
  folder on the space (or resets to 100% on an empty board). Because panning is unbounded, this is the
  one-click way back — there are no scrollbars to chase a stray card with; just hit Fit (or **Arrange** to
  repack the board into a grid).
- **Arrange** — a top-bar button that re-flows the current space into a compact, gap-free grid,
  filling top-to-bottom then across like a desktop's icons (as many rows as fit the visible canvas
  height). Folder groups always lead in the top-left, then the loose cards. Arrange handles only cards
  and folders; "Tidy up" (canvas right-click) instead packs EVERYTHING and splits the board in two —
  cards + folders pack on the LEFT (columns growing rightward), widgets + sticky notes pack on the RIGHT
  (right-aligned, growing leftward) — both fitting the visible browser height so nothing parks off-screen.
- **Workspace card** — shows the folder name, path, launch command, and a live status dot per
  terminal (green = alive, amber pulse = needs attention, green pulse glow = working). Open button
  enters the room; the card's accent color is set from a right-click color picker and tints the room.
  While its room is open the card **stays on the canvas but goes grayed-out and inert** (a visible
  "already open" marker) instead of vanishing — it can't be opened, dragged, grouped, renamed,
  recolored, or deleted until the room closes, at which point it fades back to full color.
- **Rename card** — right-click → "Rename…" turns the card title into an inline field (Enter or click
  away to save, Esc to cancel); renames the workspace's display name without touching its folder.
- **Working indicator** — while an AI agent in a card is actively thinking/streaming, its terminal
  dot pulses with a green glow and a KITT-style light sweeps back and forth along the card's bottom
  edge in the card's own border color. Detected by sampling the agent's visible tmux pane and looking
  for that agent's live in-flight line — Claude's `… (4m 40s · ↓ 8k tokens)` thinking line, Codex's
  `(… esc to interrupt)`, Gemini's `(esc to cancel, …)`, opencode's `Thinking…`/`esc interrupt`, and
  Cursor's `Generating…`. It's presence-based (the line is on screen for the whole turn and gone the
  instant it ends), so it never flickers on brief pauses and an idle/resumed session reads idle.
  Scoped to agent terminals (`claude`/`codex`/`gemini`/`opencode`/`cursor-agent` + custom agents) so
  running apps like `npm run dev`, Next.js, or NX never trigger it. Separate from the bell-based
  attention glow.
- **New workspace flow** — pick a folder (server-side picker), choose an agent, optionally override
  the launch command, and drop it onto a space.
- **Clone a repo into a new workspace** — the New Workspace dialog has a **Local folder / Clone repo**
  toggle. In *Clone repo* mode, either **paste any git URL** (`https://…`, `git@…`) or **browse your
  GitHub** and pick a repo, choose the folder to clone into, then **Clone & Create** — the server runs
  the clone into `<chosen folder>/<name>` and opens the result as the workspace. URL clones use plain
  `git clone`; GitHub-picked clones use the `gh` CLI's own auth, so **private repos work**. Credential
  prompts are disabled server-side, so a private https repo with no configured creds fails fast instead
  of hanging.
- **Clones never block the app** — *Clone & Create* starts the download as a background job on the
  server and closes the dialog immediately. A dimmed **placeholder card** (spinner + repo name) appears
  on the canvas at the spot the workspace will land, with an **X to cancel** — cancelling kills the
  clone and deletes the partially downloaded folder (confirmed first). When the clone finishes, the
  server creates the workspace itself (even if no browser is watching) and the real card replaces the
  placeholder; a failed clone shows its git error on the card, X to dismiss. In-flight clone cards
  survive a browser refresh.
- **Browse your GitHub repos** — when `gh` is installed and signed in (`gh auth login`), the clone
  dialog lists your repositories (filterable, with private/fork badges) to pick from; otherwise it
  shows a one-line hint to run `gh auth login`.
- **Multiple GitHub accounts** — if `gh` has more than one account connected (e.g. personal + work,
  even on different hosts), the picker shows an **account switcher**; each account's repos are listed
  using that account's own token (so its private repos appear), and the clone runs under whichever
  account the repo was browsed from. Switching accounts in the picker never changes your active
  `gh` account — nothing is `gh auth switch`-ed out from under your terminals.
- **Server-side folder picker** — a real file-browser-style picker (matches the File Browser look:
  material icons, hover rows) for choosing a folder when creating or cloning a workspace. Browses the
  host's real filesystem, including other volumes (`/Volumes/*` on macOS, `/mnt` `/media` `/home` on
  Linux). **Volume chips** + a **clickable breadcrumb** + a **".." / up** button to navigate; single-click
  selects a folder, double-click enters it, and **New Folder** creates a directory in place (then selects
  it). Files show dimmed for context. "Use this folder" picks the selection, or the folder you're in.
  **Sort by Name, Date Modified, or Size** with clickable column headers (click the active column again
  to reverse; folders always stay grouped first); each row shows its modified date, and files their size.
- **Non-destructive delete** — deleting a card rehomes its terminals to a hidden Desktop catch-all
  rather than killing running agents.
- **Per-space wallpaper** — right-click the canvas to set a background (solid, grid, pattern, theme
  preset, or an uploaded image). The wallpaper is per space, not global.
- **Canvas right-click menu** — right-clicking the bare canvas opens a menu to drop a new workspace
  or a new sticky note exactly where you clicked, "Tidy up" (cards + folders packed left, widgets +
  sticky notes packed right, both fitting inside the visible browser view — nothing left off-screen), or
  change the background.
- **Multi-select (desktop-style)** — drag a rubber-band box on the empty canvas to select any mix of
  workspace cards, sticky notes, and widgets at once (Shift/⌘-click adds or removes one; click empty
  space or press Escape to clear). Drag any selected item and the whole selection moves together;
  right-click a selection for "Remove selected", or press Delete/Backspace, to remove them all in one
  confirm (workspaces still rehome their terminals to Home; notes and widgets are deleted). The Home
  catch-all card is never selectable.
- **Workspace folders (iPhone-style)** — group cards you rarely open into a folder so the canvas
  shows only what you're working on now. **Make one** by dragging one card onto another (the target
  lights up — release to group) or by multi-selecting cards and choosing **Group into folder**. A
  folder looks like a small stack of cards (the pile deepens as it fills) with a blue folder glyph, a
  2×2 peek of its members + a count; drag it around the canvas like a card, and **double-click its name
  text** to rename it inline. **Click it** to expand — the overlay
  grows straight out of the folder (its top-left corner stays pinned to the tile, so it unfolds
  down-and-right out of the folder rather than as a centered popup) into a view of the little cards — pick one to enter
  its room, rename the folder, or take a card back out. **Remove a card from a folder three ways:** drag
  it out past the panel edge (a ghost flips to a red "release to remove" cue), right-click it, or use its
  hover pop-out button — all drop the card back onto the canvas. Each member card carries the **same
  right-click menu as a loose canvas card** (Open, Rename…, Copy Path, Reveal in Finder, Card Color,
  Move to space, Add to Favorites, Remove) plus **Remove from folder**, and inline-renames in place.
  Popping past the last two cards (or **Dissolve**) breaks the folder up. Drop a loose card onto a folder to add it.
  **Right-click a folder tile** for its own menu: **Open group** (expand the overlay), **Rename group…**
  (opens the overlay with the name field focused), **Dissolve group** — which pops every card back onto
  the canvas at a free grid cell (they line up on the grid instead of piling up) and removes the folder —
  and **Delete group & workspaces** (confirms first), which deletes the folder AND every card inside it so
  nothing returns to the canvas (any running terminals are preserved on the Home desktop). Folders persist per
  space in the database and sync across browsers, exactly like card layout — so a folder you make on
  one machine shows up everywhere (and over the tunnel).

## Spaces (virtual desktops)

- **Spaces switcher** — a pill in the top bar showing the active space, with one quick-jump dot per
  space. Click the pill for a Mission-Control-style grid to add, rename, recolor, reorder, or delete
  spaces.
- **Per-space layout** — which rooms are open, their positions and sizes, and the focused room are
  all scoped to the space and restored when you return.
- **Cross-space attention** — a space's quick-jump dot in the top-bar switcher pulses (fading in and
  out to a vivid lime green) when a terminal inside it needs attention — e.g. its agent just finished —
  while you're on a different space, even with that space's IDE/room closed.

## Rooms & durable terminals

- **Room** — opening a workspace gives a floating, resizable window (or fullscreen) with a title bar
  (workspace name + git branch), a left activity sidebar, a code editor, and a terminal dock.
- **Opens at its card, remembers where you leave it** — a workspace's first open grows the room out
  of its card and settles as a floating window pinned to the card's top-left corner. Once you drag,
  resize, or maximize it, that exact geometry + mode is restored on every reopen; until then the room
  re-anchors to its card each open (so reorganizing the canvas keeps the room landing on its card).
- **A clipped window stays grabbable** — shrink the browser under a floating room window and part of it may
  fall past the edge, but the title bar can never slide fully off-screen (a strip always stays in reach, and
  below the spaces bar), so you can grab it and drag the whole window back into view. (A maximized room
  always fits the screen, so it never clips.)
- **Durable terminals (the whole point)** — each terminal is one tmux session named
  `tr_<workspaceId>_<terminalId>`. Closing the browser detaches the attach process only; the session
  and the agent inside keep running. Reopen tomorrow and you're back where you left off.
- **Boot reconciliation** — on startup the server diffs stored terminals against live tmux sessions
  and reports alive/dead without deleting anything.
- **Clean pane environment** — terminals start like a normal login shell, not inside the hub's own
  process environment. The server's runtime vars are stripped before tmux is spawned — its listener
  `PORT` (so a pane running another dev server, e.g. vue-cli/vite, doesn't fight over 5173),
  `NODE_ENV=production`, the `TERMINALHUB_*` config (including the access token, which would otherwise
  be readable in every shell), and PM2's process-descriptor vars (`pm_id`, `name`, …) when run under
  PM2. Your real environment (PATH, HOME, SSH agent, etc.) passes through untouched. On boot the hub
  also scrubs those vars from an already-running tmux server's global environment, so terminals opened
  after an upgrade are clean too (already-open panes pick it up when recreated).
- **Multiple terminals per room** — a tab strip (Zed-style) of terminals; add, rename inline,
  recolor, set a per-terminal icon, drag to reorder, and close. Unnamed terminals auto-title from
  the shell prompt — and when the terminal launches an AI coding CLI (Claude, Codex, Gemini, Aider,
  OpenCode), the tab names itself after the first few words of your first prompt ("fix the login bug
  for the") — no agent prefix. For Claude it reads the session transcript directly (the same source
  the session browser uses), so the name is correct even when the first prompt is long and wraps
  across lines; other agents derive it from the on-screen prompt. Renaming a tab pins it — the
  auto-titler never overwrites a name you set yourself.
- **Per-agent default icon + color** — a terminal launched with a built-in agent opens already wearing
  that agent's brand icon (Claude, Codex, Gemini, opencode, Cursor) and accent color (the label is
  tinted to match), derived from its launch command — no setup. Both are just defaults: pick any
  codicon in the icon picker or any hex in the color picker to override, and clearing the override
  drops back to the agent's defaults. Plain shells keep the generic terminal glyph.
- **Live working indicator per terminal** — each row in the Terminals list shows when its agent is
  busy: blue equalizer bars pump in the left gutter and a KITT-style light sweeps along the row's
  bottom edge (the same sweep the workspace cards use) while it's thinking/streaming. Works for every
  built-in agent — Claude, Codex, Gemini, opencode, and Cursor — each matched on its own live
  in-flight line. A terminal that needs you instead shows the amber attention dot; attention outranks
  working, so the two never clash — making it obvious at a glance which terminal is actively running.
- **Per-terminal font zoom** — floating +/− zoom each terminal independently of the global default;
  the zoom persists per terminal.
- **Drag-to-paste paths** — drop a file onto a terminal to insert its shell-quoted path; paste a
  clipboard image to drop it into the workspace folder and insert its absolute path.
- **Path resolution** — clicked path tokens in terminal output resolve to absolute file/folder using
  the live pane's working directory.
- **Wheel scrollback** — mouse wheel drives tmux copy-mode scrollback through the socket. Typing or
  pasting snaps the pane straight back to the live prompt so the input always lands there (trailing
  trackpad inertia is ignored, so the view can't bounce back up into history).
- **Buffer copy & viewer** — floating buttons on each terminal pane: one-tap **copy the whole buffer**
  to the clipboard, or open a **selectable buffer window** showing the full tmux scrollback (history +
  live screen) as real text — click-and-drag, scroll, shift-click, and ⌘/Ctrl-C across the whole thing,
  which the in-pane grid can't do. New terminals keep a deep 10,000-line history.
- **Terminal right-click menu** — right-click anywhere in a terminal pane for Copy (the current
  selection), Paste (clipboard, bracketed-paste-aware so a multi-line paste doesn't submit early),
  Select All (visible grid), Find…, New Terminal / Duplicate Terminal, Copy All and View Buffer (the
  whole tmux scrollback), Clear (Ctrl+L — clears the screen, keeps the history), and Clear Scrollback
  (wipes the tmux history; confirmed first). Right-clicking directly on a URL or file path adds **Open
  Link / Open** and **Copy Link / Copy Path** at the top — open with no modifier needed.
- **Find in scrollback** — right-click → Find… (or ⌘F / Ctrl+Shift+F) opens an in-pane search box that
  drives tmux's own copy-mode search over the FULL history, highlighting matches in the live pane;
  ↑/↓ step between them and Esc snaps back to the live view.
- **Terminal list menus** — right-click a terminal tab for its per-terminal menu (rename, change icon,
  text color, fork session, close / close others / close above-below / close all); right-click the
  empty space below the tabs for the list-level menu (New Terminal, Close All Terminals).
- **Room taskbar** — a Windows-style taskbar pinned to the bottom-left of the home stats bar shows one
  pill per open room (workspace name + a status dot per terminal). Click a pill to jump straight to that
  room — sliding to its space and bringing it to the front (window mode untouched), even across virtual
  desktops. Pills appear the moment a room opens and disappear when it closes. The dots use the same
  language as the workspace cards: one per terminal, green-pulsing while an agent is working, amber-
  blinking while it needs attention, plain green when alive, dim when dead — so you can see at a glance
  how many terminals a room has and which one is busy or ready. Toggle it per device under
  **Settings → Appearance → Workbench → Active windows**.
- **Show Desktop** — a button at the bottom-right of the home stats bar that hides every open room on the
  current space in one press, clearing the canvas down to the bare workspace cards (the "desktop").
  Nothing is closed — the rooms stay open, their tmux sessions and agents keep running off-canvas (the
  same mechanism spotlight mode uses), so it's purely a hide. Press it again to bring them all back, or
  restore one at a time by clicking its **Stage Manager** dock thumbnail or its dimmed **Room taskbar**
  pill. The toggle highlights blue while the desktop is showing, and the state is remembered per device
  across refreshes. Scoped to the active space, so each virtual desktop hides and restores independently.
- **Minimize a window** — every room's title bar has a **minimize** button (the `—`, next to maximize and
  close). It collapses the window down **into its Stage Manager dock thumbnail** with a fly-to-tile
  animation, then leaves it hidden off-canvas — nothing closes, the tmux session and agent keep running
  (the same hide mechanism as Show Desktop). Click that dock thumbnail to **restore** it: the window grows
  back **out of its tile** and returns to the front. If the dock is closed when you minimize, it opens so
  there's a tile to land on. Minimized state is remembered per device across refreshes; you can also bring
  a minimized room back from its **Room taskbar** pill.

## Agents

- **Agent-agnostic launch** — every new terminal runs the workspace's launch command, `claude` by
  default but anything you can type (`codex`, a plain shell, your own wrapper).
- **Per-terminal launch override** — a single terminal can run a different agent/command than the
  workspace default.
- **Layered system prompts** — attach a system prompt to any agent launch, composed of three
  independently-controllable layers that merge global → workspace → terminal:
  - **Global (per agent)** — a base system prompt for each detected agent, set in **Settings → Agent
    Prompts** (one textarea per CLI found on `$PATH`). Every launch of that agent starts with it.
  - **Workspace** — a cog in the room header opens a draggable window to set a prompt for that
    workspace. A "Build on the agent's global prompt" toggle either appends it to the global layer or
    replaces it (use only the workspace text).
  - **Terminal** — the New-terminal modal has a one-off "System message for this terminal" field with
    its own "build on the layer above" toggle, layered on top of global ⊕ workspace.
  - **Injection is per-agent.** Claude takes the merged prompt via `--append-system-prompt-file`
    (a temp file). Codex/opencode (`AGENTS.md`), Gemini (`GEMINI.md`), and Cursor (`.cursor/rules`)
    get it written into the workspace folder inside a non-destructive managed block, so it sits
    alongside any existing instructions and is rewritten each launch. Empty layers inject nothing.
- **Custom agents** — define named agents (command + icon) in the New-terminal picker, filed under a
  category you choose or name (defaults to "Other"; "Detected agents" is reserved for `$PATH`-detected
  built-ins). Hover a custom agent to remove it. Built-in agents are detected from `$PATH`.
- **Remove / re-add any card** — every card in the New-terminal picker has a hover ✕ to remove it:
  detected built-ins (Claude/Codex/Cursor/…) and the Headroom launcher persist as removed (the CLI
  stays on disk, it's just hidden from the picker); custom CLIs delete outright. **Plain terminal is the
  one card that's always there** (no ✕). Removed built-ins/Headroom are re-addable from **"+ Add a CLI" →
  "Detected on your computer"**, which lists every agent found on your machine with an **Add** button on
  the ones you've removed.
- **Add Claude Task** — a wizard in the New-terminal picker that builds one of Claude Code's built-in
  autonomous primitives: `/goal <condition>` (iterate until tests pass / lint clean / a condition holds)
  or `/loop [interval] <task>` (re-run a task every 5m, 1h…, or self-paced). It opens a fresh Claude
  session and types the command in once Claude is up, starting the loop automatically.
- **Claude (Headroom) launcher** — a teal-tinted Claude card in the New-terminal picker that launches
  Claude through [Headroom](https://github.com/chopratejas/headroom), a local context-compression proxy
  (`headroom wrap claude --model "opus[1m]"`, which auto-starts/reuses the proxy). The `[1m]` pin forces
  Claude Code's 1M-token context window — through the proxy's custom base URL Opus's subscription 1M
  auto-upgrade doesn't apply, so without it the session would default to 200k and auto-compact early.
  Enabled when the `headroom` CLI is installed; otherwise it's grayed out and clicking shows install
  steps. A green/amber dot shows whether the compression proxy is currently answering. Hover ✕ to hide
  the card (persisted); restore it from a link at the bottom of the picker.
- **Claude/Codex session panel** — lists the agent sessions running in a workspace folder with name,
  age, and status. Pin, recolor, rename, view the full conversation, or delete. Double-clicking a
  session (or "Resume in terminal") reopens it in a new terminal; Claude resumes pinned to the 1M
  context window (`claude --model "opus[1m]" --resume <id>`) so it doesn't open at the 200k default.
- **Resume with Headroom** — right-click any session for a "Resume with Headroom" option that reopens it
  through the Headroom compression proxy (`headroom wrap claude --model "opus[1m]" --resume <id>`, with
  the `[1m]` 1M-context pin; Codex sessions resume without it). Grayed out when the `headroom` CLI isn't
  installed.
- **Two-way name sync** — renaming a terminal tab renames the agent session running inside it, and
  renaming a session in the panel renames its terminal tab — the two stay in lockstep. The link is the
  live session id (parsed from a resumed terminal's `--resume`/`resume` command, or detected from the
  pane's process tree for a fresh `claude`). A *fresh* Codex terminal can't be linked (Codex writes no
  PID files), so its tab and session rename independently.
- **Fork a session** — right-click a running session (or terminal) to clone its conversation into a
  new session, optionally into a different workspace.
- **Resume sessions** — reopening a workspace reattaches to its existing tmux sessions instead of
  spawning fresh agents — the "pick up where you left off" behavior.

## Code editor & files

- **Explorer** — a file tree rooted at the workspace folder, with create/rename/delete/copy-path,
  add-to-`.gitignore`, and keyboard shortcuts (F2 rename, cut/copy/paste, collapse/expand).
- **Copy to / paste from the real OS clipboard (local, macOS)** — Copy (or Ctrl/Cmd+C) a file, a folder,
  or a multi-selection in the Explorer and it *also* lands on the host OS clipboard, so a native Cmd/Ctrl+V
  in **Finder** pastes the actual files/folders (whole trees, intact — no re-upload). The reverse already
  works: Cmd/Ctrl+V into a folder pastes whatever you copied in Finder. Local-only — disabled over a tunnel
  so a remote user can never reach the host's clipboard.
- **Filter Files** — indexed, fuzzy filename search across the whole workspace (the file list is fetched
  once and filtered in memory, so every keystroke is instant). Matches the file's basename by default, so
  typing a name finds it no matter how deeply it's nested; include a `/` in the query to fuzzy-match the
  whole folder path instead. An `Aa` toggle makes the match case-sensitive. Empty until you type; matches
  show as a collapsed-to-the-matches path tree (only the folders that contain a hit, expanded), and
  clicking a file opens it. Cmd/Ctrl + ←/→ collapse/expand the whole result tree. Right-click any result
  for the file menu (Reveal in Explorer, reveal in Finder, open, cut/copy/duplicate/paste, copy path,
  delete); drag a result onto a terminal to drop its path, or into an Explorer folder to move it. Build &
  system folders (node_modules, .git, …) are excluded from the index.
- **Find in Files** — full-text search across the folder with case-sensitive, whole-word, regex, and
  include/exclude glob options; results jump to the line. A companion replace-in-files exists. Build &
  dependency folders (node_modules, dist, .next, …) and system folders (.git, .vscode, …) are excluded
  by default with two header toggles to flip each group on/off; an exclude glob prunes the whole matching
  directory subtree, and an explicit "files to include" glob opts a single excluded folder back in.
  Right-click any result (file row or match line) for the file menu (Reveal in Explorer, reveal in Finder,
  open, cut/copy/duplicate, copy path, delete); drag a result onto a terminal to drop its path, or into an
  Explorer folder to move it.
- **Syntax-highlighted editor** — CodeMirror with line numbers, minimap, word wrap, breadcrumbs,
  find & replace, multi-file tabs, and configurable auto-save.
- **Editor Back / Forward history** — a complete VS Code / Zed-style navigation stack. The **←/→
  buttons sit at the left of the editor tab strip** and step through everywhere you've been: switching
  files/tabs, opening from the explorer, go-to-definition round-trips, and jumping around *inside* a
  file (a big caret move records a stop; typing and small nudges just keep the current stop in sync).
  Back can re-open a tab you've since closed, restoring its kind and scroll position.
- **Go to definition** — LSP-backed jump that feeds the Back/Forward history above; language
  servers are detected from `$PATH` and bridged over a WebSocket.
- **Better Comments** — VS Code "Better Comments"-style coloring of tagged comments (`!`, `?`, `//`,
  `todo`, `*`) driven off the real syntax tree; colors are customizable in Settings.
- **Bookmarks** — VS Code "Bookmarks"-style line markers across files, listed in a sidebar panel
  with label + preview, jump-to-line, and export to markdown. Keyed by folder, so they survive
  re-adding a workspace.
- **TODOs** — VS Code "Todo Tree" / Zed-style sidebar panel that scans the workspace folder for
  `TODO`/`FIXME`/`HACK`/`BUG`/`XXX` comment tags, grouped by file with line numbers and a colored
  tag pill. Click a row to jump to the file at that line; a refresh button rescans. Comment-aware and
  case-sensitive (so the lowercase word "bug" in prose doesn't match a `BUG` marker), and build &
  dependency folders (node_modules, dist, …) are skipped.
- **Special file viewers** — Markdown viewer, PDF viewer (page controls, zoom, fill-and-sign),
  CSV table editor, DOCX viewer, image viewer, video player, audio player, HTML iframe render, and
  collapsible JSON.
- **Video player** — clicking a video file (mp4, m4v, mov, webm, ogv, mkv, avi, wmv, flv, 3gp,
  m2ts/mts) plays it inline in the editor tab area, exactly like an image or PDF preview — no popup.
  It streams straight off disk with HTTP byte-range support, so a 4K/multi-GB file plays and seeks
  instantly without ever loading into memory (the other previews base64 the whole file, capped at
  25 MiB). Native play/seek/volume/PiP controls, plus **scroll to zoom + drag to pan** for inspecting
  detail, a **playback-speed slider** (0.2×–4× in 0.1 steps, updates in real time, click the readout
  to reset to 1×), and a **Fullscreen** button. A format the browser can't decode shows a **Reveal in
  Finder / Open externally** fallback. Same inline playback in the File Browser's Quick Look.
- **Audio player** — clicking an audio file (mp3, m4a, aac, wav, flac, ogg, oga, opus, weba, wma)
  plays it inline the same way (editor tab + File Browser Quick Look), over the same off-disk
  byte-range stream so seeking works without loading the whole file. Native play/seek/volume controls
  with a music-note placeholder and filename, plus the same real-time **playback-speed slider**; the
  same **Reveal in Finder / Open externally** fallback on an undecodable format.
- **Markdown viewer** — opens read-only by default: source is rendered to sanitized static HTML
  (markdown-it + DOMPurify), so a stray `<name>`, `List<T>`, or `a < b` shows as literal text and the
  document never errors out the way the rich-text editor does on a bad tag; CPU also stays flat on big
  notes. A **Read / Edit** toggle in the header switches to the opt-in WYSIWYG editor (rich-text/source,
  toolbar, image paste, color spans). A **brightness tint** popover dims the letters and lifts the
  background per-browser, and external links open in a new tab.
- **Diff view** — split or unified diffs for changed files, toggleable, styled to match VS Code's diff
  editor: VS Code's exact dark diff palette (soft red/green line wash, a stronger same-hue wash on the
  changed characters, soft-tinted line-number gutter), diagonal-hatch filler blocks where one side has
  lines the other lacks, and VS Code "Dark Modern" syntax highlighting (the same theme the workspace
  editor now uses). A precise diff (raised scan limit) so a large file with a small edit shows only the
  lines that actually changed, not the whole file. Instead of the code minimap, a single-file diff shows
  a VS Code-style **change-overview ruler** — a thin column of red/green marks at each change's position
  with a draggable viewport thumb, for spotting and jumping to changes. Image files (png, jpg, webp, svg,
  gif, avif, …) render as images — before|after for
  a modified image, a single pane for an added/deleted one — instead of a text diff. Other binary files
  fall back to a raw bytes-as-text view so nothing dead-ends on "no textual changes" (the diff is
  read-only; editing binaries is lossy). Works for working-tree, staged, commit, and stash diffs.

## Source control

- **Git panel** — branch switcher, stage/commit box, and a grouped changes list; clicking a changed
  file opens its diff.
- **File row menu** — right-click any file in the changes list to Stage/Unstage, Discard, Stash, add
  to .gitignore, open its diff/file, reveal it, copy its path, or **Delete File** — a disk delete
  (`fs` unlink) that works even on an untracked/new file where Discard can't, so you don't have to
  reveal it in the OS file manager first. The Delete row is red and confirms via a modal before it
  removes the file; the changes list refreshes immediately.
- **Multi-select changes** — Cmd/Ctrl-click to toggle files, Shift-click to select a range in the
  changes list; right-click the selection to Stage, Unstage, Discard, Stash (one combined stash),
  add to .gitignore, copy the paths of every selected file, or **Delete** them all from disk (one
  confirm). Dragging a selected row drags them all.
- **Self-healing index.lock** — a git write blocked by a leftover `.git/index.lock` (a git process
  that crashed without cleaning up) no longer dead-ends you with "Another git process seems to be
  running… remove the file manually." After briefly riding out a genuinely-concurrent lock, the app
  verifies the lock is a true orphan (no live process holds it open) and removes it, then retries the
  command — so staging/committing just works. A lock a live git is legitimately holding (e.g. a slow
  pre-commit hook in one of your terminals) is never touched.
- **Changes background menu** — right-click the empty area below the file list for repo-wide bulk
  actions: Stage All, Unstage All, Stash/Pop/View stashes, Discard All Tracked Changes, and Trash
  Untracked Files (`git clean -fd`). Destructive items confirm first via a modal.
- **Submodules drill-in** — a dirty submodule/embedded-repo (untracked or modified files *inside* it)
  can't be staged from its parent, so instead of a stuck "won't tick" row it's listed under a
  **Submodules** group with its inner state. Click it to re-root the whole panel at the submodule —
  its files become ordinary stageable changes you commit in the submodule's own repo — then a
  breadcrumb pops back to the parent (VS Code's "submodule is its own source-control scope").
- **Graph / Branches / Worktrees / Stash / PRs tabs** — commit history graph, branch
  create/switch/delete, worktree management, stash view/restore, and a pull-request list.
- **Create branch** — the ＋ on the Branches tab opens a tiny popover with just a name field (Enter
  creates, Esc/click-away closes — no dropdown, no browser prompt); switching branches is the inline
  list below the header. The room-header branch chip keeps a fuller dropdown — a lazy-loaded,
  searchable list to switch plus a create row — since it has no inline list to fall back on. The git
  panel's own `folder / branch` header (the one above the tab strip) carries that same searchable
  switcher: click the branch name (▾) to switch or create a branch without leaving the panel. In the
  header the folder name and its icon never truncate (always shown in full); only the branch name
  gives way when space is tight, clipping with no ellipsis so as much of it shows as fits.
- **Pinned branch order** — every branch-switch dropdown lists `main` first, then `staging` (when
  those branches exist), then all other branches alphabetically — so the two you switch between most
  never get buried in a long, otherwise-alphabetical list.
- **Worktree add popover** — the Worktrees ＋ opens a popover with a path field plus the same branch
  filter; pick an existing branch (or create a new one with `-b`) to run `git worktree add` at that
  path. Replaces the two chained browser prompts.
- **Inline list filter + lazy loading** — the Branches and Worktrees tabs each have a filter box just
  under their header that narrows the list in place as you type (branch name/upstream, or worktree
  branch/path). The lists render incrementally and load more as you scroll, so a repo with thousands
  of branches or worktrees stays fast instead of mounting every row at once.
- **PR filter** — the PRs tab has a live filter box (matches title, #number, head branch, or author).
- **Create Pull Request modal** — the PRs tab ＋ (and the git header's **Create Pull Request** menu
  item) open a centered compose dialog for `gh pr create`: a `head → base` row (base preselected to
  the repo's default branch, changeable from the same branch filter), a `via <provider> ▾` model
  picker (the **same** provider list the commit-message generator uses — switch the active one, or
  **Add Models…** to open AI settings), a Title field, a Description with a **✦ Generate** button, an
  **Edit Prompt…** shortcut into the prompt settings, and a Draft toggle. gh's own errors (e.g. "must
  first push the branch") surface as a toast.
- **Open-PR indicator** — when the current branch has an open pull request, the git header shows a
  green **PR #n** chip next to the branch; click it to open the PR in the browser. It's read from
  `gh pr list` (open PRs only), so once the PR is merged or closed the chip disappears on its own.
- **AI-generated PR description** — ✦ Generate writes the PR title + body from the branch's commits
  (`base..HEAD`) and changed files (`base...HEAD`) through the active AI provider, using an editable
  PR prompt (Conventional-Commits title on the first line, a Markdown `## Summary` body). The prompt
  is configurable in **AI Providers → Pull request prompt** (reset-to-default supported), exactly like
  the commit-message prompt.
- **Initialize Repository (account-aware)** — on a folder that isn't under version control, the
  *Initialize Repository* button opens a dialog instead of running a bare `git init`. When `gh` has
  more than one account connected, an **Account** dropdown picks which identity the repo should commit
  under; the chosen account's name + email (resolved from its GitHub profile, falling back to its
  `noreply` address when the profile email is private) are written **repo-locally** — overriding your
  global/`includeIf` identity for just this repo. A live *"commits as …"* line shows exactly what will
  be set so you can catch the wrong account before committing. An **Add a .gitignore** step (on by
  default) detects the stack(s) in the folder — Node, Python, Rust, Go, Java/Gradle, .NET, PHP, Ruby,
  Swift, Elixir, multiple at once — and writes a sensible default that always keeps `.env`/secrets, OS
  junk, and build output (`node_modules/`, `.next/`, `target/`, …) out of the repo; the preview line
  names what it detected, and an existing `.gitignore` is never clobbered. It's written **before**
  staging, so the very first commit is clean. An optional **Create initial commit**
  step (on by default) stages everything and makes the first commit with an editable message
  (defaulting to `Initial commit`), with the same **✨ generate + provider chevron** the commit box
  uses — switch the active AI provider or open **Add / edit models…** right from the dialog. Generation
  summarizes the project from its top-level files (it never `git add -A`s the whole folder first, so it
  stays instant even on a `node_modules`-heavy project). With no `gh` account (or `gh` missing) it falls
  back to a plain init under your global git identity.
- **Publish to GitHub (multi-account)** — *Publish to GitHub* (the smart-sync button on a folder with
  no remote) opens a dialog that creates the repo via `gh` and pushes. When `gh` has more than one
  account connected, it adds an **Account** dropdown so you choose which identity to publish under;
  the repo is created with that account's own token (the owner list + orgs reflect it too) without
  `gh auth switch` flipping your active account. The Owner row only appears when the chosen account
  can also create under an org. An optional **Topics** field (comma-separated) tags the new repo for
  discovery — applied in a follow-up `gh repo edit --add-topic` after create, normalised to GitHub's
  rules (lowercase, spaces → hyphens, deduped) and best-effort so a topic hiccup never fails the push.
- **Account-aware fetch / pull / push / sync** — git network ops authenticate as the signed-in `gh`
  account that owns each repo's `origin`, not just your globally-active account. A private repo owned
  by a *non-active* account (e.g. a work repo while your personal account is active) fetches/pulls/
  pushes cleanly instead of failing with "Repository not found"; the owning account's token is matched
  by origin owner and injected for that one command — your active `gh` account is never switched. For
  an org-owned repo, if the active account can't authenticate it transparently retries as the other
  signed-in accounts. A genuine non-auth failure (rejected push, merge conflict) still surfaces as-is.
- **Force Push** — in the git-ops menu (the ⌄ next to the smart-sync button): overwrites the remote
  branch with your local one (`git push --force`). The escape hatch when a branch has diverged with
  *unrelated histories* (a re-init'd repo, or a remote that was force-pushed elsewhere) — Sync can't
  merge those ("refusing to merge unrelated histories") and a plain push is rejected, so a force-push
  is the only way to make the remote match local. Gated behind a centered confirm (it discards remote
  commits you don't have and can't be undone) and account-aware like the other network ops. When a
  **Sync or Push fails** for exactly this reason, the error toast itself grows a **Force Push** button
  (and sticks, so the offer doesn't time out) — one click opens that same confirm, so the dead-end
  becomes a one-tap fix instead of sending you hunting through the menu.
- **Resizable tabs section** — the bottom block (the `folder / branch` header + tab strip + tab
  body) is drag-to-resize against the commit/changes area above it. Grab it from the thin seam at
  its top *or* anywhere along the whole header bar (its buttons stay clickable).
- **Expand a commit in the graph** — click any commit row in the history graph to expand it inline
  to its changed files (status letter + name + folder, VS Code-style), with the swimlanes continuing
  straight down through the list. Click a file to open just that file's side-by-side diff (its parent
  version vs the commit). Right-click → "Open Changes" still opens the whole commit's diff.
- **GitHub integration** — an authenticated panel to browse repos and work with pull requests.
- **AI commit messages** — generate a commit message for a repo via a configured AI provider (local
  CLI, OpenAI-compatible, or Anthropic). API providers (OpenAI, DeepSeek, Kimi/Moonshot, OpenRouter,
  …) just need an API key pasted in; a **↻ Refresh** button next to the model field fetches
  the provider's live model list (OpenAI-compatible `GET /models`, Anthropic `GET /v1/models`) into a
  dropdown so you pick a real model instead of typing an id. Base URL, the env-var key fallback, and a
  manual model-id field live under a collapsed **Advanced** section. Keys are stored server-side and
  never sent back to the browser.
- **CLI providers are auto-detected** — the AI Providers **Add:** row offers every coding-agent CLI
  actually installed on `$PATH` (Claude, Codex, Gemini, Cursor), each wired with its confirmed
  non-interactive one-shot invocation. Each CLI provider can also **choose a model** (passed as
  `--model`/`-m` to the CLI). Because no CLI can list its own models, the **↻ Refresh** dropdown pulls
  the *real* model list from the CLI's backing API (Anthropic/OpenAI/Google) using any key it can find
  — a key set on the CLI provider, the backing env var (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/
  `GEMINI_API_KEY`), or a matching API provider you've already configured — and falls back to a manual
  model-id field when there's no key (or, like Cursor, no public model API). Nothing is hardcoded.

## Skills manager

- **Installed skills** — list, enable/disable, view `SKILL.md`, update, and remove Claude Code
  skills at workspace or global scope.
- **Catalog & search** — browse an indexed catalog assembled from configured sources, search, and
  install by URL or from the catalog. A source can be `owner/repo`, a full git URL, a GitHub
  `/tree/<ref>/<sub>` browse URL, a GitHub API "git trees" URL or a `raw.githubusercontent.com`
  link (both auto-resolved to the underlying repo + ref + subpath), or a local path. Each source is
  shallow-cloned and walked for `SKILL.md` folders; a source that fails to index surfaces its error
  inline on the Catalog tab, so an empty catalog is never silent. The catalog splits into
  **Official** and **Unofficial** sub-tabs: each source carries an **Official** checkbox you control
  in the sources manager (seeded on for known vendor orgs like anthropics/openai, freely
  overridable), and every skill inherits its source's flag. The Official tab shows each skill's
  origin source; the Unofficial tab omits it. A fresh server ships with a default set of sources
  pre-loaded (Anthropic, OpenAI/Codex, GitHub Copilot — all Official — plus a large community
  repo), seeded once on first boot so removing one doesn't bring it back; one Reindex fills them.
- **Update checks** — detect and apply updates to skills installed from remote sources.

## Tools (the launcher)

The top-bar launcher groups tools into Workspace / Tools / System, with a search box. Each opens as a
floating window that grows from its launcher tile and minimizes back into it.

- **Favorites** — a project switcher (port of a VS Code extension): saved host folders in nested,
  reorderable groups, plus a filesystem browser. Double-click a favorite or folder to open it as a
  new workspace.
- **Stage Manager** — a macOS-Stage-Manager-style **edge dock** of **floating window thumbnails**,
  one per open room **in the current space**, sitting on a **macOS-Dock-style frosted-glass panel**
  (translucent + backdrop-blurred so the canvas shows through softly — fully editable, or turned off
  for bare floating tiles; see below). Each thumbnail is a faithful **mini render of the whole room window**, drawn from the
  room's live state: a peacock-tinted title bar with the room name and **one status dot per terminal**
  (like the bottom stats bar — gray when idle, green while its agent is working, amber when it needs you,
  so the row shows how many terminals there are and what each is doing), the sidebar
  (when open, sized to the real sidebar width, showing the folder's real top-level files), the editor
  area with the room's real open-file tabs, and the terminal dock holding the live terminal screen —
  the whole captured screen scaled to fit (no crop; ~2s refresh, ANSI colors, captured server-side so
  it stays live even when the room is off-canvas). Slide/scroll through the tiles (scroll-snap, the
  centered tile enlarges). Two modes, chosen in **Settings → Stage Manager** (the dock itself has no
  mode control — just a close button): **All-open** (every room stays on the canvas; the dock is a plain
  switcher) and **Spotlight** (focus mode — only the staged room renders on the canvas; the rest stay
  alive in tmux off-canvas). **In All-open the strip is a fixed macOS-Dock-style row — the tiles never
  reshuffle.** Clicking one just pops that room to the front of the canvas (no thumbnail movement, no
  canvas grow — the window is already on the space); the active tile shows the focus ring. The thumbnails
  still FLIP-slide when the *set* changes (a room closes, or you switch spaces), so those reflows stay
  fluid. **In Spotlight**, clicking stages the room so it mounts and **grows out of its thumbnail** into
  place (the grow only happens here, where the room genuinely wasn't on the canvas), while the previous
  one drops off-canvas. Clicking the room that's already staged does nothing.
  Scoped to the active space, so a tile can never silently focus a room parked on another virtual
  space. Attention also washes the whole tile with an amber glow (the per-terminal dots carry the detail),
  wired to the same bell→notification pipeline as the toasts. Position is configurable (left/right/bottom,
  default left) in **Settings → Stage Manager**, along with a **Dock size** slider (50–100%) that shrinks
  the whole dock uniformly — every tile and the gaps between them get smaller in lockstep, same layout, with
  a live preview as you drag — and a master **enable/disable** toggle to hide the whole feature. The dock's
  position, size, and on/off state are cached per-browser so they paint correctly on the first frame after a
  refresh (no default-then-jump flash). The **frosted background panel** behind the tiles is fully editable in
  **Settings → Stage Manager**: **background color + opacity**, **border color + opacity** (each can be set
  fully **transparent** — a one-tap button or 0% slider — for no fill / no border), and the **blur** amount;
  colors track the active theme until you pin a hex, and the whole panel can be switched off for the old bare
  floating-tiles look. These dock-background settings persist server-side (shared across browsers); everything
  applies live as you drag.
- **Files** — a desktop-style file-manager window with a folder tree, navigation history (back/
  forward), a bottom breadcrumb, and switchable list / icon views. Full file management like the
  workspace Explorer: cut/copy/paste, duplicate, rename, delete, new file/folder, and dropping (or
  OS-pasting) files in to upload — plus Quick-Look-style preview, "Open in Workspace," and
  drag-into-terminal. Shares one app-wide clipboard with every workspace Explorer, so you can
  copy/cut here and paste into a workspace's file tree (and vice-versa).
  - **Drive / quick-access chips** — a row of clickable chips above the contents pane, one per mounted
    volume on the host (`/ (root)` + every `/Volumes/*` on macOS, drive letters on Windows, `/mnt`
    `/media` `/home` on Linux — the same source as the workspace folder picker). Click one to jump
    straight to that drive's root; the chip for the drive you're currently inside is highlighted.
  - **Type-ahead navigation** — start typing and the list jumps to the first matching name, just like
    Finder/Explorer: distinct keys in quick succession build a prefix ("tr" → first "tr…"), the same
    letter repeated cycles through matches, and a short pause starts a fresh search. Arrow keys and
    type-ahead both keep the selected row scrolled into view.
  - **Edit files in place** — double-click a text/code file (or right-click → *Edit*) to open it in a
    floating editor window: a full CodeMirror editor with per-language syntax highlighting, the same
    VS Code-style **find / find-&-replace** widget the workspace editor uses (⌘/Ctrl-F find; ⌘/Ctrl-Alt-F
    or Ctrl-H replace; match-case / whole-word / regex toggles and a match counter), and **⌘/Ctrl-S to
    save**. Covers the common languages, data, and config formats (`.py`, `.js`/`.ts`, `.md`, `.json`,
    `.yaml`, `.css`, `.sql`, dotfiles, extensionless files like `Dockerfile`…). Works on **host files
    and on Google Drive files alike** — saving a Drive file overwrites the same file in place.
    Images/PDFs and Google-native Docs/Sheets stay preview-only (the latter open in Google). Closing
    with unsaved edits shows a **Notepad-style Save / Don't Save / Cancel** prompt, so nothing is
    written or dropped without your say-so — and if the window goes away another way (the whole File
    Browser is closed, or a refresh), the unsaved buffer is **kept as a local draft and restored
    (still dirty) the next time you open that file** (VS Code "hot exit"; never written to disk on its
    own). Space still triggers a read-only Quick Look peek (now themed, so Drive text is readable in
    dark mode).
  - **Live disk watching** — an open **host** file tracks its file on disk: when an agent writes to
    it, or it's edited anywhere else, the editor reloads the new contents in real time (cursor kept)
    instead of going stale until you reopen it. If you have **unsaved edits** when the file changes
    underneath you, it never clobbers them — a banner offers *Reload* (take disk) or *Keep mine*;
    deletion on disk offers *Save to recreate*. (Drive files have no filesystem to watch.)
- **Google Drive** — mount connected Google accounts inside the Files window as sources, like a
  network drive in Windows Explorer. The left navigator is a **unified tree**: *Computer* (your whole
  machine) and every connected Drive sit side by side as sibling roots, so opening a Drive never hides
  your local files — you can jump between them and edit files on either without switching "places." A
  single *＋ Connect Google Drive* action sits above the tree (reads *＋ Add another Google Drive* once
  one is connected). Browse My Drive / Shared with me / Shared drives; preview files in Quick Look
  (Google Docs/Sheets/Slides export to PDF; double-click opens text/code in the editor), with "Open in
  Google ↗" to jump to the live editor and Download for raw files. **Edit + save Drive text/code files
  in place** (see *Files* above). Full read-write against Drive — new folder, rename, move (cut/paste
  within an account), delete (moves to Drive Trash, recoverable), and upload (drop files onto a Drive
  folder). **Connect unlimited Google accounts from one set of keys** — each becomes its own root in
  the tree; the consent flow forces the account chooser so adding a second/third account is reliable.
  **Name each connected Drive** (the custom label shows in the tree instead of the email) and remove
  one with its ✕ in Settings (or right-click its tree node → Disconnect). OAuth `client_secret` and refresh tokens live only on the server — the
  browser only ever sees mapped entries and file bytes. Configure the OAuth client in **Settings →
  Connections → Google Drive** (Client ID + Client Secret, stored in the DB; the secret is write-only
  and shown only as "•••• saved"), then connect Google accounts right there or from the Places bar.
  An optional **Redirect URI override** pins the OAuth callback to a value registered in Google Cloud
  when the auto-derived one doesn't match (VPS / custom domain, or `localhost` vs `127.0.0.1`).
  Credentials resolve Settings-first, falling back to the `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
  env vars (with an optional `GOOGLE_OAUTH_REDIRECT`); when neither is set the *＋ Connect Google
  Drive* row opens Settings and `/api/drive/*` returns "not configured" — no fake accounts.
- **Notes** — a macOS-Notes-style scratchpad laid out in three panes: a **group rail**, a searchable
  note list, and the editor. **Groups** are collections you file notes into — create one in the rail
  (inline rename, click its dot to recolor), then move a note in three ways: **drag** a list row onto a
  group, **right-click → Move to**, or the editor's **Move to** selector. "All Notes" / "Ungrouped" are
  always there; deleting a group keeps its notes (they fall back to Ungrouped). A collapsible **search**
  (the ⌕ button) finds across **every note in every group** by title + body and highlights matches,
  showing which group each hit lives in; a **sort** menu orders by Recent / Title A–Z / Created. The
  editor has two modes: **Rich** (book icon) is a formatted WYSIWYG editor with a markdown **toolbar** —
  bold/italic, headings (font size), lists, links, tables, images, code — and **Source** (code icon)
  edits the raw markdown with find/replace. Both are editable and share one autosaved body, so toggling
  never loses text; a note the rich editor can't parse falls back to Source automatically. Plus **Copy as
  Markdown**, a live **word count**, optional dictation, and a right-click menu (Copy / Duplicate / Move
  to group / Delete).
- **Board** — a server-backed kanban (To Do / In Progress / Done) you drag cards across. Because it's
  server-backed, agents in your terminals can read and move cards too (see API below).
- **TV / Media** — a **Media Center**-style media window (a locked dark/green palette with a GitHub-green
  accent, independent of your app theme) with three modes (title-bar tabs): **Live TV**,
  **Radio**, and **YouTube**. **Live TV** streams the full **iptv-org** catalog (thousands of free channels,
  joined + cached server-side for a day) — a left rail of facet filters (**category / country / language** with
  counts, plus a Favorites filter), a channel search, removable filter chips, a windowed channel rail (logo or
  colored monogram, flag, category · quality, a favorite star, and an animated equalizer on the playing row),
  and a video stage with LIVE + quality badges. Playback is **robust**: every stream flows through a server
  **HLS proxy** (`/api/tv/proxy`) that injects the channel's Referer/User-Agent and rewrites `.m3u8` children
  back through itself (bypassing CORS / forbidden-header limits), played with **hls.js** (native HLS on Safari)
  with automatic network/media recovery and **auto-advance** through a channel's own backup streams when one
  dies. The proxy also **validates manifests** (rejecting geo-block HTML error pages served at `.m3u8` URLs,
  which otherwise hang the player forever), **passes through upstream error codes** so a dead stream fails fast
  instead of spinning, and **streams continuous bodies untimed** so radio never gets cut off mid-play. **Radio**
  browses **radio-browser.info** (genre + country facets, search, top stations by popularity) with a now-playing
  card; icecast streams play straight off an `<audio>` element, `.m3u8` stations through the HLS proxy.
  **YouTube** is a **real IFrame-API player** driven by the app's own transport bar (not a bare embed): the box
  does double duty — **search** the **Data API v3** (your own key, stored server-side and never returned) or
  **paste a video / playlist link** (or bare id) to play it directly. A pasted or saved **playlist autoplays in
  order** (with **Load more** paging past the first 50), and **un-embeddable, removed, or private** videos are
  detected and **auto-skipped** (capped) with a "Watch on YouTube" fallback notice. A left **Library** rail
  toggles **Browse** vs **Saved**; every result has a **save star** (video → favorites) and a session
  **remove-from-list**, and a whole playlist can be **saved to favorites** — the Saved view lists **playlists**
  (click to reopen) and **videos** (click to play) separately. An **Autoplay** toggle (persisted) governs
  end-of-video advance. **Persistent deletions** (server-side, survive re-fetch + restart): the **X** on a
  playlist row removes that song from **that playlist** forever (search X stays session-only), a **⊘ ban**
  removes a video from **every** playlist and search, and both offer an **Undo** toast. A per-playlist
  collapsible **Removed (N)** trash strip restores individual songs, and a **Banned videos** manager in TV
  settings unbans them. A full-width **transport bar** (prev / play / next, draggable volume slider, mute, **subtitles** —
  toggle a caption track and pick its color, **audio-language** switch shown only when a stream carries more than
  one audio track and remembered for the next channel, PiP, fullscreen, now-playing) with hover **tooltips** on
  every control, and a thin **PM2-style status strip** (channel count, HLS quality, bitrate, buffer, volume) sit
  at the bottom; when a stream advertises a **now-playing programme title** (EXTINF / ID3) it appears under the
  video and in the strip. **Favorites** and **recents** persist server-side; volume, caption color, and preferred
  audio language persist per-browser. A title-bar **settings** popover holds the YouTube API key (with a
  show/hide **reveal** toggle), a **preferred audio language**, an NSFW toggle, and the **Banned videos** manager.
- **Timesheet** — a Harvest-style time tracker. Log work by **client → project → task → notes**; start
  and stop timers (several can run at once) or add past entries by hand. **Day / Week / Calendar** views
  with per-day, week, and month totals so you can go back and see how long you worked on any day. A
  **Settings tab** manages the client / project / task catalog (the dropdown sources) and the window's
  appearance (background, accent) and view defaults. Because it's server-backed, agents in your
  terminals can start/stop timers too (see API below) — naming a brand-new client/project/task
  auto-adds it to the catalog, so no setup is needed first.
- **Prompt builder** — two modes: a Quick Prompt wizard (idea → refine → paste-ready prompt) and a
  Blueprint Canvas, a node-graph where you map a program as connected boxes and compile it to a
  detailed implementation prompt. Blueprints are saved.
- **Secret** — mint one-time, encrypted burnable links (onetime / Yopass). The plaintext is sent to
  the Terminal Hub server, which symmetric-encrypts it with the host's `gpg` (spawned, arms-length —
  no crypto library in the web bundle) and uploads only ciphertext; the key rides in the URL
  fragment, so the onetime host never sees it. The result screen gives the one-click link, short
  link, decryption key, and a burn token to destroy it early. Requires `gpg` on the host and a
  Yopass-compatible instance set via `ONETIME_BASE`; unset = the feature is disabled.
- **Monitor** — a system monitor with a Processes tab (PID, CPU%, RAM%, RSS; sort, filter, kill) and
  a Ports tab (listening ports and the processes that own them).
- **Localhost** — a built-in *local* browser for the web apps you run on this host (`npm run dev`,
  `python -m http.server`, anything on a port). It is **not** a general web browser — it only ever
  targets host-local ports. Tabbed; auto-detects listening ports; and a Cmd/Ctrl-click on a
  `localhost:<port>` link an agent prints in a terminal opens it here. When you reach Terminal Hub
  remotely (a VPS IP over plain HTTP, or a Cloudflare tunnel), the host's `localhost` is unreachable
  from your browser, so Terminal Hub reverse-proxies it for you — **no domain, subdomain, certs, or
  Cloudflare config**. When you're on the same machine (`localhost`/`127.x`) it loads the dev server
  directly. Because the proxy makes a real same-origin URL, "open in your real browser" hands you a
  link you can paste into Chrome/Firefox for devtools. Caveats: live HMR doesn't tunnel through the
  proxy (the app loads and is interactive; refresh to see code changes), and a default Vite server
  needs `base: './'` to load its assets under the proxy.
- **Assistant** — an in-app AI assistant that knows the whole app and acts on it (notes, board,
  reminders, alerts, terminals, email, and scheduled background loops). Opens from this tile or the
  canvas orb. See the **Assistant** section below.
- **Help** — copy-paste integration blocks for `CLAUDE.md` / `AGENTS.md`, in Messaging, Task Board,
  and Secrets tabs, plus one-liners to test by hand.
- **Share** — add a teammate with a temporary, revocable access link instead of handing out your
  token. Generate a link (`?room=…&secret=…`) labelled for who it's for, optionally aimed at a
  specific room (it auto-opens on arrival), with a time limit (1h / 24h / 7d / 30d / never) — expired
  links delete themselves. Opening a link drops the teammate straight in with the secret pulled from
  the URL (and stripped from the address bar) — no token typing. **Presentation controls** (two toggles
  on the create form, both ON by default): **Mirror my view** makes the viewer's screen follow yours —
  the space you're on, the rooms you open (and when you close them), where you move or resize each room
  window, each room's fullscreen mode, **which terminal you pick inside it, which file you open in its
  editor, and the room's activity-bar view + panel layout** (the sidebar view you switch to, panels you
  collapse, and panel sizes), the TopBar panels you open
  (Notes, Board, Help, Files, Calendar, Timer, Breaks, Prompt, Secret, Settings) **— which track live on
  their screen as you drag or resize them**, plus the System Monitor and Localhost windows, all sync to
  them (and since terminals are
  tmux-backed, opening a room drops them onto your same live panes). The owner-only Share panel is never
  mirrored. **Cross-screen framing** — because a viewer's screen is usually a different size than yours
  (e.g. they're on a laptop, you're on a big display), their app renders at *your* viewport size, 1:1, so
  the layout is pixel-for-pixel like yours instead of windows landing off-screen or oversized. If your
  screen is bigger than theirs they get scrollbars to pan around it, or zoom out with their own browser
  zoom (crisper than a forced scale); once they've zoomed past your size the view centers and letterboxes
  on a black backdrop. On top of that the view is **server-snapshotted**, so when a viewer refreshes they
  immediately get whatever you currently have open — not a stale page from when they first connected.
  **Lock their input**
  makes them a passive spectator — their terminal typing + PTY resize are dropped on the **server** (the
  hard boundary, not bypassable), and a transparent capture overlay in their browser blocks clicking,
  dragging, and scrolling. Turn both off for plain free-roam shared access. **Admission:** using a link
  doesn't let them in yet; a center-screen **Accept / Decline** prompt pops on your screen first (Decline
  revokes the link). Once accepted they have full access, and because terminals are tmux-backed you're
  both driving the same live panes. The manager lists every link (copy again, revoke) and a live
  roster of who's connected with **Kick** (disconnect now) and **Revoke** (kill the link + close all
  their sockets instantly). Because a teammate off your network reaches you through your public address
  (not your LAN IP, which your home router blocks), the manager builds links from a **Public share
  URL** field — auto-filled when you're already on a public address, with a warning when you're on
  localhost/LAN. **Make a public link** there spins up a one-click free Cloudflare Quick Tunnel
  (`cloudflared tunnel --url …`, no account) and fills that field with the throwaway
  `https://….trycloudflare.com` URL so every link works from anywhere; **Stop** tears it down. Needs
  the `cloudflared` binary installed once. Owner-only (`GET/POST/DELETE /api/tunnel`). The tunnel is
  daemonized (launched via `sh` so it reparents to init) with its pid+URL persisted, so it **survives
  server restarts** — a tsx-watch reload or terminal Ctrl-C leaves the live tunnel up (the dev runner's
  tree-kill can't reach it) and the next boot re-adopts it, so the URL stays valid; it dies only when you
  press **Stop**. It's spawned with `--config /dev/null` so it ignores any stale `~/.cloudflared/config.yml`
  whose ingress catch-all would otherwise 404 every request. In dev, `*.trycloudflare.com` hosts are
  auto-allowed so the tunnel URL isn't 403'd by Vite. Or paste your own stable tunnel URL instead.
- **Live cursors** — when more than one person is connected (two owner browsers on localhost, or the
  owner + an admitted teammate), each sees the others' mouse as a labelled "phantom" cursor moving live
on the canvas, tinted a per-person colour. Cursors are shared in canvas (scroll-space) coordinates, so
  a ghost lands on the same card on every screen regardless of window size or scroll position, and only
  people viewing the same space see each other. Rides the existing `/ws/presence` socket (a server-side
  presence hub assigns each participant an id/name/colour and relays cursor frames to everyone else); a
  ghost vanishes the moment that person disconnects. Ghosts are drawn in a body-level, viewport-pinned
  portal ABOVE the floating windows/modals (so a presenter's cursor stays visible as it moves over an open
  panel instead of slipping behind it), mapped from canvas coords via the scroll container's own position.
- **Shared canvas (live workspace moves)** — moving a workspace card on the canvas tracks **both ways**,
  live: drag a card and it moves on every connected participant's screen at the same time (streamed over
  the same `/ws/presence` socket and applied straight to their canvas, so there's no refetch lag), with the
  final spot persisted to the DB. Works in both directions for anyone who can edit — an unlocked teammate
  moving a card is reflected back to the owner too; a **locked** viewer can't move anything (the server
  drops their card frames as well as their typing). This is separate from "Mirror my view" (which is the
  owner's one-way presentation): card positions are shared state, so they sync regardless of who moves them.

## Assistant (in-app AI assistant)

An always-available AI assistant that knows the whole app and can act on it. It lives as a **canvas
orb** (a floating blue spark) and a **launcher tile** in the top-bar Tools group; both open the same
floating, draggable, resizable **Assistant window** (grows from its opener, minimizes back into it). The
orb itself is **drag-to-move** — grab it and drop it anywhere so it never overlaps the canvas zoom/grid
controls; the spot is remembered per-browser. It's **edge-anchored**, so it tracks window resizes — drop
it on the right and it keeps its distance from the right edge (follows it as you resize), while left/middle
placements stay put — and it clamps back into view if the window shrinks past it (a clean tap still opens
the window). A master **enable/disable** plus the orb's on/off and its starting
corner live in **Settings → Assistant**. The window has three tabs: **Chat**, **Skills**, and **Schedules**.

- **Chat** — a conversational assistant that both **answers questions about Terminal Hub** (it carries
  a manifest of every feature drawn from this file, so "how do I share a room?" or "what's Stage
  Manager?" gets a real answer) **and takes actions** through a native **tool-use loop**: it streams a
  reply token-by-token, calls tools as needed, shows each call as an inline **chip** (name + result),
  and feeds the result back to itself until it's done. The brain is whichever **AI provider** you've
  configured — an **API engine** (Anthropic or any OpenAI-compatible endpoint) that streams with native
  tool-use, **or a CLI engine** (`claude`, `codex`, …) driven over a JSON text protocol: the Assistant
  describes its tools in the prompt and the CLI replies with a `{ reply, tool_calls }` envelope that the
  loop parses and executes, so a CLI gets full tool access too (one process per step → slower, and no
  live token streaming — the reply lands at once). An **engine picker** in the chat header chooses which
  provider answers — **Auto** follows your app default (preferring an API engine, falling back to any
  enabled CLI), or pick a specific configured provider for this conversation. Dangerous actions are
  **confirm-gated** — the Assistant asks before anything that types into a terminal, and you approve in
  the chat. A **typing wave** (three cresting dots) shows while it composes a reply. Chats **persist and
  are browsable**: a header bar gives **history** (each chat auto-titled from its first message — switch
  between past chats or delete any), **new chat**, and **clear** (delete the current one); the most recent
  chat resumes when you reopen the window.
- **What it can do (Core skill, always on)** — take and list **notes**; read, add, and move **board**
  cards; set and list **reminders**; fire an in-app **alert/notification**; report on your **spaces,
  workspaces, and terminals**; **send keystrokes to a terminal** (marked dangerous → always asks
  first); explain any **feature** or answer "how do I…"; and create/list/cancel **scheduled loops**
  (below). Disabling a skill removes its tools from the Assistant.
- **Skills** — assignable capabilities shown as cards you toggle on/off, each with a description and
  example phrasings. The built-in **Core** skill is always on; others (like Email) you enable when you
  want them. Account-managing skills surface their connected accounts right on the card.
- **Email skill** — "check my email" across providers: **Gmail, iCloud / Apple Mail, Outlook /
  Hotmail, Yahoo, or any generic IMAP** server. Add a mailbox on the skill card (label, provider,
  address, and an **app-specific password** — stored server-side, never returned to the browser, shown
  only as saved); then just ask in natural language ("any unread from my bank this week?") and the
  Assistant routes to the right mailbox and reports exactly what it found (`email_check` / `email_search`
  run real IMAP searches and parse the messages). Multiple mailboxes can be connected at once.
- **Tool servers (MCP)** — connect **Model Context Protocol** servers to give the Assistant extra tools
  (web search, browsers, APIs, your own servers). In the Skills tab, **import** the MCP servers already
  in your `~/.claude.json` in one click, or **add one by hand** — a local **stdio** command or a remote
  **http** URL, plus any **environment secrets** (write-only: sent to the server, only the key names
  ever come back to the browser). On connect the server's tools are discovered and cached; each server
  shows a live **status** dot, its tool list, and an enable/disable toggle, and can be refreshed, edited,
  or removed. Tools from **enabled** servers run **without a confirm prompt** (you opted them in here),
  so they can also drive scheduled loops.
- **Schedules (loops)** — put any safe tool on a **repeating background loop** that runs unattended and
  **reports back** — "check my email every 30 minutes and tell me when something new lands." Create one
  in the **Schedules** tab (pick the tool, an interval, and a report mode) or just ask in chat. **Report
  mode** decides when it pings you: **every run**, **only when the result changes**, or **only when it
  finds something**; reports arrive through your configured channels (toast + notification center,
  optional voice, optional **Pushover**). **Dangerous tools are never auto-run on a loop.** Loops are
  server-side and survive restarts (a job that came due while the server was down runs once on boot);
  the tab lists each loop with its next run and last result, and lets you pause or delete it.

## Widgets

A **Widgets** button in the top bar (between the notifications bell and Settings) opens a
**gallery** — a macOS-style grid where each tile is a *live* preview of the real widget. **Drag a
tile onto the canvas** and it drops where you release as a **draggable, resizable card** (or just
click a tile to place it). The card stays put and persists per space — like the sticky notes: drag
it by its title bar, resize from the corner, remove it with the ✕. Each space keeps its own set of
widgets, and a drop appears instantly (with a toast if the server ever rejects it). The gallery also
offers a **sticky note** tile — a canvas post-it (its own system) placed the same drag-or-click way.
Like a workspace card, a widget or sticky note is a **board citizen**: it pans and zooms with the canvas
and has no edge clamp, so it can live anywhere on the unbounded board — pan, or hit **Fit**, to bring a
stray one back into view. Each space's widgets/notes stay clipped to their own space and never bleed
into a neighbouring one.

Every widget shows a **gear** in its title bar. It opens a **pop-out settings window** that grows out
of the gear and minimizes back into it — a floating, draggable, resizable panel that sits *beside* the
card (never over it), so you watch every change land on the widget in real time. Click anywhere away
from it (the canvas, another window) and it closes itself. Inside, each color is a compact **swatch**
that pops the full picker out on click, and its lightness slider drags all the way down to a true
near-black. Every widget's settings include a **Background** color (on top of any widget-specific
options), so any card can be tinted or darkened. Settings persist per widget instance in the space and
sync across tabs.

- **Claude usage meter** — your current Anthropic rate-limit utilization, a faithful port of the
  TokenGauge app: two ring gauges (5-hour "session" + "this week") with the live % in the centre and a
  "resets in…" countdown under each, plus a forward-looking **Today** panel — a pace tag ("X% under /
  ahead of pace"), a progress bar against today's budget, "X% used today · Y% left", and a "~Z%/day
  budget" — over a real footer ("updated HH:MM · trending ~N% by week end"). Today's budget is what's
  left of the week ÷ days until it resets, so a light day stays calm even when the week is ahead; the
  daily baseline persists server-side so "used today" survives restarts. Rings/bar ramp green → amber →
  red by pressure. Reads the host's own Claude Code login (macOS Keychain or
  `~/.claude/.credentials.json`) and pulls the numbers from the rate-limit response headers of a
  1-token API ping (effectively free). If Claude Code isn't logged in the card greys out with a hover reason.
  The settings gear lets you **recolor the three usage tiers** (OK / Warning / Over) per instance, or
  reset to the brand colors.
- **Codex usage meter** — the OpenAI Codex twin of the Claude meter: the same TokenGauge gauge (rings +
  Today pace panel + footer) and pacing logic, but wearing OpenAI's brand — its health ramp leads with
  OpenAI green (a healthy meter glows green) through amber to red, and the tile icon is green. Spawns the
  official `codex app-server` and calls `account/rateLimits/read` over JSON-RPC, reusing your machine's
  ChatGPT login (`~/.codex/auth.json`, no API key) — `primary` becomes the 5-hour "session" ring and
  `secondary` the "this week" ring. If the Codex CLI isn't installed or signed in, the card greys out
  with a hover reason telling you how to fix it. The settings gear recolors the three usage tiers (OK /
  Warning / Over) per instance too, defaulting to the OpenAI-green ramp.
- **World clock** — analog + digital clocks for multiple cities (default Los Angeles / New York /
  Tokyo), DST-correct via the browser's native `Intl`. Add or remove cities from a picker in the
  card; the clocks always reflow responsively (resizing the card is the layout control — there's no
  vertical/horizontal toggle). The title-bar gear pops out the settings window (beside the card, so the
  clocks stay visible): pick an **accent color** (defaults to blue) and a **background color** (defaults
  to a near-black `#111110`; each is a swatch that pops the picker out — the background can go a true
  neutral, not just a tint), set the clock **size** (starts slightly zoomed in), and toggle
  **12/24-hour**. Settings are per widget instance and saved in the space (each placed clock keeps its
  own), so they survive refreshes and sync across tabs.
- **Agent activity** — how many agents are running across all workspaces (alive tmux terminals), how
  many workspaces are active, and how many are awaiting input (the attention bell), with a short list
  of which ones.
- **Headroom savings** — a live readout of how much the local [Headroom](https://github.com/chopratejas/headroom)
  compression proxy is saving, in the same dark "screen" family as the usage meters but wearing Headroom's
  teal. A hero pairs **tokens saved** (e.g. "3.5M") with the **dollars saved** and "% off" beside it; a
  teal compression bar shows the slice removed with a "before → after · X% smaller" caption; a 2×2 stat
  grid reports avg / best compression, requests compressed, and the separate prompt-cache savings. A
  pulsing **live** dot and "updated HH:MM · model" footer round it out. Numbers come from the proxy's
  `/stats` (polled every 30s). If the `headroom` CLI isn't installed, the proxy is down, or no traffic
  has flowed through it yet, the card greys out with a hover reason. The settings gear sets a per-instance
  **Background** color. (Pairs with the **Claude (Headroom)** launcher — same feature, same teal.)
- **Today** — today's calendar reminders, recurrences expanded, sorted by time with past items dimmed.
- **Sticky note** — a quick post-it on the canvas (its own jot-anywhere system, separate from the
  Notes scratchpad). Placed from the gallery like any tile, then type into it, recolor it (the color
  picker pops out of the note so the live color stays visible — and reaches a neutral near-black now,
  not just tints), pin it to float above an open room, and drag it anywhere. Persists per space and
  survives refreshes. (This is where the old standalone "Note" button moved to — there's no separate
  canvas button anymore.)

## Agent integration (APIs your terminals can call)

Everything long-lived is server-backed, so an agent running in a terminal can talk to the dashboard
over loopback (no token needed locally; `TERMINALHUB_TOKEN` Bearer when exposed).

- **Notifications / messaging** — `POST /api/notify` fires a toast on every open dashboard with the
  message, level, and the sending session. Each toast wears its severity at a glance — a colored left
  rail + matching icon pulled from the theme tokens: **success** (green check), **warn** (amber
  triangle), **error** (red octagon), **info** (blue i), and a plain agent **attention** alert (amber
  bell). Clicking the toast deep-links to that terminal (switching spaces and opening the room as
  needed) and can speak the message aloud; the ✕ dismisses without navigating. Every notification is
  also persisted (the notification center) and synced live across browsers — see **Notification center**.
- **Notification center** — the top-bar bell is a synced inbox/history. Notifications fire once on the
  server (an agent finishing in a terminal, an agent `/api/notify` message, or a fired reminder) and
  stream to every open browser, so the unread badge, list, and toasts stay consistent everywhere. A
  toast auto-dismisses after 10s; **ignore it and it lands in the center as history**, but **click or
  ✕ it and it's gone** (you handled it — it never clutters the center, and the dismissal syncs to your
  other browsers). Entries are color-coded and filterable by **agent** (amber), **error** (red), and
  **info** (blue); each has a ✕ to remove, agent/error entries click through to the terminal that
  fired them, and a **Clear all** empties the list. Opening (viewing) a terminal that was waiting on
  you clears its alert automatically. Per-browser history (lossy localStorage) is gone — the durable
  record lives server-side and survives a closed browser.
- **Links** — a top-bar globe icon opens a dropdown of your **important websites** (distinct from the
  star Favorites, which switches workspaces). Click one to open it in a **new browser tab**. Add sites
  one at a time with a **URL, title, and description**; each row shows the title with the description
  clamped to two lines (`…`), and hovering reveals the full URL + title + description. **Folders**
  (collapsible) group related sites; a **search box** filters across every folder by title/URL/
  description. **Drag links to reorder them and to drop them into (or out of) folders** — a blue line
  marks the insert point, and the "No folder" zone always accepts a drag so a link can be pulled out;
  up/down arrows and *Edit* still move links/folders too. Each folder shows a **link count**, an
  **Open all in new tabs** action, and remembers whether it's **expanded or collapsed** between opens
  (per browser, like a bookmark manager). **Right-click a folder name or a link to recolor its text**
  from a swatch-grid picker (hue grid + lightness slider, or the **A** cell to clear back to default) —
  a link's title (and its globe icon) takes the chosen color, its description renders a dimmed shade of
  the same color so the title always reads lighter, and a folder's name **and folder icon** take the
  color too. Recolors paint instantly (optimistic) and persist server-side with the entry.
  Rename or delete a folder (deleting keeps its links — they
  drop back to "No folder"). Everything is **persisted server-side** (its own `links`/`link_folders`
  tables), so the list survives restarts and follows you across browsers and over the tunnel —
  refetched per browser, like Notes.
- **Away alerts** — a finished agent only stays silent when you're *actually in* its terminal: that
  exact pane holds focus (the green focus bar) in this browser **and** the tab is on-screen and focused.
  Anything else counts as away and still alerts you — another room or terminal selected, another in-app
  space, another macOS Space, another app, a different browser tab, or background/minimize; even just
  clicking off the pane onto the canvas or a panel while the room stays open. You get the toast, an OS
  notification when the tab's hidden/unfocused (click it to jump straight to that terminal), and any
  voice alert — so you never miss a finish while away, exactly like when the room is closed. This works
  whether the room is open or closed: an open terminal's agent rings the bell, the browser catches it
  (tmux's bell flag is cleared by the live attach, so the server can't see it directly) and fires the
  same notification, deduped server-side across browsers. Coming back and focusing that terminal clears
  its alert just like viewing it does.
- **Agent-finish attention detection** — a backgrounded coding agent pings you when it **finishes**.
  The signal is the deliberate one an agent emits on completion: the terminal **bell** (`\a`) or an
  **OSC notify** escape code (`OSC 9` / `OSC 777` — many TUIs emit these, and the text rides into the
  toast). Detection is **bell-only** and **not user-controlled** (no mode toggle, no settings). A pane
  merely going **quiet** does *not* notify — silence flagged every idle session indiscriminately (an
  agent finished 10s ago looks identical to one idle for an hour), which flooded notifications, so it's
  excluded. Only the **built-in coding agents** (claude/codex/gemini/opencode/cursor-agent) earn
  attention — a plain shell, dev server, or a user-registered custom launcher (e.g. `npm run dev`,
  `codegraph`) ringing the bell never notifies. Closed rooms use tmux's bell flag; open rooms catch the
  bell + OSC codes (the live attach clears the tmux flag, so the browser fires it instead) — same
  notification either way, deduped server-side across browsers.
- **Task board API** — `GET /api/board`, `POST /api/board/cards`, `PATCH /api/board/cards/:id`
  (placement + edits in one call), `DELETE /api/board/cards/:id`. The floating board reflects changes
  within a couple of seconds.
- **Timesheet API** — an agent can clock a job in one curl; unknown client/project/task names are
  auto-added to the catalog, so no setup is needed first. Start, then stop:
  ```bash
  curl -sX POST localhost:8189/api/time/start -H 'content-type: application/json' \
    -d '{"client":"National Disability Alliance","project":"NDA Brain","task":"Programming","notes":"landing page"}'
  # → {"entry":{"id":"te_…", …}} — capture the id, then stop it:
  curl -sX POST localhost:8189/api/time/stop -H 'content-type: application/json' -d '{"id":"te_…"}'
  # stop fallbacks: {"client":"National Disability Alliance"} stops every running timer for that client;
  #                 {} stops the most recently started running timer.
  ```
  Also: `GET /api/time/entries?from=<ms>&to=<ms>` (defaults to today; always includes running),
  `POST /api/time/entries` (manual add with `startedAt`/`stoppedAt`), `PATCH`/`DELETE /api/time/entries/:id`,
  and catalog CRUD under `/api/time/clients`, `/api/time/projects` (`?clientId=`), `/api/time/tasks`.
  The floating Timesheet panel reflects changes within ~30s (or instantly on its own actions).
- **One-time secrets** — agents can mint and burn encrypted links via the onetime service; the Help
  modal ships the gpg + curl recipe.

## Voice & dictation

- **Dictation** — a mic button transcribes speech into the active terminal (or the selected note) via
  the browser Speech Recognition API or OpenAI Whisper.
- **Spoken notifications** — optionally speak agent messages aloud, with a voice picker grouped by
  language, rate/volume, and an optional beep before speaking.
- **STT provider** — choose local (browser) or OpenAI transcription; mic works in hold-to-record or
  toggle mode.
- **Mic shortcut** — a rebindable keyboard shortcut drives dictation in the focused terminal. Ships
  **unbound** (so it never collides with the browser's hard-refresh); set or clear it in Settings →
  Voice & Speech (click the field, type a combo; ⌫ clears it).

## Appearance

- **Themes** — a set of built-in editor/UI themes (Dracula, Nord, Tokyo Night, Catppuccin, Gruvbox,
  Monokai Pro, Solarized, GitHub Dark/Light, Night Owl, Ayu, Cobalt2, and the custom Terminal Hub themes).
- **Terminal appearance** — a dedicated **Settings → Appearance → Terminal** section to restyle every
  terminal: font family (curated monospace/Nerd Font list, Meslo kept in the fallback chain so
  powerline glyphs still render), font size, font weight, line height, letter spacing, pane padding,
  scrollback depth, and a code-ligatures toggle — plus the existing text-brightness and background-lift
  comfort sliders. Everything applies **live** to open terminals (xterm options + CSS vars, refit on
  geometry change) and is saved **per-device** (the terminal renders in your browser, where installed
  fonts differ per machine). Defaults reproduce the prior hardcoded look exactly.
- **Settings search** — a search box at the top of the Settings panel indexes every setting by name +
  synonyms; pick a result (mouse or ↑/↓ + Enter) to switch to its tab and scroll the control into view
  with a brief highlight. Built because the panel has grown large.
- **Sidebar position** — place the activity bar left, right, top, or bottom.
- **Focus bar color** — pick the color of the glowing bar under the terminal that's taking input;
  applies live and is saved server-side (so it follows you across browsers / the tunnel).
- **Status bar text color** — pick the text color of each terminal's bottom (tmux) status bar; applies
  to every open terminal at once and persists (saved server-side, re-asserted on each terminal open).
- **System stats bar** — a pinned strip showing live CPU / RAM / network; click to open the monitor.
  Toggle it per device under **Workbench → System stats** (off also stops its background 2s poll). The
  open-rooms **Active windows** taskbar on the same strip has its own toggle right beside it.
- **Toast position** — notifications anchor to any cell of a 3×3 grid.

## Remote access & security

- **Local-first** — binds to loopback by default; on `127.0.0.1`/`::1` there's no token and no
  friction.
- **Token-enforced when exposed** — a non-loopback bind, or a request carrying tunnel headers
  (`CF-Connecting-IP` / `X-Forwarded-For`), requires a valid `TERMINALHUB_TOKEN` (Bearer header, or
  `?token=` on the WebSocket).
- **Fail closed on boot** — binding to a non-loopback `HOST` without a token set is refused, so you
  can't expose an unauthenticated instance by accident.
- **`FS_ROOTS`** — an allowlist that restricts filesystem access to configured roots for exposed
  deployments.
- **Cloudflare tunnel ready** — designed to sit behind a Cloudflare tunnel + Access, with the token
  as the backstop.

## Persistence & durability

- **SQLite metadata** — workspaces, terminals, spaces, favorites, notes, sticky notes, board cards,
  bookmarks, skills, blueprints, wallpapers, custom agents, and settings all persist (`TERMINALHUB_DB`,
  default `data/terminalhub.db`).
- **Layout persistence** — card positions and per-workspace room layout (panel widths, open panels,
  active terminals) are stored server-side and restored on reopen.
- **Open rooms survive refresh** — which workspace rooms you have open, their stacking order, and
  window mode are remembered per-machine (localStorage) and reopened on reload, each rehydrating its
  saved DB layout. Per-machine on purpose: the rooms open on *this* browser don't force themselves
  open on your other devices.
- **Survives refresh** — because terminals live in tmux and state lives in SQLite, a browser refresh
  or reconnect reattaches to everything still running.

---

## Small touches & quality of life

The minor stuff — not headline features, but the polish that makes the rest feel good to use.

- **Windows grow from / minimize into their icon** — modals and tool windows animate out of the
  launcher tile (or opener) that spawned them and collapse back into it on close.
- **Geometry remembered** — every floating window's size and position is saved and restored.
- **Resizable, persistent panels** — drag to resize the sidebar, the terminal dock, and the Favorites
  dock; the widths/heights stick per workspace.
- **Drag-reorder with drop lines** — terminals, favorites, and board cards reorder by drag, with a
  drop indicator showing where the item will land.
- **Inline rename** — double-click to rename terminals, notes, favorites, and tree entries in place.
- **Right-click context menus** — cards, terminal tabs and panes, files, sessions, and the bare canvas
  all have context menus for their common actions.
- **Active-pane focus ring** — the focused terminal lights a subtle ring so you know where input goes.
- **Reveal / open on the host** — reveal a path in Finder/Explorer or open it in the default app.
- **Friendly long toasts** — long notifications get a "Show more"; toasts auto-dismiss after 10s; the
  dismiss ✕ only closes (and marks it handled), it never navigates.
- **Respects reduced motion** — with `prefers-reduced-motion` set, windows open and close instantly
  instead of animating.
- **Click-safe dragging** — cards use an 8px drag threshold so a plain click still hits the buttons
  on the card.

---

## Planned (designed, not yet built)

Approved features that **do not ship yet** — kept here so the roadmap sits next to the feature list.
Full implementation plans (data model, file map, decisions, open questions) live under
[`../_todo/`](../_todo).

### Space setup wizard

- **Per-space setup wizard** — creating a new virtual space opens a multi-step wizard to pick
  project (non-global) **skills** and pre-set **custom commands** — selectable cards, each with a
  short description and a `?` that expands the full explanation — and to author a `CLAUDE.md` /
  `AGENTS.md` content block (pin or append).
- **Auto-seed on workspace create/open** — every workspace in that space gets the chosen skills
  installed into its `.claude/skills/`, the commands into `.claude/commands/`, and the content
  written into `AGENTS.md` (canonical) with `CLAUDE.md` generated from it — created when the folder
  is empty, otherwise inserted inside a managed, idempotent block that never overwrites hand-written
  text. (Re-applying to a running room takes effect on next relaunch.)
- Full plan: [`../_todo/space-creation-wizard/`](../_todo/space-creation-wizard/plans.md).

<!-- Calendar, reminders & Pushover graduated from "planned" to shipped — they're documented under
     the Notification center / Today widget / Calendar panel above, and the Assistant can drive reminders
     and Pushover-backed scheduled loops. -->

### Calendar, reminders & Pushover — ✅ shipped

- **Calendar & reminders**, **scheduled delivery** (with "(missed)" catch-up on boot), **Pushover
  setup**, and the **Notification center** are all built — see the Notification center and Today widget
  sections above. The Assistant's reminders and scheduled loops also report through these channels.
