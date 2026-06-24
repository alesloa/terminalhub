import { readdir, access, readFile as fsReadFile, writeFile as fsWriteFile, stat, mkdir, rename, cp, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, basename, join, resolve, parse, sep } from "node:path";
import { platform } from "node:os";

/** On Windows, Node.js path APIs return backslash-separated paths. Convert to forward slashes
 *  so the frontend's POSIX path utilities (dirname, basename, join in web/src/lib/paths.ts) work
 *  correctly. Forward-slash paths are valid for all Node.js fs operations on Windows. */
const normPath = process.platform === "win32"
  ? (p: string) => p.replace(/\\/g, "/")
  : (p: string) => p;

export interface FsEntry { name: string; path: string; type: "dir" | "file"; readable: boolean; mtime: number; size: number; }
export interface FsListing { path: string; parent: string | null; entries: FsEntry[]; }
export interface FsFile { path: string; content?: string; binary: boolean; tooLarge: boolean; size: number; }
export interface FsFileBytes { path: string; dataBase64?: string; tooLarge: boolean; size: number; }

/** Largest file the editor will read into the browser. */
export const MAX_EDIT_BYTES = 1_048_576; // 1 MiB
/** Largest binary file (docx, etc.) the rich editors round-trip through the browser as base64. */
export const MAX_BINARY_EDIT_BYTES = 25 * 1_048_576; // 25 MiB
const BINARY_SNIFF_BYTES = 8192;

async function readable(p: string): Promise<boolean> {
  try { await access(p, constants.R_OK); return true; } catch { return false; }
}

export async function listDir(path: string, opts: { includeHidden?: boolean } = {}): Promise<FsListing> {
  // Windows virtual drives root: treat "/" as a pseudo-directory that lists all drive letters.
  // This lets the breadcrumb "/ → D: → Documents → ..." navigate all the way up to pick a drive.
  if (process.platform === "win32" && (path === "/" || path === "\\")) {
    const drives = await listVolumes();
    return {
      path: "/",
      parent: null,
      entries: drives.map(d => ({ name: d.name, path: d.path, type: "dir" as const, readable: true, mtime: 0, size: 0 })),
    };
  }

  const abs = resolve(path);
  const dirents = await readdir(abs, { withFileTypes: true });
  // stat each entry for mtime/size (powers the picker's Date-Modified / Size sort). Done in parallel
  // so a large folder doesn't serialize the syscalls; order doesn't matter since we sort below.
  const entries = (await Promise.all(dirents.map(async (d): Promise<FsEntry | null> => {
    if (!opts.includeHidden && d.name.startsWith(".")) return null; // hide dotfiles by default
    const full = join(abs, d.name);
    const type = d.isDirectory() ? "dir" : "file";
    // stat follows symlinks for mtime/size; a broken link or a race (entry vanished) → unknown (0).
    const st = await stat(full).catch(() => null);
    return {
      name: d.name, path: normPath(full), type,
      readable: type === "dir" ? await readable(full) : true,
      mtime: st ? Math.round(st.mtimeMs) : 0,
      size: st ? st.size : 0,
    };
  }))).filter((e): e is FsEntry => e !== null);
  entries.sort((a, b) =>
    a.type !== b.type ? (a.type === "dir" ? -1 : 1) : a.name.localeCompare(b.name)
  );
  const fsRoot = parse(abs).root;
  const normAbs = normPath(abs);
  // On Windows a drive root (e.g. "D:/") has no higher parent in the real filesystem, but the
  // virtual "/" above acts as the parent so users can navigate between drives.
  const isWinDriveRoot = process.platform === "win32" && normAbs === normPath(fsRoot);
  const parent = isWinDriveRoot ? "/" : abs === fsRoot ? null : normPath(dirname(abs));
  return { path: normAbs, parent, entries };
}

