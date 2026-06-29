import { createContext, useContext } from "react";
import { createStore, useStore } from "zustand";
import type { OpenFile, LeftTab, SidebarView, ScmTab, WinRect, RoomViewState } from "./ui";
import { defaultWindowRect } from "./ui";
import type { AiTool } from "../lib/autoTitle";
import { isImageFile, isPdfFile, isVideoFile, isAudioFile } from "../lib/fileKinds";

/** Markdown / CSV / Word files open straight into their rich reader/editor, not the code editor. */
const isMarkdownFile = (name: string) => /\.(md|markdown|mdx)$/i.test(name);
const isCsvFile = (name: string) => /\.(csv|tsv)$/i.test(name);
const isDocxFile = (name: string) => /\.docx$/i.test(name);

/** The rich-editor tab kind a filename auto-opens into, or null for the plain code editor. */
function richKindFor(name: string): OpenFile["kind"] | null {
  if (isMarkdownFile(name)) return "markdown-preview";
  if (isCsvFile(name)) return "csv-preview";
  if (isDocxFile(name)) return "docx-preview";
  if (isImageFile(name)) return "image-preview";
  if (isPdfFile(name)) return "pdf-preview";
  if (isVideoFile(name)) return "video-preview";
  if (isAudioFile(name)) return "audio-preview";
  return null;
}

/** Flip an open tab's editor kind in place (keyed by file path), or open a fresh tab of that kind,
 *  and focus it. kind:"file" clears the rich sourcePath; rich kinds point it at the file path. */
function reKindTab(s: RoomState, f: { path: string; name: string }, kind: OpenFile["kind"]) {
  const entry: OpenFile = { path: f.path, name: f.name, kind, sourcePath: kind === "file" ? undefined : f.path };
  const has = s.openFiles.some(o => o.path === f.path);
  return {
    openFiles: has
      ? s.openFiles.map(o => (o.path === f.path ? { ...o, ...entry } : o))
      : [...s.openFiles, entry],
    activeFile: f.path,
  };
}

/** A row the explorer context menu is acting on. */
export type ExplorerTarget = { path: string; name: string; type: "dir" | "file" };
/** Open right-click menu in the explorer (viewport coords + its target row). */
export type ExplorerMenu = { x: number; y: number; target: ExplorerTarget };
/** Inline editing in the tree: renaming a row, or naming a new file/folder under `target` (a dir). */
export type ExplorerEdit = { mode: "rename" | "new-file" | "new-folder"; target: string };
/** A request to scroll an editor tab to a line (+ optional column) and flash it — bookmark
 *  navigation, panel click, or a go-to-definition jump. `col` is a 0-based character offset. */
export type PendingJump = { path: string; line: number; col?: number };
/** One entry in the editor's jump history — the locations Back/Forward traverse. Built from
 *  go-to-definition round-trips and line jumps (VS Code-style navigation stack). */
export type NavLoc = { path: string; name: string; line: number; col: number };
/** Bookmark browser layout: grouped-by-file tree, or one flat path-sorted list. */
export type BookmarkView = "tree" | "list";

/** Find-in-files (Explorer Search tab) input state. Ephemeral — kept in the room store so it survives
 *  switching the left tab away and back, but not persisted in the room layout. */
export interface SearchUiState {
  query: string;
  replace: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
  include: string;
  exclude: string;
  excludeBuild: boolean;  // skip build/dependency folders (node_modules, dist, .next, …). Default on.
  excludeSystem: boolean; // skip system folders (.git, .vscode, .idea, …). Default on.
  showReplace: boolean; // replace row expanded
  showFilters: boolean; // files-to-include/exclude expanded
}
const EMPTY_SEARCH: SearchUiState = {
  query: "", replace: "", caseSensitive: false, wholeWord: false, regexp: false,
  include: "", exclude: "", excludeBuild: true, excludeSystem: true, showReplace: false, showFilters: false,
};

/**
 * The slice of room state persisted per workspace (DB-backed via workspaces.layout, so it
 * follows you across machines). Every field is optional: an older or partial blob still
 * hydrates, with any missing field falling back to its default below.
 */
