import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useClipboard } from "../../store/clipboard";
import { useToasts } from "../../store/toasts";
import { isLocalHost } from "../../lib/host";
import { basename, dedupeName, dirname, join } from "../../lib/paths";
import { batchBySize, collectUploads, fileToBase64, zipUploads, MAX_UPLOAD_BYTES, type UploadFile } from "../../lib/upload";
import { hostPathOf, sameRef, type Ref } from "./ref";
import type { BrowserEntry } from "./listing";

export type { Clipboard } from "../../store/clipboard";

/** An in-progress inline edit rendered in the middle pane: rename an existing ref, or name a new
 *  file/folder created inside the `container` ref. */
export type BrowserEdit =
  | { mode: "rename"; ref: Ref; name: string }
  | { mode: "new-file"; container: Ref }
  | { mode: "new-folder"; container: Ref };

// The list cache (`fb-list`) entries for a folder ref, used for dedupe + drive-move lookups.
type ListCache = BrowserEntry[];

/**
 * File operations for the File Browser, dispatched by `Ref` kind. Host refs use the same fs API +
 * dedupe/upload machinery the workspace Explorer uses (api.fs*), sharing the SAME app-wide clipboard
 * store as the Explorer, so a copy/cut here pastes in any workspace Explorer and vice-versa. Drive
 * refs use api.drive* and a small LOCAL clipboard (cross-backend copy/move is out of scope v1):
 * drive supports cut/paste (move within one account), rename, delete (trash), new folder, and upload;
 * drive copy + cross-account moves are deferred. Every mutation refreshes the browser's listings
 * (`fb-list`) plus the Explorer's (`fs`) and git decorations so both views stay in sync.
 */
