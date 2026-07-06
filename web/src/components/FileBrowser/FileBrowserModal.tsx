import { copyText } from "../../lib/clipboard";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type TransitionEventHandler } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useUi, spacesBarBottom, type WinRect } from "../../store/ui";
import { useToasts } from "../../store/toasts";
import { lockCursor } from "../../lib/dragCursor";
import { isLocalHost, revealLabel } from "../../lib/host";
import { basename, relativeTo } from "../../lib/paths";
import { nextFreeCell } from "../../lib/grid";
import type { Workspace, Folder } from "../../api/types";
import { useDraggableWindow, type WindowHandle } from "../../hooks/useDraggableWindow";
import { ResizeHandles } from "../ResizeHandles";
import { ConfirmDialog } from "../ConfirmDialog";
import { FileContextMenu, type FileMenuEntry } from "../Scm/FileContextMenu";
import { BrowserTree, type BrowserTarget } from "./BrowserTree";
import { BrowserList, type BrowserView, type QuickLookOpts } from "./BrowserList";
import { PlacesBar } from "./PlacesBar";
import { useBrowserFs, type BrowserEdit } from "./useBrowserFs";
import { QuickLook } from "./QuickLook";
import { FileEditorWindow, editTargetOf } from "./FileEditorWindow";
import { isEditableTextName, isImageFile, isPdfFile } from "../../lib/fileKinds";
import { hostPathOf, hostRef, refKey, sameRef, type Ref } from "./ref";

const RECT_KEY = "tr.fileBrowserRect";
const VIEW_KEY = "tr.fileBrowserView";
const SIDEBAR_KEY = "tr.fileBrowserSidebarW";
const MIN_W = 560, MIN_H = 380;
const SIDEBAR_MIN = 160, SIDEBAR_DEFAULT = 256; // px; default matches the old fixed w-64
const LIST_MIN = 280;                            // keep the contents pane usable when widening the tree
const DURATION = 300; // ms — grow-from-icon / minimize-to-icon

function defaultRect(): WinRect {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(1000, Math.round(vw * 0.76));
  const h = Math.min(680, Math.round(vh * 0.76));
  const top = spacesBarBottom() + 8;
  return { w, h, x: Math.max(8, Math.round((vw - w) / 2)), y: Math.max(top, Math.round((vh - h) / 2)) };
}

function loadRect(): WinRect {
  try {
    const raw = localStorage.getItem(RECT_KEY);
    if (raw) {
      const r = JSON.parse(raw) as Partial<WinRect>;
      if (typeof r.x === "number" && typeof r.y === "number" && typeof r.w === "number" && typeof r.h === "number") {
        const vw = window.innerWidth, vh = window.innerHeight;
        const w = Math.max(MIN_W, Math.min(r.w, vw - 16));
        const h = Math.max(MIN_H, Math.min(r.h, vh - 16));
        return { w, h, x: Math.max(8, Math.min(vw - 80, r.x)), y: Math.max(8, Math.min(vh - 60, r.y)) };
      }
    }
  } catch { /* ignore corrupt/blocked storage */ }
  return defaultRect();
}

function loadView(): BrowserView {
  try { return localStorage.getItem(VIEW_KEY) === "icons" ? "icons" : "list"; } catch { return "list"; }
}

function loadSidebarW(): number {
  try {
    const n = Number(localStorage.getItem(SIDEBAR_KEY));
    if (Number.isFinite(n) && n >= SIDEBAR_MIN) return n;
  } catch { /* ignore corrupt/blocked storage */ }
  return SIDEBAR_DEFAULT;
}

/** One breadcrumb segment: a display label + the ref clicking it navigates to. */
type Crumb = { label: string; ref: Ref };

/** Host breadcrumb segments with their cumulative absolute paths, root first.
 *  Handles both POSIX ("/home/user/...") and Windows drive-letter ("D:/Documents/...") paths.
 *  On Windows, "/" is the virtual drives root so breadcrumbs read: / → D: → Documents → ... */