export interface RoomLayout {
  sidebarWidth?: number;       // explorer/side-panel width (px)
  terminalListWidth?: number;  // terminal-list panel width (px)
  dockHeight?: number;         // terminal dock height (px)
  leftOpen?: boolean;          // sidebar shown vs collapsed
  rightOpen?: boolean;         // terminal-list shown vs hidden
  activeView?: SidebarView;    // which activity-bar view the sidebar shows
  activeTerminalId?: string | null; // terminal selected when the room was last open
  windowed?: boolean;          // last window mode: floating window (true) vs maximized (false)
  windowRect?: WinRect | null; // last floating-window geometry, restored on reopen
  windowMoved?: boolean;       // user has dragged/resized/maximized it — restore exact geometry+mode (else re-anchor to its card)
  openFiles?: OpenFile[];      // editor tabs open when the room was last closed, restored on reopen
  activeFile?: string;         // which of those tabs was focused ("" = none)
}

export const DEFAULT_SIDEBAR_WIDTH = 240;
export const DEFAULT_TERMINAL_LIST_WIDTH = 224;
export const DEFAULT_DOCK_HEIGHT = 300;

/** Parse a workspace's stored layout blob; null on absent/corrupt JSON, so callers use defaults. */
export function parseRoomLayout(raw: string | null | undefined): RoomLayout | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as RoomLayout) : null;
  } catch { return null; }
}

/**
 * Per-room IDE state. Every open workspace gets its own instance of this store so two
 * rooms can hold independent editor tabs, terminals, sidebar view, and window geometry.
 * The store is provided through RoomContext by <Room>; components read it via useRoom().
 * App-wide concerns (which rooms are open, z-order, the sidebar-position preference) stay
 * in the global ui store — see store/ui.ts.
 */
export interface RoomState {
  workspaceId: string;
  activeTerminalId: string | null;
  // Most-recently-active terminal ids, newest first (deduped, capped). Used when the active terminal
  // is closed: we fall back to the last terminal you were actually on (skipping ids that no longer
  // exist), not just the first in the list. Ephemeral — not persisted in the room layout.
  terminalHistory: string[];
  // The active terminal's input sender, registered by the mounted TerminalView. Only one
  // terminal is mounted at a time, so this always points at the focused terminal (or null).
  // The mic button reads this to inject transcribed speech.
  terminalSender: ((text: string) => void) | null;
  // Auto-title: after an AI CLI (claude/codex) is launched in a still-unnamed terminal — typed by
  // the user OR auto-launched at creation — we wait for the first prompt to it, then name the tab
  // "<Tool> - <prompt>". Keyed by terminal id and kept here (not in the socket hook) so the waiting
  // state survives the TerminalView remount that happens on every tab switch. Absent key = untouched
  // (eligible to seed from the launch command); null = cleared after naming; tool = waiting.
  aiAwait: Record<string, AiTool | null>;
  windowed: boolean;                     // floating window (false = maximized/fullscreen)
  windowRect: WinRect | null;            // floating geometry, persisted in the room layout
  windowMoved: boolean;                  // user positioned the window (drag/resize/maximize) → restore exact geometry on reopen

  openFiles: OpenFile[];                 // files open as editor tabs
  activeFile: string;                    // active editor tab ("" = none)
  documentContents: Record<string, string>; // live editor buffers by file path (saved or dirty)
  activeView: SidebarView;               // which activity-bar view the sidebar shows
  scmTab: ScmTab;                        // active tab inside the Source Control panel
  leftTab: LeftTab;
  leftOpen: boolean;                     // sidebar visible
  rightOpen: boolean;
  expandedDirs: Set<string>;             // explorer dirs currently expanded
  collapsedRoots: Set<string>;           // explorer root folders the user collapsed (default = expanded)
  revealTarget: string | null;           // abs path the explorer should scroll to + flash, then clear
  selectedPath: string | null;           // primary explorer selection: F2/copy/paste target + shift-range pivot
  selectedPaths: Set<string>;            // full multi-selection (ctrl/shift click); always contains selectedPath
  selectionAnchor: string | null;        // pivot row for the next shift-range selection
  explorerMenu: ExplorerMenu | null;     // open explorer right-click menu (null = closed)
  explorerEdit: ExplorerEdit | null;     // active inline rename / new-file / new-folder, if any
  dirtyFiles: Set<string>;               // open files with unsaved edits
  pinnedFiles: Set<string>;              // pinned editor tabs — sort to the front, kept on bulk-close
  agentPickerOpen: boolean;              // "new terminal" agent picker modal
  pendingJump: PendingJump | null;       // editor should scroll to this line, then clear it
  // Editor jump history (Back/Forward in the tab bar). `navStack` is the ordered list of visited
  // locations; `navIndex` is the current position in it (-1 = empty). Ephemeral — not persisted.
  navStack: NavLoc[];
  navIndex: number;
  bookmarkView: BookmarkView;            // bookmark browser layout (tree / flat list)
  search: SearchUiState;                 // Explorer Search-tab inputs (ephemeral, per room)
  // Resizable-panel geometry. Hydrated from the workspace's persisted layout on open and saved
  // back on change (see usePersistRoomLayout), so panel sizes survive close/reopen across machines.
  sidebarWidth: number;
  terminalListWidth: number;
  dockHeight: number;

