import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCloneJobs, CloneStartError, type CloneChild, type CloneSpawner } from "./cloneJobs.js";

/** Fake killable child: emits scripted stderr, exits only when the test says so. */
function fakeChild() {
  let onClose: (code: number | null) => void = () => {};
  let onStderr: (chunk: string) => void = () => {};
  const child: CloneChild & { killed: NodeJS.Signals | null } = {
    killed: null,
    kill(signal) { child.killed = signal ?? "SIGTERM"; return true; },
    on(event, cb) { if (event === "close") onClose = cb; },
    stderr: { on(event, cb) { if (event === "data") onStderr = cb; } },
  };
  return { child, exit: (code: number | null) => onClose(code), stderr: (s: string) => onStderr(s) };
}

function fakeSpawner() {
  const calls: { cmd: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }[] = [];
  const children: ReturnType<typeof fakeChild>[] = [];
  const spawn: CloneSpawner = (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts.cwd, env: opts.env });
    const c = fakeChild();
    children.push(c);
    return c.child;
  };
  return { spawn, calls, children };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const tmp = () => mkdtempSync(path.join(tmpdir(), "clonejobs-"));

describe("createCloneJobs", () => {
  it("spawns `git clone -- <url> <target>` and completes into done + onDone", async () => {
    const parent = tmp();
    const { spawn, calls, children } = fakeSpawner();
    const done: string[] = [];
    const jobs = createCloneJobs({ spawn, onDone: (j) => { done.push(j.path); } });
    const job = await jobs.start({ name: "proj", parent, url: "https://x.test/r.git", ws: { spaceId: "sp_1", x: 24, y: 24 } });
    expect(job.status).toBe("running");
    expect(calls[0].cmd).toBe("git");
    expect(calls[0].args).toEqual(["clone", "--", "https://x.test/r.git", path.join(parent, "proj")]);
    expect(calls[0].env.GIT_TERMINAL_PROMPT).toBe("0");
    children[0].exit(0);
    await tick();
    expect(jobs.get(job.id)?.status).toBe("done");
    expect(done).toEqual([path.join(parent, "proj")]);
  });

  it("spawns `gh repo clone` with the account env overlay for a github job", async () => {
    const parent = tmp();
    const { spawn, calls } = fakeSpawner();
    const jobs = createCloneJobs({ spawn, authEnv: async () => ({ GH_TOKEN: "tok", GH_HOST: "github.com" }) });
    await jobs.start({ name: "r", parent, repo: "me/r", account: { login: "me", host: "github.com" }, ws: { spaceId: null, x: 0, y: 0 } });
    expect(calls[0].cmd).toBe("gh");
    expect(calls[0].args).toEqual(["repo", "clone", "me/r", path.join(parent, "r")]);
    expect(calls[0].env.GH_TOKEN).toBe("tok");
  });

  it("a failing clone lands in error with the stderr tail", async () => {
    const parent = tmp();
    const { spawn, children } = fakeSpawner();
    const jobs = createCloneJobs({ spawn });
    const job = await jobs.start({ name: "p", parent, url: "https://x.test/r.git", ws: { spaceId: null, x: 0, y: 0 } });
    children[0].stderr("fatal: repository not found\n");
    children[0].exit(128);
    await tick();
    const j = jobs.get(job.id)!;
    expect(j.status).toBe("error");
    expect(j.error).toContain("repository not found");
  });

  it("cancel kills the child, removes ONLY the partial target dir, and drops the job", async () => {
    const parent = tmp();
    const { spawn, children } = fakeSpawner();
    const jobs = createCloneJobs({ spawn });
    const job = await jobs.start({ name: "big", parent, url: "https://x.test/big.git", ws: { spaceId: null, x: 0, y: 0 } });
    // Simulate the partial download git left behind, plus a sibling that must survive.
    const target = path.join(parent, "big");
    mkdirSync(target); writeFileSync(path.join(target, "partial"), "x");
    const sibling = path.join(parent, "keep.txt"); writeFileSync(sibling, "y");
    const p = jobs.cancel(job.id);
    children[0].exit(null); // SIGTERM'd process exits
    expect(await p).toBe(true);
    expect(children[0].child.killed).toBe("SIGTERM");
    expect(existsSync(target)).toBe(false);
    expect(existsSync(sibling)).toBe(true);
    expect(jobs.get(job.id)).toBeUndefined();
    expect(jobs.list()).toEqual([]);
  });

  it("cancel on a finished job just dismisses it (no fs action)", async () => {
    const parent = tmp();
    const { spawn, children } = fakeSpawner();
    const jobs = createCloneJobs({ spawn });
    const job = await jobs.start({ name: "p", parent, url: "https://x.test/r.git", ws: { spaceId: null, x: 0, y: 0 } });
    children[0].exit(1);
    await tick();
    expect(await jobs.cancel(job.id)).toBe(true);
    expect(jobs.list()).toEqual([]);
    expect(await jobs.cancel("cj_nope")).toBe(false);
  });

  it("refuses to start when the target path already exists", async () => {
    const parent = tmp();
    mkdirSync(path.join(parent, "taken"));
    const { spawn, calls } = fakeSpawner();
    const jobs = createCloneJobs({ spawn });
    await expect(jobs.start({ name: "taken", parent, url: "https://x.test/r.git", ws: { spaceId: null, x: 0, y: 0 } }))
      .rejects.toThrow(CloneStartError);
    expect(calls).toEqual([]);
  });
});