export function useBrowserFs() {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const clipboard = useClipboard((s) => s.clipboard);
  const setClipboard = useClipboard((s) => s.setClipboard);
  const clearClipboard = useClipboard((s) => s.clearClipboard);
  // Drive's clipboard is local + cut-only (move within one account). Kept separate from the shared
  // host clipboard so a copied host path never tries to land on Drive (and vice-versa).
  const [driveCut, setDriveCut] = useState<{ accountId: string; refs: Ref[] } | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["fb-list"] }); // the browser's tree + list
    qc.invalidateQueries({ queryKey: ["fs"] });      // keep the workspace Explorer in sync
    qc.invalidateQueries({ queryKey: ["git"] });     // refresh status colours after a change
  };
  const namesIn = (containerKey: string, showHidden: boolean) =>
    new Set((qc.getQueryData<ListCache>(["fb-list", containerKey, showHidden]) ?? []).map((e) => e.name));

  const run = async (label: string, fn: () => Promise<unknown>) => {
    try { await fn(); invalidate(); }
    catch (e) { push(`${label}: ${(e as Error).message}`); }
  };

  // --- clipboard (host = shared store with paths; drive = local cut-only) ---
  const copy = (refs: Ref[]) => {
    const paths = refs.map(hostPathOf).filter((p): p is string => p !== null);
    if (paths.length) setClipboard({ op: "copy", paths }); // host only — drive copy is deferred
  };
  const cut = (refs: Ref[]) => {
    if (refs[0]?.kind === "drive") {
      const r0 = refs[0] as Extract<Ref, { kind: "drive" }>;
      setDriveCut({ accountId: r0.accountId, refs });
      clearClipboard();
      return;
    }
    const paths = refs.map(hostPathOf).filter((p): p is string => p !== null);
    if (paths.length) { setClipboard({ op: "cut", paths }); setDriveCut(null); }
  };
  const clear = () => { clearClipboard(); setDriveCut(null); };
  const isCut = (ref: Ref) =>
    ref.kind === "drive"
      ? !!driveCut?.refs.some((r) => sameRef(r, ref))
      : clipboard?.op === "cut" && clipboard.paths.includes(ref.path);

  // Write real OS files (dropped or OS-pasted) into a HOST `container` by reading their bytes in the
  // browser and uploading — a Finder file exposes no host path. One flat file → one base64 POST;
  // multiple files or a folder tree → size-capped zip(s) unpacked server-side. Top-level names are
  // deduped so nothing already in the folder is clobbered; a folder keeps its inner structure.
  const firstSeg = (p: string) => p.split("/")[0];
  const uploadIntoHost = async (container: string, uploads: UploadFile[], showHidden: boolean) => {
    const sized = uploads.filter((u) => u.file.size <= MAX_UPLOAD_BYTES);
    const skipped = uploads.length - sized.length;
    if (sized.length) {
      const taken = namesIn(`host:${container}`, showHidden);
      const remap = new Map<string, string>();
      for (const seg of new Set(sized.map((u) => firstSeg(u.name)))) {
        const safe = dedupeName(seg, taken); taken.add(safe); remap.set(seg, safe);
      }
      const ok = sized.map((u) => ({ file: u.file, name: remap.get(firstSeg(u.name))! + u.name.slice(firstSeg(u.name).length) }));
      const single = ok.length === 1 && !ok[0].name.includes("/");
      if (!single) push(`Uploading ${ok.length} item${ok.length > 1 ? "s" : ""}…`);
      try {
        if (single) await api.fsUpload(container, ok[0].name, await fileToBase64(ok[0].file));
        else {
          for (const batch of batchBySize(ok)) await api.fsUploadZip(container, await zipUploads(batch));
          push(`Added ${ok.length} item${ok.length > 1 ? "s" : ""}`);
        }
      } catch (e) {
        push(`Upload failed: ${(e as Error).message}`);
      } finally {
        invalidate();
      }
    }
    if (skipped) push(`Skipped ${skipped} file${skipped > 1 ? "s" : ""} over ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB`);
  };

  // Upload real OS files into a DRIVE folder: each flat file PUT to Drive under the parent. Nested
  // folders aren't created on Drive (no recursive folder upload v1) — only top-level files land.
  const uploadIntoDrive = async (container: Extract<Ref, { kind: "drive" }>, uploads: UploadFile[]) => {
    const parent = driveParentId(container);
    if (!parent) { push("Upload here isn't supported — open My Drive or a folder first."); return; }
    const flat = uploads.filter((u) => !u.name.includes("/"));
    const skipped = uploads.length - flat.length;
    if (!flat.length) { if (skipped) push("Folder upload to Drive isn't supported yet — drop files."); return; }
    push(`Uploading ${flat.length} file${flat.length > 1 ? "s" : ""}…`);
    try {
      for (const u of flat) await api.driveUpload(container.accountId, parent, u.name, u.file);
      push(`Added ${flat.length} file${flat.length > 1 ? "s" : ""}`);
    } catch (e) {
      push(`Upload failed: ${(e as Error).message}`);
    } finally {
      invalidate();
    }
    if (skipped) push("Folders weren't uploaded — Drive upload takes files only.");
  };

  // Desktop-style Paste into a HOST `container`. Local: ask the server to recursively cp whatever
  // files/folders are on the host OS clipboard (instant, no size cap). If it holds no files (e.g. a
  // copied screenshot), fall back to byte-uploading any browser-surfaced files. Remote: browser only.
  const desktopPaste = async (container: string, browserFiles: File[], showHidden = false) => {
    if (isLocalHost) {
      try {
        const { pasted } = await api.fsPasteClipboard(container);
        if (pasted.length) { invalidate(); return; }
      } catch (e) {
        if (!browserFiles.length) { push(`Paste failed: ${(e as Error).message}`); return; }
      }
    }
    if (browserFiles.length) await uploadIntoHost(container, browserFiles.map((f) => ({ name: f.name, file: f })), showHidden);
  };

  // Drop OS files into a folder ref (host → byte-upload/zip; drive → per-file Drive upload).
  const dropUpload = async (dt: DataTransfer, container: Ref, showHidden: boolean) => {
    const uploads = await collectUploads(dt);
    if (container.kind === "host") return uploadIntoHost(container.path, uploads, showHidden);
    return uploadIntoDrive(container, uploads);
  };
  // Programmatic drive upload (a FileList chosen via a picker, not a DnD DataTransfer).
  const driveUpload = (container: Extract<Ref, { kind: "drive" }>, files: File[]) =>
    uploadIntoDrive(container, files.map((f) => ({ name: f.name, file: f })));

  // The Drive parent id new items / uploads should target inside a container ref: a real folder uses
  // its fileId; the My Drive root resolves to "root"; the special read-only roots have no writable
  // parent (return null → callers disable create/upload there).
  function driveParentId(container: Extract<Ref, { kind: "drive" }>): string | null {
    if (container.fileId) return container.fileId;
    if (container.root === "myDrive") return "root";
    return null;
  }

  // Paste into `container`: host copy keeps a deduped name; host cut moves (rename) and empties the
  // clipboard; drive cut moves the cut items into the container folder via driveMove. With nothing
  // copied in-app on a host container, fall back to a desktop (OS clipboard) paste.
  const paste = (container: Ref, showHidden: boolean) => {
    if (container.kind === "drive") {
      if (!driveCut || driveCut.accountId !== container.accountId) return; // nothing to move / cross-account
      const parent = driveParentId(container);
      if (!parent) { push("Can't paste here — open My Drive or a folder."); return; }
      return run("Paste failed", async () => {
        for (const r of driveCut.refs) {
          const d = r as Extract<Ref, { kind: "drive" }>;
          if (d.fileId) await api.driveMove(d.accountId, d.fileId, { addParents: parent });
        }
        setDriveCut(null);
      });
    }
    if (!clipboard) { if (isLocalHost) void desktopPaste(container.path, [], showHidden); return; }
    return run("Paste failed", async () => {
      const taken = clipboard.op === "copy" ? namesIn(`host:${container.path}`, showHidden) : new Set<string>();
      for (const src of clipboard.paths) {
        const name = dedupeName(basename(src), taken); taken.add(name);
        const dest = join(container.path, name);
        if (clipboard.op === "copy") await api.fsCopy(src, dest);
        else await api.fsRename(src, dest);
      }
      if (clipboard.op === "cut") clearClipboard();
    });
  };

  // Duplicate is host-only (Drive has no in-place copy v1).
  const duplicate = (ref: Ref, showHidden: boolean) => {
    if (ref.kind !== "host") return;
    return run("Duplicate failed", () => {
      const dir = dirname(ref.path);
      const name = dedupeName(basename(ref.path), namesIn(`host:${dir}`, showHidden).add(basename(ref.path)));
      return api.fsCopy(ref.path, join(dir, name));
    });
  };

  // Delete: host removes; drive trashes (recoverable) — the confirm copy says so.
  const remove = (refs: Ref[]) => run("Delete failed", () => Promise.all(refs.map((r) =>
    r.kind === "host" ? api.fsDelete(r.path) : api.driveDelete(r.accountId, r.fileId!))));

  // commitEdit is the single entry the inline input commits through; empty/unchanged = no-op (cancel).
  const commitEdit = (edit: BrowserEdit, raw: string) => {
    const name = raw.trim();
    if (!name) return;
    if (edit.mode === "rename") {
      if (name === edit.name) return;
      const target = edit.ref;
      if (target.kind === "host") return run("Rename failed", () => api.fsRename(target.path, join(dirname(target.path), name)));
      return run("Rename failed", () => api.driveRename(target.accountId, target.fileId!, name));
    }
    const container = edit.container;
    if (edit.mode === "new-folder") {
      if (container.kind === "host") return run("Create folder failed", () => api.fsMkdir(join(container.path, name)));
      const parent = driveParentId(container);
      if (!parent) { push("Can't create a folder here."); return; }
      return run("Create folder failed", () => api.driveMkdir(container.accountId, parent, name));
    }
    // new-file: host only (Drive has no plain "create empty file" in this UI).
    if (container.kind !== "host") { push("New file isn't supported on Drive."); return; }
    return run("Create failed", () => api.fsCreateFile(join(container.path, name)));
  };

  // Whether the in-app clipboard can paste into a container ref: host pastes the shared clipboard (or
  // an OS-clipboard paste when local); drive pastes only when there's a cut from the SAME account.
  const canPasteInto = (container: Ref) =>
    container.kind === "drive"
      ? !!driveCut && driveCut.accountId === container.accountId
      : !!clipboard || isLocalHost;

  return {
    clipboard, copy, cut, clear, isCut, paste, duplicate, remove, commitEdit,
    desktopPaste, dropUpload, driveUpload, canPasteInto,
  };
}

export type BrowserFs = ReturnType<typeof useBrowserFs>;
