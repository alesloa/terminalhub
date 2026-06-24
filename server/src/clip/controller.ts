import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

// Pasted clipboard images live in a per-terminal dir under the workspace folder; the paste inserts
// their ABSOLUTE path so the agent can read them regardless of its current cwd. A self-contained
// `.gitignore` keeps the whole `.terminalhub` tree out of git without touching the user's own
// ignore file. Cleanup is aggressive: per-terminal on close, whole-workspace on boot.
const DIR = ".terminalhub";
const CLIP = "clip";

export interface SavedClip {
  name: string;    // generated filename, e.g. "img-k3f9a1.png"
  relPath: string; // workspace-relative, posix: ".terminalhub/clip/<terminalId>/<name>"
  absPath: string; // folder + relPath
}

export interface ClipController {
  saveImage(folder: string, terminalId: string, bytes: Buffer, ext: string): SavedClip;
  clearTerminal(folder: string, terminalId: string): void;
  clearWorkspace(folder: string): void;
}

/** Keep only path-safe chars so a hostile terminalId/ext can't escape the clip dir. */
function safe(s: string, fallback: string): string {
  const cleaned = s.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return cleaned || fallback;
}

function name(ext: string): string {
  const rand = Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
  return `img-${rand}.${safe(ext, "png")}`;
}

export function createClipController(): ClipController {
  return {
    saveImage(folder, terminalId, bytes, ext) {
      // Self-contained gitignore so pasted images never show up in `git status`.
      const root = join(folder, DIR);
      mkdirSync(root, { recursive: true });
      const gi = join(root, ".gitignore");
      if (!existsSync(gi)) writeFileSync(gi, "*\n");

      const tid = safe(terminalId, "term");
      const dir = join(root, CLIP, tid);
      mkdirSync(dir, { recursive: true });

      const fname = name(ext);
      const absPath = join(dir, fname);
      writeFileSync(absPath, bytes);
      return { name: fname, relPath: `${DIR}/${CLIP}/${tid}/${fname}`, absPath };
    },
    clearTerminal(folder, terminalId) {
      rmSync(join(folder, DIR, CLIP, safe(terminalId, "term")), { recursive: true, force: true });
    },
    clearWorkspace(folder) {
      rmSync(join(folder, DIR, CLIP), { recursive: true, force: true });
    },
  };
}
