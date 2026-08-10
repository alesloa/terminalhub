import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  checkpointRef, checkpointScope, createGitCheckpoints, CHECKPOINT_REFS_PREFIX,
} from "./checkpoints.js";
import { realRunner, type GitResult, type GitRunner } from "./run.js";

const pexec = promisify(execFile);

/** Records every arg vector and env overlay so the plumbing can be asserted exactly — the point of
 *  this module is WHICH git commands run, in what order, with a scratch index. */
function fakeRunner(handler: (args: string[]) => Partial<GitResult> = () => ({})): {
  run: GitRunner; calls: string[][]; envs: (Record<string, string> | undefined)[];
} {
  const calls: string[][] = [];
  const envs: (Record<string, string> | undefined)[] = [];
  const run: GitRunner = async (args, _cwd, env) => {
    calls.push(args);
    envs.push(env);
    return { stdout: "", stderr: "", code: 0, ...handler(args) };
  };
  return { run, calls, envs };
}

const joined = (calls: string[][]) => calls.map((c) => c.join(" "));

describe("checkpointRef", () => {
  it("namespaces refs per scope, under a prefix nothing else reads", () => {
    const ref = checkpointRef("tm_abc123", 4);
    expect(ref.startsWith(`${CHECKPOINT_REFS_PREFIX}/`)).toBe(true);
    expect(ref.endsWith("/turn/4")).toBe(true);
    expect(ref.startsWith(checkpointScope("tm_abc123"))).toBe(true);
  });

  it("keeps ids with ref-hostile characters out of the ref name", () => {
    const ref = checkpointRef("a b/../~^:?*[", 0);
    expect(ref).not.toMatch(/[ ~^:?*[\\]/);
    expect(ref).not.toContain("..");
  });

  it("gives different scopes different namespaces", () => {
    expect(checkpointScope("tm_a")).not.toBe(checkpointScope("tm_b"));
  });
});

describe("createGitCheckpoints.capture", () => {
  it("stages into a scratch index so the user's real index is never written", async () => {
    const { run, calls, envs } = fakeRunner((a) => {
      if (a[0] === "rev-parse" && a[1] === "--git-common-dir") return { stdout: "/repo/.git\n" };
      if (a[0] === "write-tree") return { stdout: "tree123\n" };
      if (a[0] === "commit-tree") return { stdout: "commit456\n" };
      return {};
    });
    const done = await createGitCheckpoints(run).capture("/repo", "refs/x/1", "label here");
    expect(done).toBe(true);

    const staging = calls
      .map((args, i) => ({ args, env: envs[i] }))
      .filter(({ args }) => ["read-tree", "add", "write-tree"].includes(args[0]));
    expect(staging).toHaveLength(3);
    // Every index-touching step runs against the scratch index, and only those.
    for (const { env } of staging) {
      expect(env?.GIT_INDEX_FILE).toContain("terminalhub-checkpoint-index-");
      expect(env?.GIT_INDEX_FILE?.startsWith("/repo/.git/")).toBe(true);
    }
    const updateRef = calls.findIndex((c) => c[0] === "update-ref");
    expect(envs[updateRef]?.GIT_INDEX_FILE).toBeUndefined();
  });

  it("runs read-tree → add -A → write-tree → commit-tree → update-ref", async () => {
    const { run, calls } = fakeRunner((a) => {
      if (a[0] === "rev-parse" && a[1] === "--git-common-dir") return { stdout: "/repo/.git\n" };
      if (a[0] === "write-tree") return { stdout: "tree123\n" };
      if (a[0] === "commit-tree") return { stdout: "commit456\n" };
      return {};
    });
    await createGitCheckpoints(run).capture("/repo", "refs/x/1", "label here");
    const seen = joined(calls);
    expect(seen).toContain("read-tree HEAD");
    expect(seen).toContain("add -A -- .");
    expect(seen).toContain("write-tree");
    expect(seen).toContain("commit-tree tree123 -m label here");
    expect(seen).toContain("update-ref refs/x/1 commit456");
    expect(seen.indexOf("add -A -- .")).toBeLessThan(seen.indexOf("write-tree"));
  });

  it("skips read-tree in a repo with no commits yet", async () => {
    const { run, calls } = fakeRunner((a) => {
      if (a[0] === "rev-parse" && a[1] === "--git-common-dir") return { stdout: "/repo/.git\n" };
      if (a[0] === "rev-parse" && a[3] === "HEAD") return { code: 1 };
      if (a[0] === "write-tree") return { stdout: "tree123\n" };
      if (a[0] === "commit-tree") return { stdout: "commit456\n" };
      return {};
    });
    const done = await createGitCheckpoints(run).capture("/repo", "refs/x/0", "first");
    expect(done).toBe(true);
    expect(joined(calls)).not.toContain("read-tree HEAD");
  });

  it("never moves the ref when write-tree fails", async () => {
    const { run, calls } = fakeRunner((a) => {
      if (a[0] === "rev-parse" && a[1] === "--git-common-dir") return { stdout: "/repo/.git\n" };
      if (a[0] === "write-tree") return { code: 128, stderr: "boom" };
      return {};
    });
    expect(await createGitCheckpoints(run).capture("/repo", "refs/x/1", "l")).toBe(false);
    expect(joined(calls).some((c) => c.startsWith("update-ref"))).toBe(false);
  });
});

describe("createGitCheckpoints.restore", () => {
  it("restores worktree + index from the checkpoint, cleans, then puts the index back on HEAD", async () => {
    const { run, calls } = fakeRunner((a) => {
      if (a[0] === "rev-parse" && a[3]?.endsWith("^{commit}")) return { stdout: "oid789\n" };
      return {};
    });
    const stat = await createGitCheckpoints(run).restore("/repo", "refs/x/2");
    expect(stat).not.toBeNull();
    const seen = joined(calls);
    expect(seen).toContain("restore --source oid789 --worktree --staged -- .");
    expect(seen).toContain("clean -fd -- .");
    expect(seen).toContain("reset --quiet -- .");
    expect(seen.indexOf("restore --source oid789 --worktree --staged -- ."))
      .toBeLessThan(seen.indexOf("clean -fd -- ."));
  });

  it("does nothing at all when the ref doesn't exist", async () => {
    const { run, calls } = fakeRunner((a) => {
      if (a[0] === "rev-parse") return { code: 1 };
      return {};
    });
    expect(await createGitCheckpoints(run).restore("/repo", "refs/x/9")).toBeNull();
    expect(joined(calls).some((c) => c.startsWith("restore") || c.startsWith("clean"))).toBe(false);
  });

  it("reports what it changed, measured before the tree moved", async () => {
    const { run, calls } = fakeRunner((a) => {
      if (a[0] === "rev-parse" && a[3]?.endsWith("^{commit}")) return { stdout: "oid789\n" };
      if (a[0] === "diff") return { stdout: "4\t2\tsrc/a.ts\n10\t0\tsrc/b.ts\n" };
      if (a[0] === "ls-files") return { stdout: "src/new.ts\nsrc/kept.ts\n" };
      if (a[0] === "ls-tree") return { stdout: "src/kept.ts\n" };
      return {};
    });
    const stat = await createGitCheckpoints(run).restore("/repo", "refs/x/2");
    expect(stat).toEqual({ files: 2, insertions: 14, deletions: 2, removed: 1 });
    // Measured before the destructive half, or the numbers would all be zero.
    expect(joined(calls).indexOf("clean -fd -- .")).toBeGreaterThan(
      joined(calls).findIndex((c) => c.startsWith("diff --numstat")),
    );
  });

  it("counts a binary file as changed without inventing line counts", async () => {
    const { run } = fakeRunner((a) => {
      if (a[0] === "rev-parse" && a[3]?.endsWith("^{commit}")) return { stdout: "oid789\n" };
      if (a[0] === "diff") return { stdout: "-\t-\tlogo.png\n" };
      return {};
    });
    expect(await createGitCheckpoints(run).preview("/repo", "refs/x/2"))
      .toEqual({ files: 1, insertions: 0, deletions: 0, removed: 0 });
  });
});

describe("createGitCheckpoints.relabel", () => {
  it("re-points the ref at the SAME tree, so the snapshot survives", async () => {
    const { run, calls } = fakeRunner((a) => {
      if (a[0] === "rev-parse" && a[3]?.endsWith("^{tree}")) return { stdout: "treeOld\n" };
      if (a[0] === "commit-tree") return { stdout: "commitNew\n" };
      return {};
    });
    expect(await createGitCheckpoints(run).relabel("/repo", "refs/x/3", "new label")).toBe(true);
    const seen = joined(calls);
    expect(seen).toContain("commit-tree treeOld -m new label");
    expect(seen).toContain("update-ref refs/x/3 commitNew");
    // No working-tree walk — that's the whole point of relabelling instead of re-capturing.
    expect(seen.some((c) => c.startsWith("add ") || c === "write-tree")).toBe(false);
  });

  it("fails rather than inventing a checkpoint when the ref is missing", async () => {
    const { run, calls } = fakeRunner(() => ({ code: 1 }));
    expect(await createGitCheckpoints(run).relabel("/repo", "refs/x/3", "l")).toBe(false);
    expect(joined(calls).some((c) => c.startsWith("update-ref"))).toBe(false);
  });
});

describe("createGitCheckpoints.turns", () => {
  it("lists the checkpointed turn numbers in order", async () => {
    const scope = checkpointScope("tm_1");
    const { run } = fakeRunner((a) => {
      if (a[0] === "for-each-ref") {
        return { stdout: `${scope}/turn/10\n${scope}/turn/2\n${scope}/turn/0\n` };
      }
      return {};
    });
    expect(await createGitCheckpoints(run).turns("/repo", "tm_1")).toEqual([0, 2, 10]);
  });

  it("is empty when the scope has never been checkpointed", async () => {
    const { run } = fakeRunner();
    expect(await createGitCheckpoints(run).turns("/repo", "tm_1")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Against a real git repo — the plumbing above is only worth anything if git
// actually accepts it, and if the user's own index/HEAD/branch survive it.
// ---------------------------------------------------------------------------

async function tempRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "th-checkpoints-"));
  const git = (...args: string[]) => pexec("git", args, { cwd: dir });
  await git("init", "-q", "-b", "main");
  await git("config", "user.name", "Test");
  await git("config", "user.email", "test@example.invalid");
  await fs.writeFile(path.join(dir, ".gitignore"), "ignored/\n");
  await fs.writeFile(path.join(dir, "tracked.txt"), "one\n");
  await git("add", "-A");
  await git("commit", "-qm", "init");
  return dir;
}

const read = (dir: string, file: string) => fs.readFile(path.join(dir, file), "utf8");
const exists = (dir: string, file: string) =>
  fs.access(path.join(dir, file)).then(() => true, () => false);

describe("createGitCheckpoints against a real repo", () => {
  it("puts tracked edits back and deletes files created after the snapshot", async () => {
    const dir = await tempRepo();
    const cp = createGitCheckpoints(realRunner);
    const ref = checkpointRef("tm_real", 0);

    expect(await cp.isRepo(dir)).toBe(true);
    expect(await cp.capture(dir, ref, "terminalhub checkpoint turn=0")).toBe(true);

    await fs.writeFile(path.join(dir, "tracked.txt"), "one\ntwo\n");
    await fs.writeFile(path.join(dir, "created-later.txt"), "new\n");

    // Counted checkpoint → now, i.e. what is about to be undone: the agent added a line and a file.
    const preview = await cp.preview(dir, ref);
    expect(preview).toEqual({ files: 1, insertions: 1, deletions: 0, removed: 1 });

    const stat = await cp.restore(dir, ref);
    expect(stat).toEqual(preview);
    expect(await read(dir, "tracked.txt")).toBe("one\n");
    expect(await exists(dir, "created-later.txt")).toBe(false);

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("leaves HEAD, the branch and the user's staged changes exactly as they were", async () => {
    const dir = await tempRepo();
    const cp = createGitCheckpoints(realRunner);
    const git = (...args: string[]) => pexec("git", args, { cwd: dir });
    const head = (await git("rev-parse", "HEAD")).stdout.trim();

    await fs.writeFile(path.join(dir, "staged.txt"), "staged\n");
    await git("add", "staged.txt");

    expect(await cp.capture(dir, checkpointRef("tm_real", 1), "l")).toBe(true);

    expect((await git("rev-parse", "HEAD")).stdout.trim()).toBe(head);
    expect((await git("rev-parse", "--abbrev-ref", "HEAD")).stdout.trim()).toBe("main");
    expect((await git("diff", "--cached", "--name-only")).stdout.trim()).toBe("staged.txt");
    expect((await git("stash", "list")).stdout.trim()).toBe("");
    // The scratch index is cleaned up, not left behind in .git.
    const gitFiles = await fs.readdir(path.join(dir, ".git"));
    expect(gitFiles.some((f) => f.startsWith("terminalhub-checkpoint-index-"))).toBe(false);

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("never snapshots or deletes ignored files", async () => {
    const dir = await tempRepo();
    const cp = createGitCheckpoints(realRunner);
    const ref = checkpointRef("tm_real", 2);

    await fs.mkdir(path.join(dir, "ignored"), { recursive: true });
    await fs.writeFile(path.join(dir, "ignored/secret.env"), "TOKEN=1\n");
    expect(await cp.capture(dir, ref, "l")).toBe(true);

    await fs.writeFile(path.join(dir, "ignored/secret.env"), "TOKEN=2\n");
    await cp.restore(dir, ref);
    // Untouched in both directions: not reverted, not cleaned away.
    expect(await read(dir, "ignored/secret.env")).toBe("TOKEN=2\n");

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("restores a file the agent deleted, and does it again after a second capture", async () => {
    const dir = await tempRepo();
    const cp = createGitCheckpoints(realRunner);
    const first = checkpointRef("tm_real", 3);
    const second = checkpointRef("tm_real", 4);

    expect(await cp.capture(dir, first, "turn=3")).toBe(true);
    await fs.rm(path.join(dir, "tracked.txt"));
    await fs.writeFile(path.join(dir, "added.txt"), "added\n");
    expect(await cp.capture(dir, second, "turn=4")).toBe(true);

    await fs.writeFile(path.join(dir, "added.txt"), "changed\n");
    await cp.restore(dir, second);
    expect(await read(dir, "added.txt")).toBe("added\n");
    expect(await exists(dir, "tracked.txt")).toBe(false);

    await cp.restore(dir, first);
    expect(await read(dir, "tracked.txt")).toBe("one\n");
    expect(await exists(dir, "added.txt")).toBe(false);

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("relabels without disturbing the snapshot, and lists then drops its refs", async () => {
    const dir = await tempRepo();
    const cp = createGitCheckpoints(realRunner);
    const ref = checkpointRef("tm_scope", 0);

    await cp.capture(dir, ref, "terminalhub checkpoint turn=0 next=aaaa");
    await fs.writeFile(path.join(dir, "tracked.txt"), "drifted\n");

    expect(await cp.relabel(dir, ref, "terminalhub checkpoint turn=0 next=bbbb")).toBe(true);
    expect(await cp.label(dir, ref)).toBe("terminalhub checkpoint turn=0 next=bbbb");

    await cp.restore(dir, ref);
    expect(await read(dir, "tracked.txt")).toBe("one\n");

    expect(await cp.turns(dir, "tm_scope")).toEqual([0]);
    await cp.remove(dir, [ref]);
    expect(await cp.turns(dir, "tm_scope")).toEqual([]);
    expect(await cp.label(dir, ref)).toBeNull();

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("works in a repo with no commits at all", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "th-checkpoints-empty-"));
    await pexec("git", ["init", "-q", "-b", "main"], { cwd: dir });
    const cp = createGitCheckpoints(realRunner);
    const ref = checkpointRef("tm_empty", 0);

    await fs.writeFile(path.join(dir, "a.txt"), "a\n");
    expect(await cp.capture(dir, ref, "turn=0")).toBe(true);

    await fs.writeFile(path.join(dir, "a.txt"), "changed\n");
    await fs.writeFile(path.join(dir, "b.txt"), "b\n");
    expect(await cp.restore(dir, ref)).not.toBeNull();
    expect(await read(dir, "a.txt")).toBe("a\n");
    expect(await exists(dir, "b.txt")).toBe(false);

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("reports a folder that isn't a repo instead of trying anything", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "th-checkpoints-plain-"));
    const cp = createGitCheckpoints(realRunner);
    expect(await cp.isRepo(dir)).toBe(false);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