  setActiveTerminal(id: string | null): void;
  setTerminalSender(fn: ((text: string) => void) | null): void;
  setAiAwait(terminalId: string, tool: AiTool | null): void;
  toggleWindowed(): void;                // fullscreen <-> floating window
  setWindowRect(rect: WinRect): void;
  setEditorMirror(openFiles: OpenFile[], activeFile: string): void; // viewer: adopt the host's exact open tabs + active tab
  setViewMirror(v: RoomViewState): void; // viewer: adopt the host's sidebar/panel chrome (active view, panels, sizes)

  openFile(f: OpenFile, opts?: { recordNav?: boolean }): void; // recordNav:false skips the history stop (go-to-def opens the tab then records via jumpToPosition)
  openMarkdownPreview(f: { path: string; name: string }): void;
  openCsvPreview(f: { path: string; name: string }): void;   // (re)open a file in the CSV grid editor
  openDocxPreview(f: { path: string; name: string }): void;  // (re)open a file in the Word rich editor
  openHtmlPreview(f: { path: string; name: string }): void;  // (re)open an HTML file in the rendered preview / builder view
  openAsCode(f: { path: string; name: string }): void;       // switch a rich-editor tab to the raw code editor
  openDiff(d: { file: string; name: string; root: string; staged?: boolean; untracked?: boolean }): void;
  openCommitDiff(d: { hash: string; name: string; root: string }): void;
  openCommitFileDiff(d: { hash: string; file: string; name: string; root: string }): void;
  openStashDiff(d: { ref: string; name: string; root: string }): void;
  closeFile(path: string): void;
  closeMany(paths: string[]): void;      // close a set of tabs at once (Close Others/Left/Right/All)
  togglePin(path: string): void;         // pin/unpin a tab
  setActiveFile(path: string): void;
  selectView(view: SidebarView): void;   // click an activity-bar icon (toggles closed if already active)
  setScmTab(tab: ScmTab): void;
  setLeftTab(tab: LeftTab): void;
  toggleLeft(): void;
  toggleRight(): void;
  toggleDir(path: string): void;
  toggleRoot(path: string): void;        // collapse/expand the workspace root node in the explorer
  collapseAllDirs(): void;               // reset: close every expanded folder (only the root remains)
  expandDirs(paths: string[]): void;     // expand a batch of dirs at once (Expand All over loaded folders)
  revealInExplorer(absPath: string): void; // switch to Explorer, expand to the file, scroll it into view
  clearRevealTarget(): void;
  selectExplorer(path: string | null): void;        // single-select (or clear) — resets the multi-selection
  addSelect(path: string): void;                     // ctrl/cmd-click: toggle one path in/out of the selection
  selectRange(paths: string[], primary: string): void; // shift-click: replace the selection with a range
  openExplorerMenu(menu: ExplorerMenu): void;
  closeExplorerMenu(): void;
  startExplorerEdit(edit: ExplorerEdit): void;
  cancelExplorerEdit(): void;
  setDirty(path: string, dirty: boolean): void;
  setDocumentContent(path: string, content: string): void;
  openAgentPicker(): void;
  closeAgentPicker(): void;
  jumpToLine(file: { path: string; name: string }, line: number): void; // open the tab + scroll to a line
  jumpToPosition(file: { path: string; name: string }, line: number, col?: number): void; // open the tab + scroll to line:col (go-to-def)
  clearPendingJump(): void;
  recordJump(path: string, name: string, line: number, col: number): void;   // push a new history stop (go-to-def FROM-spot, or a big in-file caret jump)
  settleCursor(path: string, name: string, line: number, col: number): void; // keep the current stop's caret synced (typing / small caret moves), no new stop
  navBack(): void;               // Back: revisit the previous location in the jump history
  navForward(): void;            // Forward: revisit the next location in the jump history
  setBookmarkView(view: BookmarkView): void;
  setSearch(patch: Partial<SearchUiState>): void; // merge into the Search-tab input state
  setSidebarWidth(px: number): void;
  setTerminalListWidth(px: number): void;
  setDockHeight(px: number): void;
}

