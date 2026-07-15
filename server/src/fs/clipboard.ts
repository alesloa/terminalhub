import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { platform } from "node:os";

const run = promisify(execFile);
const MAX_BUFFER = 8 * 1024 * 1024;

// JXA reader for the macOS pasteboard. Unions the legacy NSFilenamesPboardType (a plist of POSIX
// path strings that Finder always sets — and which includes folders) with public.file-url NSURLs,
// deduped. Prints a JSON array of absolute paths to stdout. Validated against a Finder-style copy.
const MAC_READER =
  'ObjC.import("AppKit");var pb=$.NSPasteboard.generalPasteboard;var set={},out=[];' +
  'function add(p){if(p&&!set[p]){set[p]=1;out.push(p)}}' +
  'var pl=pb.propertyListForType("NSFilenamesPboardType");' +
  'if(pl&&!pl.isNil()){var a=ObjC.deepUnwrap(pl);if(Array.isArray(a))a.forEach(add)}' +
  'var it=pb.readObjectsForClassesOptions($.NSArray.arrayWithObject($.NSURL.class),$());' +
  'if(it&&!it.isNil()){for(var i=0;i<it.count;i++){var u=it.objectAtIndex(i);if(u.isFileURL)add(ObjC.unwrap(u.path))}}' +
  'JSON.stringify(out);';

/** Parse the JXA reader's JSON output into a string[] (defensive against any non-array/garbage). */
export function parseJsonPaths(stdout: string): string[] {
  try {
    const v = JSON.parse(stdout.trim() || "[]");
    return Array.isArray(v) ? v.filter((p): p is string => typeof p === "string" && p.length > 0) : [];
  } catch { return []; }
}

/** Turn a `text/uri-list` clipboard payload (X11/Wayland) into absolute paths — file:// URIs only,
 *  percent-decoded, comments/blank lines dropped. */
export function uriListToPaths(text: string): string[] {
  return text.split(/\r?\n/).map(l => l.trim())
    .filter(l => l && !l.startsWith("#") && l.startsWith("file://"))
    .map(l => { try { return decodeURIComponent(new URL(l).pathname); } catch { return ""; } })
    .filter(Boolean);
}

// JXA writer for the macOS pasteboard — the mirror of MAC_READER. Sets the legacy
// NSFilenamesPboardType (a plist of POSIX path strings): the type Finder writes on Copy and reads on
// Paste, and the one that carries MULTIPLE files + folders at once (public.file-url only exposes a
// single URL). The path list is embedded as a JSON literal — JSON is a subset of JS, so it parses as
// an array of strings, and JSON escaping makes it injection-safe (a quote/backslash in a path can't
// break out of the script). execFile passes the whole script as one argv, so there's no shell to
// escape either. Round-trip verified against MAC_READER (file + folder both come back).
export function macWriteScript(paths: string[]): string {
  return "ObjC.import('AppKit');var pb=$.NSPasteboard.generalPasteboard;var T='NSFilenamesPboardType';" +
    "pb.declareTypesOwner($.NSArray.arrayWithObject($(T)),$());var m=$.NSMutableArray.alloc.init;" +
    "var ps=" + JSON.stringify(paths) + ";ps.forEach(function(p){m.addObject($(p))});" +
    "pb.setPropertyListForType(m,T);";
}

/**
 * Put files/folders onto the host OS clipboard as a Finder/Explorer "Copy", so a native Cmd/Ctrl+V
 * in Finder pastes the REAL files (recursively — whole folders and multi-selections). The mirror of
 * `readClipboardFiles`. macOS only for now (writes NSFilenamesPboardType via JXA); returns false on
 * any other platform or if the tooling fails — best-effort, never throws. Caller owns the local-only
 * gate: writing the host clipboard is only meaningful when the browser and host are the same machine.
 */
export async function writeClipboardFiles(paths: string[]): Promise<boolean> {
  const clean = paths.filter((p): p is string => typeof p === "string" && p.length > 0);
  if (!clean.length) return false;
  try {
    if (platform() === "darwin") {
      await run("osascript", ["-l", "JavaScript", "-e", macWriteScript(clean)], { maxBuffer: MAX_BUFFER });
      return true;
    }
    return false; // Linux/Windows file-manager clipboard write not wired up yet
  } catch {
    return false;
  }
}

async function readLinuxClipboardFiles(): Promise<string[]> {
  // Wayland first, then X11. Both expose copied files as file:// URIs under the text/uri-list target.
  const tries: [string, string[]][] = [
    ["wl-paste", ["--no-newline", "--type", "text/uri-list"]],
    ["xclip", ["-selection", "clipboard", "-t", "text/uri-list", "-o"]],
  ];
  for (const [cmd, argv] of tries) {
    try {
      const { stdout } = await run(cmd, argv, { maxBuffer: MAX_BUFFER });
      const paths = uriListToPaths(stdout);
      if (paths.length) return paths;
    } catch { /* tool missing or clipboard empty — try the next */ }
  }
  return [];
}

/**
 * Absolute paths of the files/folders currently on the host OS clipboard (a Finder/Explorer
 * "Copy"). Empty when the clipboard holds no files, or the platform/tooling can't read it. macOS
 * (osascript/JXA) and Linux (wl-paste/xclip) only. Caller is responsible for the local-only gate —
 * reading the host clipboard is only meaningful when the browser and the host are the same machine.
 */
export async function readClipboardFiles(): Promise<string[]> {
  try {
    if (platform() === "darwin") {
      const { stdout } = await run("osascript", ["-l", "JavaScript", "-e", MAC_READER], { maxBuffer: MAX_BUFFER });
      return parseJsonPaths(stdout);
    }
    if (platform() === "linux") return await readLinuxClipboardFiles();
    return [];
  } catch { return []; }
}
