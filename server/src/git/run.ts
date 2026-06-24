import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import { resolve } from "node:path";

const pexec = promisify(execFile);

export interface GitResult {
  stdout: string;
  stderr: string;
  code: number; // process exit code; 0 = success
}

/**
 * Runs `git <args>` in `cwd`. Returns stdout/stderr/code instead of throwing on a
 * non-zero exit, because git uses exit codes as data (e.g. `diff` exits 1 when there
 * are differences). Callers decide what a non-zero code means. A missing git binary
 * surfaces as code -1 with the ENOENT message in stderr — see gitInstalled().
 *
 * Runner abstraction so tests can inject a fake (mirrors TmuxRunner).
 *
 * `env` overlays the spawn environment for this one call — used to inject GH_TOKEN/GH_HOST so a
 * network op (fetch/pull/push) authenticates as a SPECIFIC signed-in GitHub account (via gh's git
 * credential helper) instead of the globally-active one, without `gh auth switch`.
 */
export type GitRunner = (args: string[], cwd: string, env?: Record<string, string>) => Promise<GitResult>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Chains async tasks per key so two with the same key never overlap; different keys run free.
 * Used to serialize git per repo — git's index is a single-writer (`.git/index.lock`), so two
 * index-touching commands in the same repo at once make one fail with "Unable to create
 * index.lock: File exists". The Map entry is dropped once a key goes idle (no unbounded growth).
 */
export function perKeyQueue() {
  const tails = new Map<string, Promise<unknown>>();
  return function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = tails.get(key) ?? Promise.resolve();
    const next = prev.then(task, task); // run regardless of how the previous task settled
    tails.set(key, next);
    const settle = () => { if (tails.get(key) === next) tails.delete(key); };
    next.then(settle, settle);
    return next;
  };
}

/** A result that failed specifically because git's index lock was already held. */
const isLockError = (r: GitResult) =>
  r.code !== 0 && /index\.lock/i.test(r.stderr) && /File exists/i.test(r.stderr);

/**
 * Run `exec` and, if it fails only because `.git/index.lock` is momentarily held by ANOTHER git
 * process (an agent committing in one of the room's terminals, say), wait and retry a few times —
 * the lock is held for milliseconds, so a short bounded retry rides it out instead of surfacing
 * git's scary "another git process seems to be running" error for a transient collision. Any other
 * failure returns immediately. `wait` is injectable so tests don't actually sleep.
 */
export async function retryOnLock(
  exec: () => Promise<GitResult>, tries = 3, delayMs = 120, wait: (ms: number) => Promise<unknown> = sleep,
): Promise<GitResult> {
  let last: GitResult = { stdout: "", stderr: "", code: -1 };
  for (let i = 0; i < tries; i++) {
    if (i) await wait(delayMs);
    last = await exec();
    if (!isLockError(last)) return last;
  }
  return last;
}

async function execGit(args: string[], cwd: string, extraEnv?: Record<string, string>): Promise<GitResult> {
  // GIT_OPTIONAL_LOCKS=0: never take index.lock just to opportunistically refresh stat info — that's
  //   what let the frequent status poll collide with a concurrent stage/commit. (How IDEs poll git.)
  // GIT_TERMINAL_PROMPT=0: a missing credential fails fast instead of hanging the serialized queue.
  // extraEnv (e.g. GH_TOKEN/GH_HOST) overlays last so a network op can authenticate as a chosen account.
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", ...extraEnv };
  try {
    const { stdout, stderr } = await pexec("git", args, { cwd, maxBuffer: 32 * 1024 * 1024, env });
    return { stdout, stderr, code: 0 };
  } catch (err: any) {
    // execFile rejects on non-zero exit (err.code = numeric exit) AND on spawn failure
    // (err.code = "ENOENT" when git isn't installed). Normalize both into a GitResult.
    const code = typeof err?.code === "number" ? err.code : -1;
    return { stdout: err?.stdout ?? "", stderr: err?.stderr ?? String(err?.message ?? err), code };
  }
}

/** Absolute path to where this repo's `index.lock` lives — worktree-safe (git resolves the real gitdir). */
async function indexLockPath(cwd: string): Promise<string | null> {
  const r = await execGit(["rev-parse", "--git-path", "index.lock"], cwd);
  const p = r.stdout.trim();
  return r.code === 0 && p ? resolve(cwd, p) : null;
}

