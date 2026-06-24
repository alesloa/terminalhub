import type { GitStatus } from "../api/types";
import { relativeTo } from "./paths";

/** A file's git state, mapped to a colour + single-letter badge like VS Code / Zed. */
export type GitCat = "modified" | "added" | "untracked" | "deleted" | "conflict";

const STYLE: Record<GitCat, { className: string; letter: string }> = {
  modified:  { className: "text-[#e2c08d]", letter: "M" }, // gold
  added:     { className: "text-success", letter: "A" }, // green
  untracked: { className: "text-success", letter: "U" }, // green
  deleted:   { className: "text-[#c74e39]", letter: "D" }, // red
  conflict:  { className: "text-[#e4676b]", letter: "!" }, // red
};
// When a folder holds files of mixed state, the highest-priority colour wins.
const PRIORITY: Record<GitCat, number> = { conflict: 5, modified: 4, deleted: 3, added: 2, untracked: 1 };

export interface Deco { className: string; letter?: string; dim?: boolean }
export interface Decorations { forPath(absPath: string, isDir: boolean): Deco | null }

const NONE: Decorations = { forPath: () => null };
export const noDecorations = NONE;

/**
 * Pre-index a workspace's git status + ignore list into a fast per-path lookup. File rows get
 * their own colour + badge; folder rows inherit the strongest colour among their descendants;
 * anything under a gitignored path is dimmed. Returns a no-op lookup when there's no status.
 */
export function buildDecorations(status: GitStatus | undefined, ignored: string[] | undefined, root: string): Decorations {
  if (!status && !ignored?.length) return NONE;

  const fileCat = new Map<string, GitCat>();
  const dirCat = new Map<string, GitCat>();
  const ignoredSet = new Set(ignored ?? []);

  if (status) {
    for (const p of status.untracked) fileCat.set(p, "untracked");
    const codes = new Map<string, string>();
    const add = (p: string, c: string) => codes.set(p, (codes.get(p) ?? "") + c);
    for (const e of status.staged) add(e.path, e.index);
    for (const e of status.unstaged) add(e.path, e.worktree);
    for (const [p, c] of codes) fileCat.set(p, c.includes("D") ? "deleted" : c.includes("A") ? "added" : "modified");
    for (const e of status.conflicted) fileCat.set(e.path, "conflict");

    for (const [p, cat] of fileCat) {
      const parts = p.split("/");
      for (let i = 1; i < parts.length; i++) {
        const dir = parts.slice(0, i).join("/");
        const cur = dirCat.get(dir);
        if (!cur || PRIORITY[cat] > PRIORITY[cur]) dirCat.set(dir, cat);
      }
    }
  }

  const isIgnored = (rel: string): boolean => {
    if (ignoredSet.has(rel)) return true;
    const parts = rel.split("/");
    for (let i = 1; i < parts.length; i++) if (ignoredSet.has(parts.slice(0, i).join("/"))) return true;
    return false;
  };

  return {
    forPath(absPath, isDir) {
      const rel = relativeTo(absPath, root);
      if (rel === absPath) return null; // not under the repo root
      if (isIgnored(rel)) return { className: "text-dim", dim: true };
      const cat = isDir ? dirCat.get(rel) : fileCat.get(rel);
      if (!cat) return null;
      const s = STYLE[cat];
      return { className: s.className, letter: isDir ? undefined : s.letter };
    },
  };
}
