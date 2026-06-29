import { useContext } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { FsListing, GitInfo } from "../api/types";
import { RoomContext, useRoom, type ExplorerTarget } from "../store/room";
import { useClipboard } from "../store/clipboard";
import { useToasts } from "../store/toasts";
import { isLocalHost, revealLabel } from "../lib/host";
import { gitignoreMenuItem, ignoreScopeLabel } from "../lib/gitignore";
import { basename, dedupeName, dirname, join, relativeTo } from "../lib/paths";
import { collectUploads, fileToBase64, zipUploads, batchBySize, MAX_UPLOAD_BYTES, type UploadFile } from "../lib/upload";
import type { FileMenuEntry } from "../components/Scm/FileContextMenu";

/**
 * Builds the explorer right-click menu and owns every action it can fire (fs mutations,
 * clipboard, gitignore, reveal/open). Kept out of FileTree so the tree stays a dumb renderer.
 * `requestDelete` is injected so the destructive confirm dialog lives in the panel UI.
 */
export function useExplorerMenu(rootPath: string, gitInfo: GitInfo | undefined, requestDelete: (targets: ExplorerTarget[]) => void) {
  const qc = useQueryClient();
  const store = useContext(RoomContext)!;
  const push = useToasts(s => s.push);
  const startEdit = useRoom(s => s.startExplorerEdit);
  const setClipboard = useClipboard(s => s.setClipboard);
  const clearClipboard = useClipboard(s => s.clearClipboard);
  const clipboard = useClipboard(s => s.clipboard);
  const collapseAllDirs = useRoom(s => s.collapseAllDirs);
  const expandDirs = useRoom(s => s.expandDirs);
  const revealInExplorer = useRoom(s => s.revealInExplorer);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["fs"] });
    qc.invalidateQueries({ queryKey: ["fb-list"] }); // keep an open File Browser in sync (shared clipboard)
    qc.invalidateQueries({ queryKey: ["git"] });   // refresh status colours after a change
  };
  const namesIn = (dir: string) =>
    new Set((qc.getQueryData<FsListing>(["fs", dir])?.entries ?? []).map(e => e.name));

  async function run(label: string, fn: () => Promise<unknown>) {
    try { await fn(); invalidate(); }
    catch (e) { push(`${label}: ${(e as Error).message}`); }
  }

  function expandAllLoaded() {
    const dirs: string[] = [];
    for (const q of qc.getQueryCache().findAll({ queryKey: ["fs"] })) {
      const data = q.state.data as FsListing | undefined;
      if (data) for (const e of data.entries) if (e.type === "dir" && e.readable) dirs.push(e.path);
    }
    expandDirs(dirs);
  }

  // Paste the clipboard into a destination dir: copy keeps a deduped name in that dir; cut moves
  // (rename) the original and empties the clipboard. Lifted out of buildItems so the keyboard
  // shortcut (Cmd/Ctrl+V) and the right-click Paste run the exact same path.
  const pasteInto = (container: string) => run("Paste failed", async () => {
    if (!clipboard) return;
    // Paste every clipboard path (the whole multi-selection). Dedupe as we go: copy starts from the
    // container's names (so a duplicate becomes "name copy"); cut starts empty (a move keeps its
    // name). Either way each pasted name is added to `taken` so two items in one batch can't clobber.
    const taken = clipboard.op === "copy" ? namesIn(container) : new Set<string>();
    for (const src of clipboard.paths) {
      const name = dedupeName(basename(src), taken);
      taken.add(name);
      const dest = join(container, name);
      if (clipboard.op === "copy") await api.fsCopy(src, dest);
      else await api.fsRename(src, dest);
    }
    if (clipboard.op === "cut") clearClipboard();
    expandDirs([container]); // open the target so the pasted items show without a manual re-click
  });

  // Delete acts on the whole multi-selection when the right-clicked row is part of it (VS Code /
  // Finder behaviour); otherwise just that one row. openExplorerMenu already guarantees the target
  // sits in selectedPaths, so the live selection is exactly what to delete. Each path's type/name
  // comes from its parent's cached listing (every selected row is visible, so it's cached).
  const resolveTarget = (path: string): ExplorerTarget | null => {
    const entry = qc.getQueryData<FsListing>(["fs", dirname(path)])?.entries.find(e => e.path === path);
    return entry ? { path, name: entry.name, type: entry.type } : null;
  };
  const deleteTargets = (target: ExplorerTarget): ExplorerTarget[] => {
    const sel = store.getState().selectedPaths;
    if (sel.size <= 1 || !sel.has(target.path)) return [target];
    return [...sel].map(p => (p === target.path ? target : resolveTarget(p))).filter(Boolean) as ExplorerTarget[];
  };

  // Same rule as deleteTargets, paths only: Copy/Cut act on the whole multi-selection when the
  // acted-on row is part of it, otherwise just that one row (VS Code / Finder behaviour).
  const selectionPaths = (path: string): string[] => {
    const sel = store.getState().selectedPaths;
    return sel.size > 1 && sel.has(path) ? [...sel] : [path];
  };

  // Resolve the dir a keyboard paste targets from the current selection: into a selected folder,
  // else alongside a selected file (its parent), else the tree root. Type comes from the parent
  // listing already cached for any visible row.
  const containerFor = (selectedPath: string | null): string => {
    // No selection, or the root row itself, targets the root dir. The root is special: its own entry
    // lives in no cached listing (we never list above the project), so the lookup below would miss it
    // and fall back to dirname(root) — a dir OUTSIDE the tree. Short-circuit it.
    if (!selectedPath || selectedPath === rootPath) return rootPath;
    const parent = dirname(selectedPath);
    const entry = qc.getQueryData<FsListing>(["fs", parent])?.entries.find(e => e.path === selectedPath);
    return entry?.type === "dir" ? selectedPath : parent;
  };

  // Clipboard actions for the keyboard handler. Copy+Paste in the same folder duplicates (the
  // dedupe yields "name copy.ext"); paste into a selected folder drops it there, like VS Code.
  const clip = {
    copy: (path: string) => setClipboard({ op: "copy", paths: selectionPaths(path) }),
    cut: (path: string) => setClipboard({ op: "cut", paths: selectionPaths(path) }),
    paste: (selectedPath: string | null) => pasteInto(containerFor(selectedPath)),
  };

  // Write real OS files (dragged or pasted in) into `container` by reading their bytes in the
  // browser and uploading — a dropped Finder file exposes no host path, so we can't copy by path.
  // A single flat file goes up as one base64 POST; multiple files or a whole folder are zipped into
  // one (or few, size-capped) archive and unpacked server-side — one round-trip for a deep tree,
  // which matters over a remote VPS link. Top-level names are deduped against the folder (like
  // Paste) so nothing is clobbered; a folder keeps its inner structure (names carry subpaths).
  const firstSeg = (p: string) => p.split("/")[0];
  const uploadInto = async (container: string, uploads: UploadFile[]) => {
    const sized = uploads.filter(u => u.file.size <= MAX_UPLOAD_BYTES);
    const skipped = uploads.length - sized.length;
    if (sized.length) {
      // Dedupe the top-level segment of every name so a dropped file/folder never overwrites one
      // already in the target, then rewrite each upload's first segment to the safe name.
      const taken = namesIn(container);
      const remap = new Map<string, string>();
      for (const seg of new Set(sized.map(u => firstSeg(u.name)))) {
        const safe = dedupeName(seg, taken); taken.add(safe); remap.set(seg, safe);
      }
      const ok = sized.map(u => ({ file: u.file, name: remap.get(firstSeg(u.name))! + u.name.slice(firstSeg(u.name).length) }));
      const single = ok.length === 1 && !ok[0].name.includes("/");
      if (!single) push(`Uploading ${ok.length} item${ok.length > 1 ? "s" : ""}…`);
      try {
        if (single) {
          await api.fsUpload(container, ok[0].name, await fileToBase64(ok[0].file));
        } else {
          for (const batch of batchBySize(ok)) await api.fsUploadZip(container, await zipUploads(batch));
          push(`Added ${ok.length} item${ok.length > 1 ? "s" : ""}`);
        }
      } catch (e) {
        push(`Upload failed: ${(e as Error).message}`);
      } finally {
        expandDirs([container]); // open the target so dropped/pasted items show without a manual re-click
        invalidate(); // refresh the tree even on a partial upload
      }
    }
    if (skipped) push(`Skipped ${skipped} file${skipped > 1 ? "s" : ""} over ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB`);
  };

  // Desktop-style Paste into `container`. Local: ask the server to copy whatever files/folders are
  // on the host OS clipboard (real cp — multi-select + whole folders, instant, no size cap). If the
  // host clipboard holds no files (e.g. a copied screenshot), fall back to byte-uploading any files
  // the browser surfaced. Remote: only the browser files (the host clipboard isn't the user's).
  const desktopPasteInto = async (container: string, browserFiles: File[]) => {
    if (isLocalHost) {
      try {
        const { pasted } = await api.fsPasteClipboard(container);
        if (pasted.length) { expandDirs([container]); invalidate(); return; }
        // host clipboard held no files → fall through to any browser-surfaced files (e.g. a screenshot)
      } catch (e) {
        if (!browserFiles.length) { push(`Paste failed: ${(e as Error).message}`); return; }
        // else: try the browser files as a fallback
      }
    }
    if (browserFiles.length) await uploadInto(container, browserFiles.map(f => ({ name: f.name, file: f })));
  };

  // Upload entrypoints for the explorer panel. `desktopPaste` backs Cmd/Ctrl+V (host clipboard +
  // browser-file fallback); `drop` backs a drag (which may carry whole folders). Both target the
  // same dir Paste would (containerFor).
  const upload = {
    desktopPaste: (selectedPath: string | null, browserFiles: File[]) =>
      desktopPasteInto(containerFor(selectedPath), browserFiles),
    drop: async (dt: DataTransfer, selectedPath: string | null) =>
      uploadInto(containerFor(selectedPath), await collectUploads(dt)),
  };

  // `results` = the menu was opened from the Filter Files / Search result lists, not the Explorer
  // tree. Those views render no inline edit row, so the actions that rely on one (New File, New
  // Folder, Rename) and the tree-only Collapse/Expand All are dropped — every path-based action
  // (reveal, open, cut/copy/duplicate/paste, copy path, delete, gitignore) stays and works as-is.
  function buildItems(target: ExplorerTarget, opts: { results?: boolean } = {}): FileMenuEntry[] {
    const { results = false } = opts;
    const isRoot = target.name === "";                       // empty-area (background) menu
    const container = target.type === "dir" ? target.path : dirname(target.path);
    const rel = relativeTo(target.path, rootPath);

    const duplicate = () => run("Duplicate failed", () => {
      const dir = dirname(target.path);
      const name = dedupeName(basename(target.path), namesIn(dir).add(basename(target.path)));
      return api.fsCopy(target.path, join(dir, name));
    });
    // Internal cut/copy pastes the tree clipboard; otherwise (local) paste the host OS clipboard.
    const paste = () => clipboard ? pasteInto(container) : desktopPasteInto(container, []);
    const runIgnore = (scope: "local" | "repo") => run("Add to .gitignore failed", async () => {
      const res = await api.git.ignore(rootPath, rel, scope, target.type === "dir");
      push(res.added ? `Added ${res.line} to ${ignoreScopeLabel(scope)}` : `${res.line} already in ${ignoreScopeLabel(scope)}`);
    });

    const entries: FileMenuEntry[] = [];
    // From the Filter/Search result lists the row isn't in the tree — give it a jump back to the
    // Explorer (expand to it, select + flash). Redundant inside the tree itself, so results-only.
    if (results && !isRoot) entries.push({ label: "Reveal in Explorer", onClick: () => revealInExplorer(target.path) }, "sep");
    if (!results) {
      entries.push(
        { label: "New File", onClick: () => startEdit({ mode: "new-file", target: container }) },
        { label: "New Folder", onClick: () => startEdit({ mode: "new-folder", target: container }) },
      );
    }

    if (!isRoot && isLocalHost) {
      entries.push(
        "sep",
        { label: revealLabel, onClick: () => api.revealPath(target.path).catch((e: Error) => push(e.message)) },
        { label: "Open in Default App", onClick: () => api.openPath(target.path).catch((e: Error) => push(e.message)) },
      );
    }

    if (!isRoot) {
      entries.push(
        "sep",
        { label: "Cut", onClick: () => setClipboard({ op: "cut", paths: selectionPaths(target.path) }) },
        { label: "Copy", onClick: () => setClipboard({ op: "copy", paths: selectionPaths(target.path) }) },
        { label: "Duplicate", onClick: duplicate },
      );
    }
    entries.push({ label: "Paste", disabled: !clipboard && !isLocalHost, onClick: paste });

    if (!isRoot) {
      entries.push(
        "sep",
        { label: "Copy Path", onClick: () => navigator.clipboard.writeText(target.path).catch(() => {}) },
        { label: "Copy Relative Path", onClick: () => navigator.clipboard.writeText(rel).catch(() => {}) },
        "sep",
      );
      if (!results) entries.push({ label: "Rename", hint: "F2", onClick: () => startEdit({ mode: "rename", target: target.path }) });
      entries.push({ label: "Delete", onClick: () => requestDelete(deleteTargets(target)) });
      if (gitInfo?.isRepo) entries.push(gitignoreMenuItem(runIgnore));
    }

    if (!results) {
      entries.push(
        "sep",
        { label: "Collapse All", hint: "⌘←", onClick: collapseAllDirs },
        { label: "Expand All", hint: "⌘→", onClick: expandAllLoaded },
      );
    }

    // Drop leading/trailing/double "sep"s left behind by any omitted group so no stray divider shows.
    const clean: FileMenuEntry[] = [];
    for (const e of entries) {
      if (e === "sep" && (clean.length === 0 || clean[clean.length - 1] === "sep")) continue;
      clean.push(e);
    }
    if (clean[clean.length - 1] === "sep") clean.pop();
    return clean;
  }

  return { buildItems, collapseAll: collapseAllDirs, expandAll: expandAllLoaded, clip, upload };
}