/**
 * Does a LIVE process hold `lockPath` open? `lsof` is the precise "is the lock's creator still alive"
 * signal on macOS + Linux: it lists open file handles, so a lock a running git (even one stalled in a
 * slow pre-commit hook) is holding shows up, while a leftover from a crashed git shows nothing. We
 * deliberately fail SAFE — if lsof is missing or errors in any way other than its clean "nobody has
 * it open" exit, we report `true` (held) so a lock we can't prove is orphaned is never removed.
 */
async function lockHeld(lockPath: string): Promise<boolean> {
  try {
    const { stdout } = await pexec("lsof", ["--", lockPath], { maxBuffer: 1 << 20 });
    return stdout.trim().length > 0;
  } catch (err: any) {
    // lsof exits 1 with no output when NO process has the file open → the lock is an orphan.
    if (err?.code === 1 && !String(err?.stdout ?? "").trim()) return false;
    return true; // lsof absent / any other error → can't prove orphaned, so treat as held.
  }
}

/** Filesystem/probe ops the stale-lock recovery needs, injected so tests can fake them. */
export interface LockIo {
  path: (cwd: string) => Promise<string | null>;                              // this repo's index.lock path
  held: (lockPath: string) => Promise<boolean>;                               // a live process holds it?
  stat: (lockPath: string) => Promise<{ ino: number; mtimeMs: number } | null>; // null = absent
  remove: (lockPath: string) => Promise<void>;
}

const realLockIo: LockIo = {
  path: indexLockPath,
  held: lockHeld,
  async stat(p) { try { const s = await fs.stat(p); return { ino: s.ino, mtimeMs: s.mtimeMs }; } catch { return null; } },
  remove: (p) => fs.unlink(p),
};

/**
 * Reclaim a STALE `index.lock` — the leftover of a git that crashed without releasing it, which
 * otherwise blocks every future write until the user deletes `.git/index.lock` by hand. Safety gates,
 * all required: the lock exists, NO live process holds it open (lockHeld via lsof), and it's the exact
 * same file we just inspected (re-stat by inode+mtime) so we can't race-delete a fresh lock a new git
 * just created. A lock a live git legitimately holds (e.g. a slow pre-commit hook) is left untouched.
 * Returns whether a lock was removed (⇒ the caller should retry the command). Injectable `io` for tests.
 */
export async function reclaimStaleIndexLock(cwd: string, io: LockIo = realLockIo): Promise<boolean> {
  const lockPath = await io.path(cwd);
  if (!lockPath) return false;
  const before = await io.stat(lockPath);
  if (!before) return false;                  // already gone — nothing to reclaim
  if (await io.held(lockPath)) return false;  // a live process owns it — must not touch
  const after = await io.stat(lockPath);
  if (!after || after.ino !== before.ino || after.mtimeMs !== before.mtimeMs) return false; // changed under us
  try { await io.remove(lockPath); return true; } catch { return false; }
}

/**
 * Full lock handling for one git command: ride out a transient lock (retryOnLock); if it's STILL
 * stuck and the lock turns out to be a stale orphan, reclaim it and run once more. `io`/`retry` are
 * injectable so tests don't shell out or sleep.
 */
export async function withStaleLockRecovery(
  cwd: string,
  exec: () => Promise<GitResult>,
  io: LockIo = realLockIo,
  retry: (e: () => Promise<GitResult>) => Promise<GitResult> = (e) => retryOnLock(e),
): Promise<GitResult> {
  const r = await retry(exec);
  if (!isLockError(r)) return r;
  if (await reclaimStaleIndexLock(cwd, io)) return retry(exec);
  return r;
}

const queue = perKeyQueue();

/**
 * Real git runner. Per-`cwd` serialization keeps two of OUR commands off the same repo's index at
 * once; `retryOnLock` rides out a lock briefly held by an external git; if a lock is still stuck after
 * that, `withStaleLockRecovery` deletes it and retries ONLY when it's a confirmed orphan (a crashed
 * git left it; nothing live holds it). The env hardening (GIT_OPTIONAL_LOCKS / GIT_TERMINAL_PROMPT)
 * stops the status poll grabbing the lock and stops credential prompts hanging the queue. Together
 * they kill the "Unable to create index.lock" errors — including the stale-lock case that needed a
 * manual `rm .git/index.lock` before.
 */
export const realRunner: GitRunner = (args, cwd, env) =>
  queue(cwd, () => withStaleLockRecovery(cwd, () => execGit(args, cwd, env)));