const NAV_MAX = 50; // cap the jump history so it can't grow without bound
const TERMINAL_HISTORY_MAX = 20; // cap the active-terminal recency stack

/** Push `loc` onto the jump history: truncate any forward entries, append, and cap the length. If the
 *  current entry is the same file+line, update it in place (keeps the latest column, no new entry). */
function pushNav(s: RoomState, loc: NavLoc): Pick<RoomState, "navStack" | "navIndex"> {
  const cur = s.navIndex >= 0 ? s.navStack[s.navIndex] : null;
  if (cur && cur.path === loc.path && cur.line === loc.line) {
    const navStack = s.navStack.slice();
    navStack[s.navIndex] = loc;
    return { navStack, navIndex: s.navIndex };
  }
  const base = s.navStack.slice(0, s.navIndex + 1);
  base.push(loc);
  const navStack = base.length > NAV_MAX ? base.slice(base.length - NAV_MAX) : base;
  return { navStack, navIndex: navStack.length - 1 };
}

/** Record that `path` became the active file (a tab click / open / jump target): push a file-level
 *  history stop, refined to the real caret line later by the editor (settleCursor). No-op if we're
 *  already on that file, or it's a synthetic tab (a diff) that can't be faithfully revisited. */
function navTab(s: RoomState, path: string, name: string): Pick<RoomState, "navStack" | "navIndex"> | object {
  if (path.startsWith("∆")) return {}; // diff / synthetic tab — not a real file location
  const cur = s.navIndex >= 0 ? s.navStack[s.navIndex] : null;
  if (cur && cur.path === path) return {}; // already the current location
  return pushNav(s, { path, name, line: 1, col: 0 });
}

/** Apply a Back/Forward step: focus `loc` (re-opening its tab — faithfully, as its rich/preview kind —
 *  if it was closed) and ask the editor to scroll there, WITHOUT recording a new history entry. */
function applyNav(s: RoomState, navIndex: number): Partial<RoomState> {
  const loc = s.navStack[navIndex];
  const rk = richKindFor(loc.name);
  const reopened: OpenFile = rk ? { path: loc.path, name: loc.name, kind: rk, sourcePath: loc.path } : { path: loc.path, name: loc.name };
  return {
    navIndex,
    openFiles: s.openFiles.some(o => o.path === loc.path) ? s.openFiles : [...s.openFiles, reopened],
    activeFile: loc.path,
    pendingJump: { path: loc.path, line: loc.line, col: loc.col },
  };
}