function hostCrumbs(p: string): Crumb[] {
  // Windows absolute path: starts with a drive letter followed by ":/".
  const driveMatch = /^([A-Za-z]:\/)/.exec(p);
  if (driveMatch) {
    const driveRoot = driveMatch[1]; // e.g. "D:/"
    const driveName = driveRoot.slice(0, 2); // "D:"
    const rest = p.slice(driveRoot.length);
    const parts = rest.split("/").filter(Boolean);
    // "/" is the virtual drives-list root; clicking it shows all available drives.
    const out: Crumb[] = [{ label: "/", ref: hostRef("/") }, { label: driveName, ref: hostRef(driveRoot) }];
    let acc = driveRoot;
    for (const part of parts) { out.push({ label: part, ref: hostRef(acc + part) }); acc += part + "/"; }
    return out;
  }
  // POSIX path.
  const parts = p.split("/").filter(Boolean);
  const out: Crumb[] = [{ label: "/", ref: hostRef("/") }];
  let acc = "";
  for (const part of parts) { acc += "/" + part; out.push({ label: part, ref: hostRef(acc) }); }
  return out;
}

/**
 * The file browser: a free-floating, draggable/resizable window (Places + tree on the left, folder
 * contents in the middle) for browsing the whole machine AND any connected Google Drive account.
 * Seeds at the active workspace folder. Drive accounts mount as Places that re-root the window;
 * host refs behave exactly as before. Back/forward walk the navigation history; a clickable
 * breadcrumb sits at the bottom (host paths, or the Drive nav trail). Right-click a host folder for
 * "Open in Workspace"; full file management like the workspace Explorer. Files preview with Quick
 * Look (Space / double-click); host rows drag into terminals as a path.
 */
