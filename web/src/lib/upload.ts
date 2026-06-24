// Pure browser-side helpers for turning a paste/drop into uploadable files. No React, no network —
// the explorer hook (useExplorerMenu) consumes these and POSTs them via api.fsUpload / fsUploadZip.
import { zipSync } from "fflate";

/** One file to upload; `name` is its path relative to the drop target (carries "/" for a dropped
 *  folder's nested files, e.g. "logos/icon.png"). */
export interface UploadFile { name: string; file: File; }

/** Decoded cap per file — mirrors MAX_UPLOAD_BYTES on the server (server/src/routes/fs.ts). */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/** Cap per zipped batch (raw archive bytes) — mirrors MAX_ZIP_BYTES on the server. */
export const MAX_ZIP_BYTES = 100 * 1024 * 1024;

/** Drain a directory reader — readEntries yields in batches and returns [] once exhausted. */
function readAll(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const pump = () => reader.readEntries((batch) => {
      if (!batch.length) return resolve(all);
      all.push(...batch);
      pump();
    }, reject);
    pump();
  });
}

/** Recurse a dropped entry into flat files, prefixing each name with its folder path. */
async function walk(entry: FileSystemEntry, prefix: string, out: UploadFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    out.push({ name: prefix + entry.name, file });
  } else if (entry.isDirectory) {
    const children = await readAll((entry as FileSystemDirectoryEntry).createReader());
    for (const c of children) await walk(c, prefix + entry.name + "/", out);
  }
}

/**
 * Flatten a drop's DataTransfer into a list of files. Walks the webkitGetAsEntry tree so dropped
 * FOLDERS come through (recursively), falling back to the flat `files` list when that API is
 * unavailable. Entries are grabbed synchronously — the DataTransferItemList empties the instant the
 * drop handler returns — so callers must pass `dt` straight from the event with no prior await.
 */
export async function collectUploads(dt: DataTransfer): Promise<UploadFile[]> {
  const entries = Array.from(dt.items)
    .filter((i) => i.kind === "file")
    .map((i) => i.webkitGetAsEntry?.() ?? null);
  if (entries.some(Boolean)) {
    const out: UploadFile[] = [];
    for (const e of entries) if (e) await walk(e, "", out);
    return out;
  }
  return Array.from(dt.files).map((f) => ({ name: f.name, file: f }));
}

/** Base64-encode a File's bytes (without the data: prefix) for api.fsUpload. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((typeof r.result === "string" ? r.result : "").split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Split uploads into batches whose total bytes stay under `cap`, so each zipped archive fits the
 *  server's limit. A single file is always under MAX_UPLOAD_BYTES (< cap), so it never splits. */
export function batchBySize(uploads: UploadFile[], cap: number = MAX_ZIP_BYTES): UploadFile[][] {
  const batches: UploadFile[][] = [[]];
  let cur = 0;
  for (const u of uploads) {
    if (cur > 0 && cur + u.file.size > cap) { batches.push([]); cur = 0; }
    batches[batches.length - 1].push(u);
    cur += u.file.size;
  }
  return batches.filter(b => b.length);
}

/** Zip a batch of files (names carry subpaths) into one archive for api.fsUploadZip. Synchronous so
 *  there's no worker-bundling surprise; a typical folder is a few MB and zips imperceptibly. */
export async function zipUploads(uploads: UploadFile[]): Promise<Uint8Array> {
  const data: Record<string, Uint8Array> = {};
  for (const u of uploads) data[u.name] = new Uint8Array(await u.file.arrayBuffer());
  return zipSync(data, { level: 6 });
}