/** Per-OS volume roots for the picker's top level. */
export async function listVolumes(): Promise<{ name: string; path: string }[]> {
  if (platform() === "win32") {
    const vols: { name: string; path: string }[] = [];
    for (const L of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
      const p = `${L}:/`;
      try { await access(p); vols.push({ name: `${L}:`, path: p }); }
      catch { /* drive not present */ }
    }
    return vols;
  }
  const vols: { name: string; path: string }[] = [{ name: "/ (root)", path: "/" }];
  if (platform() === "darwin") {
    try {
      const mounts = await readdir("/Volumes", { withFileTypes: true });
      for (const m of mounts) if (m.isDirectory() || m.isSymbolicLink()) vols.push({ name: m.name, path: join("/Volumes", m.name) });
    } catch { /* /Volumes may not exist */ }
  } else {
    for (const base of ["/mnt", "/media", "/home"]) {
      try {
        const subs = await readdir(base, { withFileTypes: true });
        for (const s of subs) if (s.isDirectory()) vols.push({ name: `${base}/${s.name}`, path: join(base, s.name) });
      } catch { /* base may not exist */ }
    }
  }
  return vols;
}

/** Read a file for the editor. Refuses binary and oversized files (no content returned). */
export async function readFile(path: string): Promise<FsFile> {
  const abs = resolve(path);
  const nabs = normPath(abs);
  const { size } = await stat(abs);
  if (size > MAX_EDIT_BYTES) return { path: nabs, binary: false, tooLarge: true, size };
  const buf = await fsReadFile(abs);
  const binary = buf.subarray(0, BINARY_SNIFF_BYTES).includes(0);
  if (binary) return { path: nabs, binary: true, tooLarge: false, size };
  return { path: nabs, content: buf.toString("utf8"), binary: false, tooLarge: false, size };
}

/** Classify a path for the terminal link opener: "file", "dir", or "missing" (gone/unreadable). */
export async function statPath(path: string): Promise<"file" | "dir" | "missing"> {
  try {
    const s = await stat(resolve(path));
    return s.isDirectory() ? "dir" : "file";
  } catch { return "missing"; }
}

/** Write utf8 content to a file (parent dir must already exist). */
export async function writeFile(path: string, content: string): Promise<{ path: string; size: number }> {
  const abs = resolve(path);
  await fsWriteFile(abs, content, "utf8");
  return { path: normPath(abs), size: Buffer.byteLength(content, "utf8") };
}

/** Read a file's raw bytes as base64 for the rich (binary) editors. Refuses oversized files (no
 *  content returned) — mirrors readFile, but never refuses on a "binary" sniff since that's the point. */
export async function readFileBytes(path: string): Promise<FsFileBytes> {
  const abs = resolve(path);
  const { size } = await stat(abs);
  if (size > MAX_BINARY_EDIT_BYTES) return { path: normPath(abs), tooLarge: true, size };
  const buf = await fsReadFile(abs);
  return { path: normPath(abs), dataBase64: buf.toString("base64"), tooLarge: false, size };
}

/** Overwrite a file with raw bytes decoded from base64 (binary-safe, unlike writeFile's utf8). */
export async function writeFileBytes(path: string, dataBase64: string): Promise<{ path: string; size: number }> {
  const abs = resolve(path);
  const bytes = Buffer.from(dataBase64, "base64");
  await fsWriteFile(abs, bytes);
  return { path: normPath(abs), size: bytes.length };
}

/**
 * Render an HTML string to a real Word document and write it to `path`. The Word editor sends the
 * document's HTML here so generation runs on Node — html-to-docx's supported target — instead of the
 * browser (whose build needs Buffer/Blob polyfills and an IIFE shim). Loaded lazily so the dep only
 * costs anything when a .docx is actually saved.
 */
export async function writeDocxFromHtml(path: string, html: string): Promise<{ path: string; size: number }> {
  const abs = resolve(path);
  const { default: htmlToDocx } = await import("@turbodocx/html-to-docx");
  const out = await htmlToDocx(html, null, { title: basename(abs) });
  const buf = Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer);
  await fsWriteFile(abs, buf);
  return { path: normPath(abs), size: buf.length };
}

/**
 * Write a file dragged/pasted from the OS into `dir` under relative `name`. Bytes arrive
 * base64-encoded so the write is binary-safe (unlike writeFile's utf8). `name` may carry
 * subdirectories — e.g. "assets/logo.png" when a whole folder is dropped — and any missing
 * parents are created. Rejects (EACCES) a `name` that is absolute or escapes `dir` via "..".
 */
export async function writeUpload(dir: string, name: string, dataBase64: string): Promise<{ path: string; size: number }> {
  return writeBytes(dir, name, Buffer.from(dataBase64, "base64"));
}

