import { watch, type FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

export interface FileChange {
  /** mtime in ms (0 when the file is gone). */
  mtimeMs: number;
  /** byte size (0 when the file is gone). */
  size: number;
  /** false when the file no longer exists on disk. */
  exists: boolean;
}

export interface WatchFileOpts {
  /** Coalesce bursts of fs.watch events into one stat (ms). */
  debounceMs?: number;
  /** Slow fallback poll in case fs.watch misses an event (ms). */
  pollMs?: number;
}

/**
 * Watch a SINGLE file for content changes — external edits, an agent writing to it, or the
 * temp-file + atomic-rename pattern most editors/tools use. `onChange` fires whenever the file's
 * (mtime, size) signature differs from the last reported one, never for the initial state. Survives
 * the rename pattern by watching the parent directory and filtering to the basename, with a slow
 * poll as a safety net for platforms/filesystems where fs.watch under-reports. Returns a `stop()`
 * that tears everything down.
 */
export function watchFile(
  filePath: string,
  onChange: (change: FileChange) => void,
  { debounceMs = 150, pollMs = 1_000 }: WatchFileOpts = {},
): () => void {
  const abs = path.resolve(filePath);
  const dir = path.dirname(abs);
  const base = path.basename(abs);

  let last = "";            // last reported (mtime:size) signature, "gone" when absent
  let primed = false;       // first check records the signature without emitting
  let checking = false;     // serialize stat()s so a burst can't overlap
  let stopped = false;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let watcher: FSWatcher | undefined;

  const sig = (s: { mtimeMs: number; size: number } | null) => (s ? `${s.mtimeMs}:${s.size}` : "gone");

  async function check() {
    if (checking || stopped) return;
    checking = true;
    try {
      let s: { mtimeMs: number; size: number } | null = null;
      try { s = await stat(abs); } catch { s = null; }
      const cur = sig(s);
      if (!primed) { primed = true; last = cur; return; } // never emit the initial state
      if (cur === last) return;
      last = cur;
      onChange(s ? { mtimeMs: s.mtimeMs, size: s.size, exists: true } : { mtimeMs: 0, size: 0, exists: false });
    } finally {
      checking = false;
    }
  }

  const schedule = () => {
    if (debounce || stopped) return;
    debounce = setTimeout(() => { debounce = undefined; void check(); }, debounceMs);
  };

  try {
    watcher = watch(dir, (_evt, filename) => {
      // Some platforms omit the filename; fall through and let the stat decide.
      if (filename == null || filename === base) schedule();
    });
    watcher.on("error", () => { try { watcher?.close(); } catch { /* already closed */ } });
  } catch {
    // dir may not exist yet — the poll still covers it.
  }

  timer = setInterval(() => { void check(); }, pollMs);
  void check(); // prime the signature immediately

  return () => {
    stopped = true;
    if (debounce) clearTimeout(debounce);
    if (timer) clearInterval(timer);
    try { watcher?.close(); } catch { /* already closed */ }
  };
}
