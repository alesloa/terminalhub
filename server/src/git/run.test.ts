import { describe, it, expect } from "vitest";
import { perKeyQueue, retryOnLock, reclaimStaleIndexLock, withStaleLockRecovery } from "./run.js";
import type { GitResult, LockIo } from "./run.js";

const ok = (stdout = ""): GitResult => ({ stdout, stderr: "", code: 0 });
const lockErr = (): GitResult => ({
  stdout: "",
  stderr: "fatal: Unable to create '/x/.git/index.lock': File exists.\n",
  code: 128,
});
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("perKeyQueue", () => {
  it("serializes tasks for the same key — the second never overlaps the first", async () => {
    const q = perKeyQueue();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });

    const first = q("repo", async () => { order.push("1-start"); await gate; order.push("1-end"); });
    const second = q("repo", async () => { order.push("2-start"); });

    await flush();
    expect(order).toEqual(["1-start"]); // second is queued, hasn't started

    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["1-start", "1-end", "2-start"]);
  });

  it("runs different keys concurrently", async () => {
    const q = perKeyQueue();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });

    const a = q("repoA", async () => { order.push("A-start"); await gate; order.push("A-end"); });
    const b = q("repoB", async () => { order.push("B-start"); });

    await b; // B finishes while A is still blocked on the gate
    expect(order).toContain("B-start");
    expect(order).not.toContain("A-end");

    release();
    await a;
  });
});

describe("retryOnLock", () => {
  const noWait = async () => {};

  it("returns the first result when it succeeds (no retry)", async () => {
    let calls = 0;
    const r = await retryOnLock(async () => { calls++; return ok("done"); }, 3, 0, noWait);
    expect(r.stdout).toBe("done");
    expect(calls).toBe(1);
  });

  it("retries past a transient index.lock and returns the eventual success", async () => {
    let calls = 0;
    const r = await retryOnLock(async () => { calls++; return calls < 3 ? lockErr() : ok("staged"); }, 3, 0, noWait);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("staged");
    expect(calls).toBe(3);
  });

  it("gives up after the cap, returning the last lock error", async () => {
    let calls = 0;
    const r = await retryOnLock(async () => { calls++; return lockErr(); }, 3, 0, noWait);
    expect(r.code).toBe(128);
    expect(r.stderr).toMatch(/index\.lock/);
    expect(calls).toBe(3);
  });

  it("does NOT retry a non-lock failure", async () => {
    let calls = 0;
    const r = await retryOnLock(async () => { calls++; return { stdout: "", stderr: "fatal: bad pathspec\n", code: 128 }; }, 3, 0, noWait);
    expect(calls).toBe(1);
    expect(r.stderr).toMatch(/bad pathspec/);
  });
});

/** Fake LockIo. `held` = a live process holds the lock; `stats` is consumed per stat() call (defaults
 *  to a stable file present both times); `path` undefined ⇒ a normal resolved path. Records removals. */
function ioFake(opts: { held?: boolean; stats?: (({ ino: number; mtimeMs: number }) | null)[]; path?: string | null } = {}) {
  const removed: string[] = [];
  let pathCalls = 0;
  let si = 0;
  const stats = opts.stats ?? [{ ino: 1, mtimeMs: 1 }, { ino: 1, mtimeMs: 1 }];
  const io: LockIo = {
    path: async () => { pathCalls++; return opts.path === undefined ? "/r/.git/index.lock" : opts.path; },
    held: async () => opts.held ?? false,
    stat: async () => stats[Math.min(si++, stats.length - 1)],
    remove: async (p) => { removed.push(p); },
  };
  return { io, removed, pathCalls: () => pathCalls };
}

describe("reclaimStaleIndexLock", () => {
  it("removes an orphaned lock that no live process holds", async () => {
    const { io, removed } = ioFake({ held: false });
    expect(await reclaimStaleIndexLock("/r", io)).toBe(true);
    expect(removed).toEqual(["/r/.git/index.lock"]);
  });

  it("leaves a lock a live process is holding (would corrupt the index)", async () => {
    const { io, removed } = ioFake({ held: true });
    expect(await reclaimStaleIndexLock("/r", io)).toBe(false);
    expect(removed).toEqual([]);
  });

  it("is a no-op when there is no lock file", async () => {
    const { io, removed } = ioFake({ stats: [null] });
    expect(await reclaimStaleIndexLock("/r", io)).toBe(false);
    expect(removed).toEqual([]);
  });

  it("aborts if the lock changed under it (a new lock appeared between checks)", async () => {
    const { io, removed } = ioFake({ held: false, stats: [{ ino: 1, mtimeMs: 1 }, { ino: 2, mtimeMs: 9 }] });
    expect(await reclaimStaleIndexLock("/r", io)).toBe(false);
    expect(removed).toEqual([]);
  });

  it("returns false when the lock path can't be resolved", async () => {
    const { io, removed } = ioFake({ path: null });
    expect(await reclaimStaleIndexLock("/r", io)).toBe(false);
    expect(removed).toEqual([]);
  });
});

describe("withStaleLockRecovery", () => {
  const passthru = (e: () => Promise<GitResult>) => e(); // no real retry/sleep
  const execSeq = (results: Partial<GitResult>[]) => {
    let calls = 0;
    const exec = async (): Promise<GitResult> => {
      const r = results[Math.min(calls, results.length - 1)];
      calls++;
      return { stdout: "", stderr: "", code: 0, ...r };
    };
    return { exec, calls: () => calls };
  };

  it("returns success without probing the lock at all", async () => {
    const { exec, calls } = execSeq([{ stdout: "staged" }]);
    const { io, pathCalls } = ioFake();
    const r = await withStaleLockRecovery("/r", exec, io, passthru);
    expect(r.stdout).toBe("staged");
    expect(calls()).toBe(1);
    expect(pathCalls()).toBe(0); // never looked for a lock — nothing failed
  });

  it("surfaces a non-lock error unchanged and never touches the lock", async () => {
    const { exec } = execSeq([{ code: 128, stderr: "fatal: bad pathspec\n" }]);
    const { io, pathCalls, removed } = ioFake();
    const r = await withStaleLockRecovery("/r", exec, io, passthru);
    expect(r.stderr).toMatch(/bad pathspec/);
    expect(pathCalls()).toBe(0);
    expect(removed).toEqual([]);
  });

  it("reclaims a stale lock, then retries the command to success", async () => {
    const { exec, calls } = execSeq([lockErr(), ok("staged")]);
    const { io, removed } = ioFake({ held: false });
    const r = await withStaleLockRecovery("/r", exec, io, passthru);
    expect(r.stdout).toBe("staged");
    expect(calls()).toBe(2);          // first hit the lock, second succeeded after reclaim
    expect(removed).toEqual(["/r/.git/index.lock"]);
  });

  it("does NOT retry (and surfaces the error) when a live process holds the lock", async () => {
    const { exec, calls } = execSeq([lockErr()]);
    const { io, removed } = ioFake({ held: true });
    const r = await withStaleLockRecovery("/r", exec, io, passthru);
    expect(r.code).toBe(128);
    expect(r.stderr).toMatch(/index\.lock/);
    expect(calls()).toBe(1);          // reclaim refused → no second attempt
    expect(removed).toEqual([]);
  });
});