/** Write raw bytes into `dir` under relative `name`, creating missing parents. Rejects (EACCES) a
 *  `name` that is absolute or escapes `dir` via "..". Shared by base64 upload and zip extraction. */
export async function writeBytes(dir: string, name: string, bytes: Uint8Array): Promise<{ path: string; size: number }> {
  const segs = name.split("/").filter(Boolean);
  if (name.startsWith("/") || segs.includes("..") || segs.length === 0) {
    const e: any = new Error("invalid upload name"); e.code = "EACCES"; throw e;
  }
  const base = resolve(dir);
  const abs = resolve(join(base, segs.join("/")));
  if (abs !== base && !abs.startsWith(base + sep)) { const e: any = new Error("escapes target dir"); e.code = "EACCES"; throw e; }
  await mkdir(dirname(abs), { recursive: true });
  await fsWriteFile(abs, bytes);
  return { path: normPath(abs), size: bytes.length };
}

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

/** Create an empty file. Fails (EEXIST) rather than clobbering an existing path. */
export async function createFile(path: string): Promise<{ path: string }> {
  const abs = resolve(path);
  await fsWriteFile(abs, "", { encoding: "utf8", flag: "wx" }); // wx → fail if it already exists
  return { path: normPath(abs) };
}

/** Create a directory. Fails (EEXIST) if the path already exists. */
export async function createDir(path: string): Promise<{ path: string }> {
  const abs = resolve(path);
  await mkdir(abs); // non-recursive → throws EEXIST when present
  return { path: normPath(abs) };
}

/** Rename/move a path. Refuses to overwrite an existing destination. */
export async function renamePath(from: string, to: string): Promise<{ path: string }> {
  const src = resolve(from), dst = resolve(to);
  if (src === dst) return { path: normPath(dst) };
  if (await exists(dst)) { const e: any = new Error("destination exists"); e.code = "EEXIST"; throw e; }
  await rename(src, dst);
  return { path: normPath(dst) };
}

/** Copy a file or directory (recursive). Refuses to overwrite an existing destination. */
export async function copyPath(from: string, to: string): Promise<{ path: string }> {
  const src = resolve(from), dst = resolve(to);
  await cp(src, dst, { recursive: true, errorOnExist: true, force: false });
  return { path: normPath(dst) };
}

/** "report.txt" with {report.txt} taken → "report copy.txt", then "report copy 2.txt". Mirrors the
 *  client-side dedupe so a clipboard paste names collisions exactly like the tree's Copy/Paste. */
function dedupeName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const [b, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  let candidate = `${b} copy${ext}`;
  for (let n = 2; taken.has(candidate); n++) candidate = `${b} copy ${n}${ext}`;
  return candidate;
}

/**
 * Desktop-style Paste: copy each source path (a file OR folder, recursively) into `dir`, deduping
 * top-level names so nothing is clobbered. This is the local "real cp" path behind Cmd+V — sources
 * come from the host OS clipboard, so we copy by path (no byte upload, no size limit, folders and
 * multi-selections intact). A source that can't be copied (gone, unreadable, or a parent of `dir`)
 * is skipped so one bad entry doesn't sink the whole paste. Returns the created destination paths.
 */
export async function pasteClipboardInto(dir: string, sources: string[]): Promise<{ pasted: string[] }> {
  const base = resolve(dir);
  const taken = new Set<string>(await readdir(base).catch(() => [] as string[]));
  const pasted: string[] = [];
  for (const src of sources) {
    const from = resolve(src);
    // Never copy a folder into itself or one of its own descendants (would recurse / corrupt).
    if (from === base || base.startsWith(from + sep)) continue;
    const name = dedupeName(basename(from), taken);
    taken.add(name);
    const dst = join(base, name);
    try {
      await cp(from, dst, { recursive: true, errorOnExist: true, force: false });
      pasted.push(normPath(dst));
    } catch { /* source vanished or unreadable — skip it, keep pasting the rest */ }
  }
  return { pasted };
}

/** Delete a file or directory (recursive). No-op if already gone. */
export async function deletePath(path: string): Promise<{ path: string }> {
  const abs = resolve(path);
  await rm(abs, { recursive: true, force: true });
  return { path: normPath(abs) };
}
