import { unzipSync } from "fflate";
import { join, resolve } from "node:path";
import { writeBytes } from "./browser.js";

/**
 * Extract a zip archive into `dir`, writing each file under its archive-relative path (subdirs
 * created as needed). This is the remote folder / multi-file upload path: the browser zips the
 * dropped tree (or pasted files) into ONE request and the server unpacks it here — so a deep folder
 * over a slow VPS link is a single round-trip instead of N. Directory entries and any name that
 * tries to escape `dir` are skipped. Returns the top-level paths created (for invalidation/feedback)
 * and the file count.
 */
export async function extractZipInto(dir: string, archive: Uint8Array): Promise<{ pasted: string[]; files: number }> {
  const entries = unzipSync(archive);
  const base = resolve(dir);
  const tops = new Set<string>();
  let files = 0;
  for (const name of Object.keys(entries)) {
    if (name.endsWith("/")) continue; // directory entry — parents are created on demand by writeBytes
    try {
      await writeBytes(dir, name, entries[name]); // traversal-guarded + mkdirs parents
      tops.add(join(base, name.split("/")[0]));
      files++;
    } catch { /* an entry that escapes the dir or fails to write — skip it, keep going */ }
  }
  return { pasted: [...tops], files };
}