export const FileBrowserModal = forwardRef<WindowHandle, { origin?: WinRect | null; onClose: () => void }>(function FileBrowserModal({ origin, onClose }, ref) {
  const qc = useQueryClient();
  const { data: wsData } = useQuery({ queryKey: ["workspaces"], queryFn: api.listWorkspaces });
  const openRooms = useUi(s => s.openRooms);
  const activeSpaceId = useUi(s => s.activeSpaceId);
  const push = useToasts(s => s.push);
  const [seedRect] = useState(loadRect);
  const { rect, beginDrag, beginResize } = useDraggableWindow(seedRect, MIN_W, MIN_H, undefined, undefined, "files");

  // Seed at the top-most open room's workspace folder, else the first workspace, else the FS root.
  const seed = useMemo(() => {
    const top = [...openRooms].sort((a, b) => b.z - a.z)[0];
    const byId = new Map((wsData?.workspaces ?? []).map(w => [w.id, w.folder]));
    return (top && byId.get(top.workspaceId)) || wsData?.workspaces?.[0]?.folder || "/";
  }, [openRooms, wsData]);
  const computerRef = useMemo(() => hostRef(seed), [seed]);

  // Connected Drives mount as sibling roots to Computer in the tree, so opening a Drive never hides
  // your local files. Drives only load once the OAuth client is configured (else /accounts 501s).
  const { data: driveConfig } = useQuery({ queryKey: ["drive-config"], queryFn: api.driveGetConfig, retry: false, staleTime: 30_000 });
  const driveConfigured = driveConfig?.configured ?? false;
  const { data: driveAcctData } = useQuery({
    queryKey: ["drive-accounts"], queryFn: api.driveAccounts, retry: false, staleTime: 30_000, enabled: driveConfigured,
  });
  const driveAccounts = driveAcctData?.accounts ?? [];

  // The host tree's root: starts at the seed, re-roots when you navigate outside it (so parent
  // folders become reachable). `selectedRef` — host OR drive — is what the middle list shows.
  const [hostRootOverride, setHostRootOverride] = useState<Ref | null>(null);
  const hostRoot = hostRootOverride ?? computerRef;
  const [userRef, setUserRef] = useState<Ref | null>(null);
  const selectedRef = userRef ?? computerRef;

  // Every tree root, in sidebar order: Computer first, then one node per connected Drive.
  const driveRoots = useMemo<Ref[]>(
    () => driveAccounts.map((a) => ({ kind: "drive", accountId: a.id, accountLabel: a.label?.trim() || a.email, fileId: null, root: null })),
    [driveAccounts],
  );
  const treeRoots = useMemo<Ref[]>(() => [hostRoot, ...driveRoots], [hostRoot, driveRoots]);

  // The Drive breadcrumb trail (Drive has no cheap ancestry, so we accumulate it as the user dives).
  const [trail, setTrail] = useState<Crumb[]>([]);

  // Desktop-style back/forward over the current ref. `goto` moves without recording history (used by
  // back/forward); `navigate` records it. Leaving a host subtree re-roots the host tree.
  const [back, setBack] = useState<Ref[]>([]);
  const [fwd, setFwd] = useState<Ref[]>([]);

  // Keep the Drive trail consistent with where we land: truncate to the ref if already in the trail,
  // else append it. (Host uses hostCrumbs; the trail is only consulted for Drive.)
  const pushTrail = (r: Ref, label: string) => setTrail((t) => {
    const i = t.findIndex((c) => sameRef(c.ref, r));
    if (i >= 0) return t.slice(0, i + 1);
    return [...t, { label, ref: r }];
  });

  const goto = (r: Ref, label?: string) => {
    if (hostRootOverride === null) setHostRootOverride(hostRoot); // freeze vs. a later workspace refetch
    setUserRef(r);
    if (r.kind === "host") {
      const root = hostRoot.kind === "host" ? hostRoot.path : "/";
      // "/" is the universal root — every absolute path is considered "under" it.
      if (root !== "/" && r.path !== root) {
        const rootPrefix = root.endsWith("/") ? root : root + "/";
        if (!r.path.startsWith(rootPrefix)) setHostRootOverride(hostRef(r.path));
      }
    } else {
      pushTrail(r, label ?? r.accountLabel);
    }
  };
  const navigate = (r: Ref, label?: string) => {
    if (sameRef(r, selectedRef)) return;
    setBack(b => [...b, selectedRef]);
    setFwd([]);
    goto(r, label);
  };
  const goBack = () => {
    if (!back.length) return;
    setFwd(f => [selectedRef, ...f]);
    setBack(b => b.slice(0, -1));
    goto(back[back.length - 1]);
  };
  const goForward = () => {
    if (!fwd.length) return;
    setBack(b => [...b, selectedRef]);
    setFwd(f => f.slice(1));
    goto(fwd[0]);
  };

  // Disconnect a Drive from its tree-node menu. If the removed account was selected, fall back to
  // Computer so the middle list doesn't dangle on a now-gone account.
  const disconnectDrive = useMutation({
    mutationFn: (id: string) => api.driveDisconnect(id),
    onSuccess: (_r, id) => {
      qc.invalidateQueries({ queryKey: ["drive-accounts"] });
      if (selectedRef.kind === "drive" && selectedRef.accountId === id) { setUserRef(null); setTrail([]); }
    },
    onError: (e: Error) => push(e.message),
  });

  const create = useMutation({
    mutationFn: api.createWorkspace,
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["workspaces"] }); push(`Added workspace “${r.workspace.name}”`); },
    onError: (e: Error) => push(e.message),
  });
  // "Open in Workspace" (host folders only) → drop a card named after the folder onto the active space.
  const openInWorkspace = (folder: string) => {
    const all: Workspace[] = wsData?.workspaces ?? [];
    const name = basename(folder) || folder;
    if (all.some(w => w.folder === folder)) { push(`Workspace already exists for “${name}”`); return; }
    // Occupied cells = loose cards (not inside a folder) + folder tiles; folder members hold stale
    // pre-grouping coords and aren't on the canvas, so they must not count. See nextFreeCell.
    const allFolders = qc.getQueryData<{ folders: Folder[] }>(["folders"])?.folders ?? [];
    const inSpace = (sid: string | null | undefined) => (activeSpaceId ? sid === activeSpaceId : !sid);
    const occupied = [
      ...all.filter(w => inSpace(w.spaceId) && !w.folderId),
      ...allFolders.filter(f => inSpace(f.spaceId)),
    ];
    const { x, y } = nextFreeCell(occupied, window.innerHeight);
    create.mutate({ name, folder, x, y, ...(activeSpaceId ? { spaceId: activeSpaceId } : {}) });
  };

  const [showHidden, setShowHidden] = useState(false);
  const [view, setView] = useState<BrowserView>(loadView);
  const changeView = (v: BrowserView) => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* blocked */ } setView(v); };

  // Drive / quick-access chips above the contents pane — same source as the workspace folder picker
  // (every mounted volume on this host). A chip jumps the browser straight to that drive's root.
  const { data: volData } = useQuery({ queryKey: ["fs-volumes"], queryFn: () => api.fsVolumes(), staleTime: 60_000 });
  const volumes = volData?.volumes ?? [];

  // Resizable left pane (tree). Width persists across opens; clamped to the modal so widening the
  // tree to read long folder names can't swallow the contents pane. Mirrors the Room sidebar splitter.
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [sidebarW, setSidebarW] = useState(loadSidebarW);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const sidebarWidth = Math.max(SIDEBAR_MIN, Math.min(sidebarW, rect.w - LIST_MIN));
  const startSidebarResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setResizingSidebar(true);
    const release = lockCursor("col-resize");
    const onMove = (ev: PointerEvent) => {
      const r = sidebarRef.current?.getBoundingClientRect();
      if (!r) return;
      setSidebarW(Math.max(SIDEBAR_MIN, Math.min(rect.w - LIST_MIN, ev.clientX - r.left)));
    };
    const onUp = () => {
      setResizingSidebar(false); release();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setSidebarW((w) => { try { localStorage.setItem(SIDEBAR_KEY, String(w)); } catch { /* blocked */ } return w; });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const [quickLook, setQuickLook] = useState<{ ref: Ref; name: string; origin: WinRect; webViewLink: string | null } | null>(null);
  const [editor, setEditor] = useState<{ ref: Ref; name: string; origin: WinRect } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; target: BrowserTarget | null; container: Ref; rect: WinRect } | null>(null);

  // A file opens in the editor when it has real, text-editable bytes: not a Google-native doc, not an
  // image/PDF (those preview), and resolvable to a host path or Drive file id. Host files always
  // qualify (the editor itself reports a binary); Drive files must look like text/code by name.
  const canEditFile = (r: Ref, name: string, google?: boolean) =>
    !google && !!editTargetOf(r) && !isImageFile(name) && !isPdfFile(name) && (r.kind === "host" || isEditableTextName(name));

  // Double-click / Enter on a file: editable → the editor; everything else → Quick Look preview (which
  // now plays video inline, so a video previews here instead of dead-ending).
  const openFile = (r: Ref, name: string, origin: WinRect, opts: QuickLookOpts) => {
    if (canEditFile(r, name, opts.google)) setEditor({ ref: r, name, origin });
    else setQuickLook({ ref: r, name, origin, webViewLink: opts.webViewLink });
  };

  // File operations (clipboard + fs mutations + upload), shared by the tree, list, and menu.
  const fs = useBrowserFs();
  const [editing, setEditing] = useState<BrowserEdit | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BrowserTarget[] | null>(null);
  // Inline edits render in the middle pane, so starting one navigates the list to the target's
  // folder first (a rename kicked off from the left tree then shows its input in the list).
  const startEdit = (edit: BrowserEdit) => {
    if (edit.mode === "rename") {
      if (edit.ref.kind === "host") navigate(hostRef(edit.ref.path.slice(0, edit.ref.path.lastIndexOf("/")) || "/"));
      // Drive rename happens in-place in the current folder; no navigation needed.
    } else {
      navigate(edit.container);
    }
    setEditing(edit);
  };
  const commitEdit = (name: string) => { if (editing) fs.commitEdit(editing, name); setEditing(null); };

  // Grow-from-icon on open, minimize-to-icon on close (same trick as the other floating windows).
  const reduce = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [expanded, setExpanded] = useState(reduce);
  useEffect(() => {
    if (reduce) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setExpanded(true)));
    return () => cancelAnimationFrame(id);
  }, [reduce]);
  const handleClose = () => { if (reduce) { onClose(); return; } setExpanded(false); };
  // Expose the same minimize-to-icon close to the TopBar File Browser icon so a second press collapses it.
  useImperativeHandle(ref, () => ({ close: handleClose }));
  const onTransitionEnd: TransitionEventHandler = (e) => {
    if (e.target === e.currentTarget && e.propertyName === "transform" && !expanded) onClose();
  };

  useEffect(() => {
    const t = window.setTimeout(() => { try { localStorage.setItem(RECT_KEY, JSON.stringify(rect)); } catch { /* blocked */ } }, 300);
    return () => window.clearTimeout(t);
  }, [rect]);

  // target = the right-clicked row, or null for the empty-pane (background) menu. container = the
  // folder ref New/Paste act in (a folder itself, else the current dir).
  const openMenu = (e: ReactMouseEvent, target: BrowserTarget | null, container: Ref) => {
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ x: e.clientX, y: e.clientY, target, container, rect: { x: r.left, y: r.top, w: r.width, h: r.height } });
  };

  const openQuickLook = (r: Ref, name: string, o: WinRect, opts: QuickLookOpts) =>
    setQuickLook({ ref: r, name, origin: o, webViewLink: opts.webViewLink });

  const menuItems = (m: NonNullable<typeof menu>): FileMenuEntry[] =>
    m.container.kind === "drive" ? driveMenu(m) : hostMenu(m);

  // The host context menu — today's full set, unchanged in behavior (now ref-typed).
  const hostMenu = (m: NonNullable<typeof menu>): FileMenuEntry[] => {
    const { target, container, rect: r } = m;
    const newItems: FileMenuEntry[] = [
      { label: "New File", onClick: () => startEdit({ mode: "new-file", container }) },
      { label: "New Folder", onClick: () => startEdit({ mode: "new-folder", container }) },
    ];
    const paste: FileMenuEntry = { label: "Paste", disabled: !fs.canPasteInto(container), onClick: () => fs.paste(container, showHidden) };
    if (!target) return [...newItems, "sep", paste];

    const path = hostPathOf(target.ref)!;
    const rootPath = hostPathOf(hostRoot) ?? "/";
    const rel = relativeTo(path, rootPath);
    const head: FileMenuEntry[] = target.type === "file"
      ? [
          ...(canEditFile(target.ref, target.name) ? [{ label: "Edit", onClick: () => setEditor({ ref: target.ref, name: target.name, origin: r }) } as FileMenuEntry] : []),
          { label: "Quick Look", hint: "Space", onClick: () => setQuickLook({ ref: target.ref, name: target.name, origin: r, webViewLink: null }) },
        ]
      : [
          { label: "Open", onClick: () => navigate(target.ref) },
          { label: "Open in Workspace", onClick: () => openInWorkspace(path) },
        ];
    return [
      ...head,
      "sep",
      ...newItems,
      paste,
      "sep",
      { label: "Cut", onClick: () => fs.cut([target.ref]) },
      { label: "Copy", onClick: () => fs.copy([target.ref]) },
      { label: "Duplicate", onClick: () => fs.duplicate(target.ref, showHidden) },
      { label: "Rename", hint: "F2", onClick: () => startEdit({ mode: "rename", ref: target.ref, name: target.name }) },
      { label: "Delete", onClick: () => setPendingDelete([target]) },
      "sep",
      { label: "Copy Path", onClick: () => copyText(path) },
      { label: "Copy Relative Path", onClick: () => copyText(rel) },
      ...(isLocalHost
        ? ["sep" as const,
            { label: revealLabel, onClick: () => api.revealPath(path).catch((e: Error) => push(e.message)) },
            { label: "Open in Default App", onClick: () => api.openPath(path).catch((e: Error) => push(e.message)) }]
        : []),
    ];
  };

  // The Drive context menu: browse/open/preview + write ops (new folder, rename, delete=trash, cut,
  // paste) for the same account. Copy/duplicate/new-file aren't offered (deferred / unsupported).
  const driveMenu = (m: NonNullable<typeof menu>): FileMenuEntry[] => {
    const { target, container, rect: r } = m;
    const newFolder: FileMenuEntry = { label: "New Folder", onClick: () => startEdit({ mode: "new-folder", container }) };
    const paste: FileMenuEntry = { label: "Paste", disabled: !fs.canPasteInto(container), onClick: () => fs.paste(container, showHidden) };
    if (!target) return [newFolder, "sep", paste];

    const d = target.ref as Extract<Ref, { kind: "drive" }>;
    // The account node itself (no folder id, no special root) — its only action is Disconnect.
    if (d.fileId === null && d.root === null) {
      return [{ label: "Disconnect", onClick: () => disconnectDrive.mutate(d.accountId) }];
    }
    const open: FileMenuEntry = target.type === "file"
      ? { label: "Quick Look", hint: "Space", onClick: () => setQuickLook({ ref: target.ref, name: target.name, origin: r, webViewLink: target.webViewLink ?? null }) }
      : { label: "Open", onClick: () => navigate(target.ref, target.name) };
    const editEntry: FileMenuEntry[] = target.type === "file" && canEditFile(target.ref, target.name, target.google)
      ? [{ label: "Edit", onClick: () => setEditor({ ref: target.ref, name: target.name, origin: r }) }]
      : [];
    return [
      ...editEntry,
      open,
      ...(target.webViewLink ? [{ label: "Open in Google ↗", onClick: () => window.open(target.webViewLink!, "_blank", "noopener") } as FileMenuEntry] : []),
      ...(target.type === "file" ? [{ label: "Download", onClick: () => downloadDrive(d, target.name) } as FileMenuEntry] : []),
      "sep",
      newFolder,
      paste,
      "sep",
      { label: "Cut", onClick: () => fs.cut([target.ref]) },
      { label: "Rename", hint: "F2", onClick: () => startEdit({ mode: "rename", ref: target.ref, name: target.name }) },
      { label: "Delete", onClick: () => setPendingDelete([target]) },
    ];
  };

  // Download a Drive file: fetch its authed bytes as a blob URL and click a temporary <a download>.
  const downloadDrive = async (d: Extract<Ref, { kind: "drive" }>, name: string) => {
    try {
      const url = await api.driveFileUrl(d.accountId, d.fileId!);
      const a = document.createElement("a");
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) { push((e as Error).message); }
  };

  // Breadcrumb: host → path crumbs; drive → the accumulated nav trail.
  const crumbs: Crumb[] = selectedRef.kind === "host" ? hostCrumbs(selectedRef.path) : trail;
  const headerLabel = selectedRef.kind === "host" ? (basename(selectedRef.path) || selectedRef.path)
    : (trail[trail.length - 1]?.label ?? selectedRef.accountLabel);

  const collapsed = origin
    ? `translate(${origin.x - rect.x}px, ${origin.y - rect.y}px) scale(${origin.w / rect.w}, ${origin.h / rect.h})`
    : "scale(0.94)";
  const style: CSSProperties = {
    left: rect.x, top: rect.y, width: rect.w, height: rect.h,
    ...(reduce ? {} : {
      transformOrigin: origin ? "0 0" : "50% 50%",
      transform: expanded ? "translate(0px, 0px) scale(1, 1)" : collapsed,
      opacity: expanded ? 1 : 0,
      transition: `transform ${DURATION}ms cubic-bezier(.22,.61,.36,1), opacity ${DURATION}ms ease`,
      willChange: "transform, opacity",
    }),
  };

  return (
    <>
      <div onTransitionEnd={onTransitionEnd} style={style}
        className="fixed z-50 flex flex-col rounded-lg overflow-hidden border border-edge-strong bg-canvas shadow-2xl">
        <div onPointerDown={beginDrag}
          className="h-8 shrink-0 flex items-center justify-between px-4 border-b border-edge cursor-move select-none">
          <div className="font-semibold">File Browser</div>
          <div className="flex items-center gap-2" onPointerDown={(e) => e.stopPropagation()}>
            <label className="flex items-center gap-1.5 text-xs text-dim hover:text-fg cursor-pointer select-none">
              <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)}
                className="w-3 h-3 accent-blue-600 cursor-pointer" />
              Hidden
            </label>
            <button onClick={handleClose} title="Close"
              className="px-3 h-6 inline-flex items-center bg-elevated rounded text-sm">Close</button>
          </div>
        </div>

        {/* Nav bar: back / forward through the folder history + the current folder's name. */}
        <div className="h-8 shrink-0 flex items-center gap-1 px-2 border-b border-edge text-xs">
          <button onClick={goBack} disabled={!back.length} title="Back"
            className="px-1.5 h-6 inline-flex items-center rounded text-base leading-none text-dim hover:text-fg hover:bg-surface disabled:opacity-30 disabled:hover:bg-transparent">←</button>
          <button onClick={goForward} disabled={!fwd.length} title="Forward"
            className="px-1.5 h-6 inline-flex items-center rounded text-base leading-none text-dim hover:text-fg hover:bg-surface disabled:opacity-30 disabled:hover:bg-transparent">→</button>
          <span className="ml-2 flex-1 min-w-0 truncate text-dim">{headerLabel}</span>
          {/* View switch: vertical list ⇄ Finder-style icon grid (persisted per-browser). */}
          <div className="flex items-center gap-0.5 shrink-0">
            <button onClick={() => changeView("list")} title="List view" aria-pressed={view === "list"}
              className={`px-1.5 h-6 inline-flex items-center rounded text-base leading-none ${view === "list" ? "text-fg bg-surface" : "text-dim hover:text-fg hover:bg-surface"}`}>☰</button>
            <button onClick={() => changeView("icons")} title="Icon view" aria-pressed={view === "icons"}
              className={`px-1.5 h-6 inline-flex items-center rounded text-base leading-none ${view === "icons" ? "text-fg bg-surface" : "text-dim hover:text-fg hover:bg-surface"}`}>▦</button>
          </div>
        </div>

        {/* Drive / quick-access chips (Finder-style): jump straight to any mounted volume's root. */}
        {volumes.length > 0 && (
          <div className="h-9 shrink-0 flex items-center gap-1.5 px-2 border-b border-edge overflow-x-auto no-scrollbar">
            {volumes.map((v) => {
              const curHost = hostPathOf(selectedRef);
              const active = !!curHost && (curHost === v.path || curHost.startsWith(v.path === "/" ? "/" : v.path + "/"));
              return (
                <button key={v.path} onClick={() => navigate(hostRef(v.path))} title={v.path}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors cursor-pointer ${active ? "bg-blue-600/15 text-blue-300" : "bg-surface text-muted hover:bg-elevated hover:text-fg"}`}>
                  <DiskIcon />{v.name}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex-1 min-h-0 flex">
          <div ref={sidebarRef} style={{ width: sidebarWidth }} className="shrink-0 border-r border-edge overflow-auto">
            <PlacesBar />
            <BrowserTree roots={treeRoots} selectedRef={selectedRef} onSelectRef={(r) => navigate(r)}
              showHidden={showHidden} isCut={fs.isCut} onContextMenu={(e, t) => openMenu(e, t, t.ref)} />
          </div>
          <div className="relative flex-1 min-w-0">
            {/* Tree-pane resize splitter. Anchored to the contents pane's LEFT edge — i.e. just to the
                right of the tree's border — so its grab zone clears the tree's vertical scrollbar
                (industry-standard sash: thin seam line + a wider invisible grab strip). */}
            <div onPointerDown={startSidebarResize} title="Drag to resize"
              className="group absolute inset-y-0 left-0 z-10 w-2.5 cursor-col-resize">
              <div className={`h-full w-0.5 ${resizingSidebar ? "bg-accent/60" : "bg-transparent group-hover:bg-accent/40"}`} />
            </div>
            <BrowserList currentRef={selectedRef} view={view} showHidden={showHidden} fs={fs}
              editing={editing} startEdit={startEdit} requestDelete={setPendingDelete}
              onOpenDir={(r) => navigate(r)} onOpenFile={openFile} onQuickLook={openQuickLook}
              onContextMenu={openMenu} onCommitEdit={commitEdit} onCancelEdit={() => setEditing(null)} />
          </div>
        </div>

        {/* Bottom path bar (Finder-style): clickable breadcrumb of the current folder / Drive trail. */}
        <div className="h-8 shrink-0 flex items-center gap-1 px-2 border-t border-edge text-xs overflow-x-auto no-scrollbar">
          {crumbs.map((c, i, arr) => (
            <span key={refKey(c.ref)} className="flex items-center gap-1 shrink-0">
              <button onClick={() => navigate(c.ref, c.label)}
                className={`px-1 h-6 inline-flex items-center rounded hover:bg-surface ${i === arr.length - 1 ? "text-fg" : "text-dim hover:text-fg"}`}>
                {c.label}
              </button>
              {i < arr.length - 1 && <span className="text-dim">/</span>}
            </span>
          ))}
        </div>

        <ResizeHandles onStart={beginResize} />
      </div>

      {menu && <FileContextMenu x={menu.x} y={menu.y} items={menuItems(menu)} dismiss={() => setMenu(null)} />}
      {quickLook && <QuickLook ref_={quickLook.ref} name={quickLook.name} origin={quickLook.origin} webViewLink={quickLook.webViewLink} onClose={() => setQuickLook(null)} />}
      {editor && <FileEditorWindow key={refKey(editor.ref)} ref_={editor.ref} name={editor.name} origin={editor.origin} onClose={() => setEditor(null)} />}
      {pendingDelete && (
        <ConfirmDialog
          title={pendingDelete.length > 1 ? `Delete ${pendingDelete.length} items?` : `Delete “${pendingDelete[0].name}”?`}
          body={pendingDelete.some(t => t.ref.kind === "drive")
            ? "Items move to your Google Drive Trash — you can restore them there."
            : `${pendingDelete.some(t => t.type === "dir") ? "Folders are deleted with everything inside them. " : ""}This can’t be undone.`}
          confirmLabel="Delete"
          onConfirm={() => { fs.remove(pendingDelete.map(t => t.ref)); setPendingDelete(null); }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  );
});

/** Small drive glyph for the quick-access chips (matches the workspace folder picker's DiskIcon). */
function DiskIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M3.5 10h17" />
      <circle cx="7.5" cy="14.5" r="1" />
    </svg>
  );
}