export function createRoomStore(init: { workspaceId: string; windowed: boolean; windowRect: WinRect | null; layout?: RoomLayout | null }) {
  const L = init.layout ?? null;
  // Window mode/geometry on open. Once you've dragged, resized, or maximized the room (windowMoved),
  // restore its exact saved mode + geometry — "reopen where I left it." Until then the room has no
  // user-chosen spot, so it takes the caller's first-open default (a window anchored at the card it
  // opened from) and re-anchors to that card every open. savedWindowed needs a rect, so we never end
  // up "windowed" with nothing to size to.
  const saved = L?.windowRect ?? null;
  const touched = !!L?.windowMoved;
  const windowed = touched ? (!!L?.windowed && !!saved) : init.windowed;
  const windowRect = (touched ? saved : null) ?? init.windowRect;
  // Seed the (ephemeral) jump history with the restored active tab, so Back can return to where you
  // were when the room reopens — not just to wherever your first click lands.
  const seedActive = L?.activeFile ?? "";
  const seedName = (L?.openFiles ?? []).find(o => o.path === seedActive)?.name;
  const navSeed = seedActive && seedName && !seedActive.startsWith("∆")
    ? { navStack: [{ path: seedActive, name: seedName, line: 1, col: 0 }], navIndex: 0 }
    : { navStack: [] as NavLoc[], navIndex: -1 };
  return createStore<RoomState>((set, get) => ({
    workspaceId: init.workspaceId,
    // Restore the last-selected terminal; Room's keep-active effect drops it back to the first
    // terminal only if this id no longer exists (terminal closed while the room was away).
    activeTerminalId: L?.activeTerminalId ?? null,
    // Seed the recency stack with the restored selection so closing it right after reopening a room
    // still has a sensible fallback.
    terminalHistory: L?.activeTerminalId ? [L.activeTerminalId] : [],
    terminalSender: null,
    aiAwait: {},
    windowed,
    windowRect,
    windowMoved: touched,
    // Restore the editor tabs + the focused one from the last session (re-mount re-reads each file
    // from disk). Saved buffers come back with content; unsaved edits aren't persisted.
    openFiles: L?.openFiles ?? [],
    activeFile: L?.activeFile ?? "",
    documentContents: {},
    activeView: L?.activeView ?? "explorer",
    scmTab: "graph",
    leftTab: "explorer",
    leftOpen: L?.leftOpen ?? true,
    rightOpen: L?.rightOpen ?? true,
    sidebarWidth: L?.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH,
    terminalListWidth: L?.terminalListWidth ?? DEFAULT_TERMINAL_LIST_WIDTH,
    dockHeight: L?.dockHeight ?? DEFAULT_DOCK_HEIGHT,
    expandedDirs: new Set<string>(),
    collapsedRoots: new Set<string>(),
    revealTarget: null,
    selectedPath: null,
    selectedPaths: new Set<string>(),
    selectionAnchor: null,
    explorerMenu: null,
    explorerEdit: null,
    dirtyFiles: new Set<string>(),
    pinnedFiles: new Set<string>(),
    agentPickerOpen: false,
    pendingJump: null,
    navStack: navSeed.navStack,
    navIndex: navSeed.navIndex,
    bookmarkView: "tree",
    search: EMPTY_SEARCH,

    setActiveTerminal: (id) => set((s) => {
      if (!id) return { activeTerminalId: null };
      // Push to the front of the recency stack (deduped, capped) so a later close can fall back here.
      return { activeTerminalId: id, terminalHistory: [id, ...s.terminalHistory.filter(x => x !== id)].slice(0, TERMINAL_HISTORY_MAX) };
    }),
    setTerminalSender: (terminalSender) => set({ terminalSender }),
    setAiAwait: (terminalId, tool) => set((s) => ({ aiAwait: { ...s.aiAwait, [terminalId]: tool } })),
    // Maximizing / restoring is a deliberate window-mode choice → mark it positioned so the room
    // reopens in that mode instead of re-anchoring to its card.
    toggleWindowed: () => set((s) => {
      if (s.windowed) return { windowed: false, windowMoved: true };  // -> maximize (fullscreen)
      // -> restore to a floating window; default to a centered box (kept below the top bars) if none remembered
      const rect = s.windowRect ?? defaultWindowRect();
      return { windowed: true, windowRect: rect, windowMoved: true };
    }),
    // A drag/resize is the user picking a spot → remember the exact geometry on every later open.
    setWindowRect: (windowRect) => set({ windowRect, windowMoved: true }),
    // Presentation mirroring (viewer side): adopt the host's exact tab set + active tab. Replaces both
    // wholesale so the viewer's editor shows precisely what the host has open. documentContents is keyed
    // by path and untouched — each editor (re)loads content for the tabs it now shows.
    setEditorMirror: (openFiles, activeFile) => set({ openFiles, activeFile }),
    // Presentation mirroring (viewer side): adopt the host's sidebar/panel chrome (which activity-bar view
    // is open, the SCM sub-tab, panel open/collapsed state, and panel sizes) so the viewer's frame matches.
    setViewMirror: (v) => set(v),

    openFile: (f, opts) => set((s) => {
      // Markdown / CSV / Word / image / PDF / video open directly in their rich reader/viewer by
      // default (see richKindFor); a caller that wants the raw code editor passes kind:"file"
      // explicitly. Other kinds (diff) pass through as-is.
      const richKind = f.kind === undefined ? richKindFor(f.name) : null;
      const entry: OpenFile = richKind ? { ...f, kind: richKind, sourcePath: f.path } : f;
      return {
        openFiles: s.openFiles.some(o => o.path === entry.path) ? s.openFiles : [...s.openFiles, entry],
        activeFile: entry.path,
        // go-to-definition opens the target tab itself then records the destination via jumpToPosition,
        // so it passes recordNav:false here to avoid a duplicate file-level stop.
        ...(opts?.recordNav === false ? {} : navTab(s, entry.path, entry.name)),
      };
    }),
    openMarkdownPreview: (f) => set((s) => {
      const oldSyntheticKey = `md-preview:${f.path}`;
      const entry: OpenFile = { path: f.path, name: f.name, kind: "markdown-preview", sourcePath: f.path };
      const hasSourceTab = s.openFiles.some(o => o.path === f.path);
      return {
        openFiles: hasSourceTab
          ? s.openFiles
            .filter(o => o.path !== oldSyntheticKey)
            .map(o => o.path === f.path ? { ...o, ...entry } : o)
          : [...s.openFiles.filter(o => o.path !== oldSyntheticKey), entry],
        activeFile: f.path,
        ...navTab(s, f.path, f.name),
      };
    }),
    // CSV / Word / "edit as code" all just flip an existing tab's kind in place (the tab key is the
    // real file path for these), or open a fresh tab of that kind. One tab per file path.
    openCsvPreview: (f) => set((s) => ({ ...reKindTab(s, f, "csv-preview"), ...navTab(s, f.path, f.name) })),
    openDocxPreview: (f) => set((s) => ({ ...reKindTab(s, f, "docx-preview"), ...navTab(s, f.path, f.name) })),
    openHtmlPreview: (f) => set((s) => ({ ...reKindTab(s, f, "html-preview"), ...navTab(s, f.path, f.name) })),
    openAsCode: (f) => set((s) => ({ ...reKindTab(s, f, "file"), ...navTab(s, f.path, f.name) })),
    // Diff tabs get a synthetic key so they coexist with a normal editor tab for the
    // same file (and staged vs worktree diffs are distinct tabs).
    openDiff: (d) => set((s) => {
      const key = `∆${d.staged ? "S" : d.untracked ? "U" : "W"}:${d.file}`;
      const entry: OpenFile = {
        path: key, name: d.name, kind: "diff", root: d.root,
        diff: { file: d.file, staged: d.staged, untracked: d.untracked },
      };
      return {
        openFiles: s.openFiles.some(o => o.path === key) ? s.openFiles : [...s.openFiles, entry],
        activeFile: key,
      };
    }),
    // A whole-commit diff tab, keyed by hash so each commit gets one reusable tab.
    openCommitDiff: (d) => set((s) => {
      const key = `∆C:${d.hash}`;
      const entry: OpenFile = { path: key, name: d.name, kind: "diff", root: d.root, diff: { commit: d.hash } };
      return {
        openFiles: s.openFiles.some(o => o.path === key) ? s.openFiles : [...s.openFiles, entry],
        activeFile: key,
      };
    }),
    // One file of a commit — a single side-by-side diff (parent's version vs the commit's),
    // keyed by hash+file so each file of an expanded commit gets its own reusable tab.
    openCommitFileDiff: (d) => set((s) => {
      const key = `∆CF:${d.hash}:${d.file}`;
      const entry: OpenFile = { path: key, name: d.name, kind: "diff", root: d.root, diff: { commit: d.hash, file: d.file } };
      return {
        openFiles: s.openFiles.some(o => o.path === key) ? s.openFiles : [...s.openFiles, entry],
        activeFile: key,
      };
    }),
    // A stash diff tab (the stash's changes vs the commit it was made from), keyed by ref.
    openStashDiff: (d) => set((s) => {
      const key = `∆T:${d.ref}`;
      const entry: OpenFile = { path: key, name: d.name, kind: "diff", root: d.root, diff: { stash: d.ref } };
      return {
        openFiles: s.openFiles.some(o => o.path === key) ? s.openFiles : [...s.openFiles, entry],
        activeFile: key,
      };
    }),
    closeFile: (path) => get().closeMany([path]),
    closeMany: (paths) => set((s) => {
      const kill = new Set(paths);
      const openFiles = s.openFiles.filter(o => !kill.has(o.path));
      // If the active tab got closed, fall back to the last remaining tab.
      const activeFile = kill.has(s.activeFile)
        ? (openFiles[openFiles.length - 1]?.path ?? "")
        : s.activeFile;
      const dirtyFiles = new Set(s.dirtyFiles); kill.forEach(p => dirtyFiles.delete(p));
      const pinnedFiles = new Set(s.pinnedFiles); kill.forEach(p => pinnedFiles.delete(p));
      return { openFiles, activeFile, dirtyFiles, pinnedFiles };
    }),
    togglePin: (path) => set((s) => {
      const pinnedFiles = new Set(s.pinnedFiles);
      pinnedFiles.has(path) ? pinnedFiles.delete(path) : pinnedFiles.add(path);
      return { pinnedFiles };
    }),
    setActiveFile: (path) => set((s) => ({ activeFile: path, ...navTab(s, path, s.openFiles.find(o => o.path === path)?.name ?? path) })),
    // Clicking the already-active view collapses the sidebar (VS Code behaviour); any
    // other click opens the sidebar and switches to it.
    selectView: (view) => set((s) => (view === s.activeView && s.leftOpen ? { leftOpen: false } : { activeView: view, leftOpen: true })),
    setScmTab: (scmTab) => set({ scmTab }),
    setLeftTab: (leftTab) => set({ leftTab }),
    toggleLeft: () => set((s) => ({ leftOpen: !s.leftOpen })),
    toggleRight: () => set((s) => ({ rightOpen: !s.rightOpen })),
    toggleDir: (path) => set((s) => {
      const next = new Set(s.expandedDirs);
      next.has(path) ? next.delete(path) : next.add(path);
      return { expandedDirs: next };
    }),
    toggleRoot: (path) => set((s) => {
      const next = new Set(s.collapsedRoots);
      next.has(path) ? next.delete(path) : next.add(path);
      return { collapsedRoots: next };
    }),
    // Collapse All is a reset: drop every expanded dir so only the root's children show; the
    // user re-opens folders from scratch (handy when too many are left open).
    collapseAllDirs: () => set({ expandedDirs: new Set<string>() }),
    expandDirs: (paths) => set((s) => {
      if (paths.every(p => s.expandedDirs.has(p))) return s;
      const next = new Set(s.expandedDirs);
      paths.forEach(p => next.add(p));
      return { expandedDirs: next };
    }),
    // Open the Explorer and expand every ancestor folder of the file so its row mounts; the
    // FileRow whose path === revealTarget scrolls itself into view and flashes, then clears it.
    revealInExplorer: (absPath) => set((s) => {
      const parts = absPath.split("/");
      const expandedDirs = new Set(s.expandedDirs);
      for (let i = 1; i < parts.length - 1; i++) {
        const ancestor = parts.slice(0, i + 1).join("/");
        if (ancestor) expandedDirs.add(ancestor);
      }
      // Un-collapse the root too — revealing a file must surface it even if the tree was minimized.
      // Switch the left tab back to the Explorer (reveal can fire from the Filter/Search tabs) and
      // select the row, so it lands highlighted in the tree, not just flashed.
      return { activeView: "explorer", leftTab: "explorer", leftOpen: true, expandedDirs, collapsedRoots: new Set<string>(),
        revealTarget: absPath, selectedPath: absPath, selectedPaths: new Set([absPath]), selectionAnchor: absPath };
    }),
    clearRevealTarget: () => set({ revealTarget: null }),
    selectExplorer: (path) => set({ selectedPath: path, selectedPaths: path ? new Set([path]) : new Set<string>(), selectionAnchor: path }),
    // Ctrl/Cmd-click toggles a single row; the clicked row becomes the primary + the next range pivot.
    addSelect: (path) => set((s) => {
      const next = new Set(s.selectedPaths);
      next.has(path) ? next.delete(path) : next.add(path);
      return { selectedPaths: next, selectedPath: path, selectionAnchor: path };
    }),
    // Shift-click replaces the selection with a contiguous range; the anchor (pivot) stays put so
    // you can re-shift-click to grow/shrink from the same origin, like every file explorer.
    selectRange: (paths, primary) => set({ selectedPaths: new Set(paths), selectedPath: primary }),
    // Right-clicking a row already in the multi-selection keeps it (so the menu can target all);
    // right-clicking elsewhere collapses the selection to just that row.
    openExplorerMenu: (explorerMenu) => set((s) => {
      const p = explorerMenu.target.path;
      return s.selectedPaths.has(p)
        ? { explorerMenu }
        : { explorerMenu, selectedPath: p, selectedPaths: new Set([p]), selectionAnchor: p };
    }),
    closeExplorerMenu: () => set({ explorerMenu: null }),
    // Starting an edit auto-expands the container so the inline input is visible; renaming a row
    // keeps the tree as-is.
    startExplorerEdit: (edit) => set((s) => {
      if (edit.mode === "rename") return { explorerEdit: edit, explorerMenu: null };
      const expandedDirs = new Set(s.expandedDirs); expandedDirs.add(edit.target);
      return { explorerEdit: edit, explorerMenu: null, expandedDirs };
    }),
    cancelExplorerEdit: () => set({ explorerEdit: null }),
    setDirty: (path, dirty) => set((s) => {
      if (s.dirtyFiles.has(path) === dirty) return s;
      const next = new Set(s.dirtyFiles);
      dirty ? next.add(path) : next.delete(path);
      return { dirtyFiles: next };
    }),
    setDocumentContent: (path, content) => set((s) => (
      s.documentContents[path] === content ? s : { documentContents: { ...s.documentContents, [path]: content } }
    )),
    openAgentPicker: () => set({ agentPickerOpen: true }),
    closeAgentPicker: () => set({ agentPickerOpen: false }),
    // Open (or focus) the file's editor tab and ask that editor to scroll to `line`. The
    // FileEditor whose path matches consumes pendingJump once it's mounted + ready, then clears.
    jumpToLine: (file, line) => set((s) => ({
      openFiles: s.openFiles.some(o => o.path === file.path) ? s.openFiles : [...s.openFiles, { path: file.path, name: file.name }],
      activeFile: file.path,
      pendingJump: { path: file.path, line },
      ...pushNav(s, { path: file.path, name: file.name, line, col: 0 }),
    })),
    // Like jumpToLine but carries a column — used by go-to-definition. The caller (the editor's LSP
    // handler) opens the tab first via openFile() so an external/library target lands read-only;
    // this then focuses it and sets the line:col the editor scrolls to once its content is loaded.
    jumpToPosition: (file, line, col) => set((s) => ({
      openFiles: s.openFiles.some(o => o.path === file.path) ? s.openFiles : [...s.openFiles, { path: file.path, name: file.name }],
      activeFile: file.path,
      pendingJump: { path: file.path, line, col },
      ...pushNav(s, { path: file.path, name: file.name, line, col: col ?? 0 }),
    })),
    clearPendingJump: () => set({ pendingJump: null }),
    // Push a new history stop (a "jump": go-to-def FROM-spot, or a big in-file caret move the editor
    // detects). pushNav truncates any forward entries and dedupes the same file+line.
    recordJump: (path, name, line, col) => set((s) => pushNav(s, { path, name, line, col })),
    // Keep the CURRENT stop's caret position in sync as you type / nudge the caret within the same
    // file, so Back/Forward land where you actually left — without adding a new stop. No-op if the
    // current stop is a different file (a file switch is recorded by navTab, not here).
    settleCursor: (path, name, line, col) => set((s) => {
      const cur = s.navIndex >= 0 ? s.navStack[s.navIndex] : null;
      if (!cur || cur.path !== path || (cur.line === line && cur.col === col)) return s;
      const navStack = s.navStack.slice();
      navStack[s.navIndex] = { path, name, line, col };
      return { navStack };
    }),
    navBack: () => set((s) => (s.navIndex > 0 ? applyNav(s, s.navIndex - 1) : s)),
    navForward: () => set((s) => (s.navIndex >= 0 && s.navIndex < s.navStack.length - 1 ? applyNav(s, s.navIndex + 1) : s)),
    setBookmarkView: (bookmarkView) => set({ bookmarkView }),
    setSearch: (patch) => set((s) => ({ search: { ...s.search, ...patch } })),
    setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
    setTerminalListWidth: (terminalListWidth) => set({ terminalListWidth }),
    setDockHeight: (dockHeight) => set({ dockHeight }),
  }));
}

export type RoomStore = ReturnType<typeof createRoomStore>;

export const RoomContext = createContext<RoomStore | null>(null);

/** Read the current room's store. Must be called inside a <Room> subtree. */
export function useRoom<T>(selector: (s: RoomState) => T): T {
  const store = useContext(RoomContext);
  if (!store) throw new Error("useRoom must be used within a Room");
  return useStore(store, selector);
}
