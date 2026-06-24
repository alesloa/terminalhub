import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * SHA-256 over a folder's full contents: every file's POSIX relpath then its bytes, with files
 * sorted by relpath so the digest is stable regardless of directory iteration order. Both the
 * path and the content feed the hash, so a rename, an added/removed file, or any byte change
 * shifts it. Used to tell whether a skill's folder actually changed between installs/updates.
 */
export async function computeFolderHash(dir: string): Promise<string> {
  const files = (await walk(dir, dir)).sort();
  const hash = createHash("sha256");
  for (const rel of files) {
    hash.update(rel + "\n");
    hash.update(await fs.readFile(path.join(dir, rel)));
  }
  return hash.digest("hex");
}

async function walk(dir: string, base: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue; // a clone's .git would diverge from an installed copy
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}
