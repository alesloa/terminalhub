import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGitController, GitError } from "./controller.js";
import type { GitRunner, GitResult } from "./run.js";

/** Build a fake runner that returns scripted results keyed by the joined arg string, recording the
 *  arg vectors and the per-call env overlay (so token injection on network ops can be asserted). */
function fakeRunner(handler: (args: string[], cwd: string) => Partial<GitResult>): {
  run: GitRunner; calls: string[][]; envs: (Record<string, string> | undefined)[];
} {
  const calls: string[][] = [];
  const envs: (Record<string, string> | undefined)[] = [];
  const run: GitRunner = async (args, cwd, env) => {
    calls.push(args);
    envs.push(env);
    return { stdout: "", stderr: "", code: 0, ...handler(args, cwd) };
  };
  return { run, calls, envs };
}

describe("createGitController.info", () => {
  it("reports git missing when the binary spawn fails (code -1)", async () => {
    const { run } = fakeRunner((a) => a[0] === "--version" ? { code: -1, stderr: "ENOENT" } : {});
    const info = await createGitController(run).info("/x");
    expect(info).toEqual({ installed: false, version: null, isRepo: false, root: null });
  });

  it("reports installed-but-not-a-repo", async () => {
    const { run } = fakeRunner((a) => {
      if (a[0] === "--version") return { stdout: "git version 2.45.0\n" };
      if (a[1] === "--show-toplevel") return { code: 128, stderr: "not a git repository" };
      return {};
    });
    const info = await createGitController(run).info("/x");
    expect(info).toEqual({ installed: true, version: "2.45.0", isRepo: false, root: null });
  });

  it("reports a repo with its root", async () => {
    const { run } = fakeRunner((a) => {
      if (a[0] === "--version") return { stdout: "git version 2.45.0\n" };
      if (a[1] === "--show-toplevel") return { stdout: "/Volumes/Code/repo\n" };
      return {};
    });
    const info = await createGitController(run).info("/Volumes/Code/repo/sub");
    expect(info).toEqual({ installed: true, version: "2.45.0", isRepo: true, root: "/Volumes/Code/repo" });
  });
});

describe("createGitController.ignored", () => {
  it("lists ignored paths and strips the trailing slash off collapsed dirs", async () => {
    const { run, calls } = fakeRunner((a) =>
      a[0] === "ls-files" ? { stdout: "node_modules/\ndist/\n.env\n" } : {});
    const ignored = await createGitController(run).ignored("/x");
    expect(ignored).toEqual(["node_modules", "dist", ".env"]);
    expect(calls[0]).toEqual(["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"]);
  });
});

describe("createGitController mutations", () => {
  it("throws GitError with git's stderr when a commit fails", async () => {
    const { run } = fakeRunner(() => ({ code: 1, stderr: "nothing to commit\n" }));
    await expect(createGitController(run).commit("/x", "msg")).rejects.toThrow(GitError);
    await expect(createGitController(run).commit("/x", "msg")).rejects.toThrow("nothing to commit");
  });

  it("stages explicit paths after a -- guard", async () => {
    const { run, calls } = fakeRunner(() => ({}));
    await createGitController(run).stage("/x", ["a.ts", "weird name.ts"]);
    expect(calls[0]).toEqual(["add", "--", "a.ts", "weird name.ts"]);
  });

  it("trashes untracked files with `git clean -fd` (keeps ignored)", async () => {
    const { run, calls } = fakeRunner(() => ({}));
    await createGitController(run).cleanUntracked("/x");
    expect(calls[0]).toEqual(["clean", "-fd"]);
  });

  it("diffs an untracked file against /dev/null", async () => {
    const { run, calls } = fakeRunner(() => ({ stdout: "patch", code: 1 }));
    const patch = await createGitController(run).diff("/x", "new.ts", { untracked: true });
    expect(patch).toBe("patch"); // non-zero exit from --no-index is not an error
    expect(calls[0]).toEqual(["diff", "--no-color", "--no-index", "--", "/dev/null", "new.ts"]);
  });

  it("uses --cached for a staged diff", async () => {
    const { run, calls } = fakeRunner(() => ({}));
    await createGitController(run).diff("/x", "a.ts", { staged: true });
    expect(calls[0]).toEqual(["diff", "--no-color", "--cached", "--", "a.ts"]);
  });

  it("shows a single commit's patch with the message header suppressed", async () => {
    const { run, calls } = fakeRunner(() => ({ stdout: "patch" }));
    const out = await createGitController(run).commitDiff("/x", "abc123");
    expect(out).toBe("patch");
    expect(calls[0]).toEqual(["show", "--no-color", "--format=", "abc123"]);
  });

  it("reads a file's content at a rev with `git show <rev>:<file>`", async () => {
    const { run, calls } = fakeRunner(() => ({ stdout: "old contents\n" }));
    const out = await createGitController(run).showFile("/x", "HEAD", "src/a.ts");
    expect(out).toBe("old contents\n");
    expect(calls[0]).toEqual(["show", "HEAD:src/a.ts"]);
  });

  it("reads the index version of a file when the rev is empty", async () => {
    const { run, calls } = fakeRunner(() => ({}));
    await createGitController(run).showFile("/x", "", "a.ts");
    expect(calls[0]).toEqual(["show", ":a.ts"]);
  });

  it("returns '' for a file absent from the rev (git exits non-zero, no stdout)", async () => {
    const { run } = fakeRunner(() => ({ code: 128, stderr: "path 'x' does not exist\n" }));
    expect(await createGitController(run).showFile("/x", "abc^", "x")).toBe("");
  });

  it("lists a commit's files from name-status, taking the new path for renames", async () => {
    const { run, calls } = fakeRunner(() => ({ stdout: "M\tsrc/a.ts\nA\tnew.ts\nR100\told.ts\tmoved.ts\n" }));
    const files = await createGitController(run).commitFiles("/x", "abc123");
    expect(files).toEqual([
      { status: "M", path: "src/a.ts" },
      { status: "A", path: "new.ts" },
      { status: "R", path: "moved.ts" },
    ]);
    expect(calls[0]).toEqual(["diff-tree", "--no-commit-id", "--name-status", "-r", "--root", "abc123"]);
  });

  it("uncommits with a soft reset that keeps changes staged", async () => {
    const { run, calls } = fakeRunner(() => ({}));
    await createGitController(run).uncommit("/x");
    expect(calls[0]).toEqual(["reset", "--soft", "HEAD~1"]);
  });

  it("returns git's status line on push (git writes it to stderr)", async () => {
    const { run, calls } = fakeRunner(() => ({ stderr: "Everything up-to-date\n", code: 0 }));
    const msg = await createGitController(run).push("/x");
    expect(msg).toBe("Everything up-to-date");
    expect(calls[0]).toEqual(["push"]);
  });

  it("pushes with -u origin HEAD when publishing a branch", async () => {
    const { run, calls } = fakeRunner(() => ({ stderr: "branch set up\n" }));
    await createGitController(run).push("/x", true);
    expect(calls[0]).toEqual(["push", "-u", "origin", "HEAD"]);
  });

  it("throws GitError with git's stderr when push is rejected", async () => {
    const { run } = fakeRunner(() => ({ code: 1, stderr: "! [rejected] main -> main (fetch first)\n" }));
    await expect(createGitController(run).push("/x")).rejects.toThrow(GitError);
    await expect(createGitController(run).push("/x")).rejects.toThrow("rejected");
  });

  it("force-pushes the current branch with a plain --force", async () => {
    const { run, calls } = fakeRunner(() => ({ stderr: "+ abc...def main -> main (forced update)\n" }));
    const msg = await createGitController(run).forcePush("/x");
    expect(msg).toBe("+ abc...def main -> main (forced update)");
    expect(calls[0]).toEqual(["push", "--force"]);
  });

  it("force-pushes with -u origin HEAD when there's no upstream yet", async () => {
    const { run, calls } = fakeRunner(() => ({ stderr: "branch set up\n" }));
    await createGitController(run).forcePush("/x", true);
    expect(calls[0]).toEqual(["push", "-u", "--force", "origin", "HEAD"]);
  });

  it("throws GitError with git's stderr when a force-push is rejected (protected branch)", async () => {
    const { run } = fakeRunner(() => ({ code: 1, stderr: "! [remote rejected] main -> main (protected branch hook declined)\n" }));
    await expect(createGitController(run).forcePush("/x")).rejects.toThrow(GitError);
    await expect(createGitController(run).forcePush("/x")).rejects.toThrow("protected branch");
  });

  it("returns a confirmation from fetch even when nothing is new (empty output)", async () => {
    const { run, calls } = fakeRunner(() => ({ stdout: "", stderr: "" }));
    expect(await createGitController(run).fetch("/x")).toBe("Fetched.");
    expect(calls[0]).toEqual(["fetch", "--all", "--prune"]);
  });

  it("returns git's pull transcript from stdout", async () => {
    const { run, calls } = fakeRunner(() => ({ stdout: "Already up to date.\n" }));
    expect(await createGitController(run).pull("/x")).toBe("Already up to date.");
    expect(calls[0]).toEqual(["pull", "--ff-only"]);
  });

  it("syncs a diverged branch by merging then pushing, returning the push transcript", async () => {
    const { run, calls } = fakeRunner((a) => {
      if (a[0] === "pull") return { stdout: "Merge made by the 'ort' strategy.\n" };
      if (a[0] === "push") return { stderr: "abc..def  main -> main\n" };
      return {};
    });
    expect(await createGitController(run).sync("/x")).toBe("abc..def  main -> main");
    expect(calls[0]).toEqual(["pull", "--no-rebase"]);
    expect(calls[1]).toEqual(["push"]);
  });

  it("aborts sync at a failed pull (conflict) and never reaches push", async () => {
    const { run, calls } = fakeRunner((a) => a[0] === "pull" ? { code: 1, stderr: "CONFLICT (content)\n" } : {});
    await expect(createGitController(run).sync("/x")).rejects.toThrow("CONFLICT");
    expect(calls.some(c => c[0] === "push")).toBe(false);
  });
});

describe("createGitController network auth (multi-account)", () => {
  // Resolver standing in for the gh-backed one: a pinned owner token plus one fallback account.
  const pinned = async () => ({
    primary: { GH_TOKEN: "tok_owner", GH_HOST: "github.com" },
    fallbacks: [{ GH_TOKEN: "tok_other", GH_HOST: "github.com" }],
  });
  const envsFor = (op: string, calls: string[][], envs: (Record<string, string> | undefined)[]) =>
    calls.map((c, i) => [c, envs[i]] as const).filter(([c]) => c[0] === op).map(([, e]) => e);

  it("looks up origin, then fetches with the owning account's token injected up front", async () => {
    const { run, calls, envs } = fakeRunner((a) =>
      a[0] === "remote" ? { stdout: "https://github.com/owner/repo.git\n" } : {});
    await createGitController(run, pinned).fetch("/x");
    expect(calls[0]).toEqual(["remote", "get-url", "origin"]);
    expect(calls[1]).toEqual(["fetch", "--all", "--prune"]);
    expect(envs[1]).toEqual({ GH_TOKEN: "tok_owner", GH_HOST: "github.com" });
  });

  it("retries a fetch that can't authenticate with the next account's token", async () => {
    let fetches = 0;
    const { run, calls, envs } = fakeRunner((a) => {
      if (a[0] === "remote") return { stdout: "https://github.com/owner/repo.git\n" };
      if (a[0] === "fetch") return ++fetches === 1 ? { code: 128, stderr: "remote: Repository not found.\n" } : {};
      return {};
    });
    await createGitController(run, pinned).fetch("/x");
    expect(envsFor("fetch", calls, envs)).toEqual([
      { GH_TOKEN: "tok_owner", GH_HOST: "github.com" },
      { GH_TOKEN: "tok_other", GH_HOST: "github.com" },
    ]);
  });

  it("does NOT retry across accounts on a non-auth failure (e.g. a rejected push)", async () => {
    const { run, calls } = fakeRunner((a) => {
      if (a[0] === "remote") return { stdout: "https://github.com/owner/repo.git\n" };
      if (a[0] === "push") return { code: 1, stderr: "! [rejected] main -> main (fetch first)\n" };
      return {};
    });
    await expect(createGitController(run, pinned).push("/x")).rejects.toThrow("rejected");
    expect(calls.filter(c => c[0] === "push").length).toBe(1);
  });

  it("tries the active account first (no token) when no owner is pinned, then the fallback", async () => {
    const orgResolver = async () => ({ fallbacks: [{ GH_TOKEN: "tok_other", GH_HOST: "github.com" }] });
    let fetches = 0;
    const { run, calls, envs } = fakeRunner((a) => {
      if (a[0] === "remote") return { stdout: "https://github.com/org/repo.git\n" };
      if (a[0] === "fetch") return ++fetches === 1 ? { code: 128, stderr: "Repository not found\n" } : {};
      return {};
    });
    await createGitController(run, orgResolver).fetch("/x");
    expect(envsFor("fetch", calls, envs)).toEqual([undefined, { GH_TOKEN: "tok_other", GH_HOST: "github.com" }]);
  });

  it("without a resolver, network ops run unchanged (no origin lookup, no env)", async () => {
    const { run, calls, envs } = fakeRunner(() => ({}));
    await createGitController(run).fetch("/x");
    expect(calls[0]).toEqual(["fetch", "--all", "--prune"]);
    expect(envs[0]).toBeUndefined();
  });
});

describe("createGitController reads", () => {
  it("merges the configured remotes into status (so the UI can tell published from not)", async () => {
    const { run, calls } = fakeRunner((a) => {
      if (a[0] === "status") return { stdout: "# branch.head main\n" };
      if (a[0] === "remote") return { stdout: "origin\nupstream\n" };
      return {};
    });
    const s = await createGitController(run).status("/x");
    expect(s.remotes).toEqual(["origin", "upstream"]);
    expect(calls.some(c => c[0] === "remote")).toBe(true);
  });

  it("reports no remotes for a never-published repo", async () => {
    const { run } = fakeRunner((a) => a[0] === "status" ? { stdout: "# branch.head main\n" } : { stdout: "" });
    expect((await createGitController(run).status("/x")).remotes).toEqual([]);
  });

  it("requests a NUL-separated, fully-decorated, topo-ordered log scoped to HEAD (not --all)", async () => {
    const { run, calls } = fakeRunner(() => ({ stdout: "" }));
    await createGitController(run).log("/x", 50);
    // log() first resolves the graph's ref scope (rev-parse @{upstream}, origin/HEAD), so the
    // `log` invocation is no longer calls[0]; find it. The fake returns no exit code, so only
    // HEAD survives ref resolution here.
    const logCall = calls.find(c => c[0] === "log")!;
    expect(logCall).toBeDefined();
    expect(logCall.some(a => a.startsWith("--pretty=format:"))).toBe(true);
    expect(logCall).toContain("-z");
    expect(logCall).toContain("--decorate=full");
    expect(logCall).toContain("--topo-order");
    expect(logCall).toContain("HEAD");
    expect(logCall).not.toContain("--all"); // scoped to reachable refs so lanes connect like VS Code
    expect(logCall).toContain("50");
  });
});

describe("createGitController.defaultBranch", () => {
  it("strips the remote from origin/HEAD", async () => {
    const { run } = fakeRunner((a) =>
      a[0] === "rev-parse" && a.includes("--abbrev-ref") ? { stdout: "origin/develop\n" } : {});
    expect(await createGitController(run).defaultBranch("/x")).toBe("develop");
  });

  it("falls back to a conventional local branch when there's no remote HEAD", async () => {
    const { run } = fakeRunner((a) => {
      if (a[0] === "rev-parse") return { stdout: "origin/HEAD\n", code: 128 }; // unresolved
      if (a[0] === "branch") return { stdout: "feature\nmaster\nwip\n" };
      return {};
    });
    expect(await createGitController(run).defaultBranch("/x")).toBe("master");
  });

  it("returns null when nothing resolves", async () => {
    const { run } = fakeRunner((a) => {
      if (a[0] === "rev-parse") return { stdout: "origin/HEAD\n", code: 128 };
      if (a[0] === "branch") return { stdout: "feature\nwip\n" };
      return {};
    });
    expect(await createGitController(run).defaultBranch("/x")).toBeNull();
  });
});

describe("createGitController.prContext", () => {
  it("reads commits via base..HEAD and files via base...HEAD", async () => {
    const { run, calls } = fakeRunner((a) => {
      if (a[0] === "log") return { stdout: "- feat: add widget\nbody\n" };
      if (a[0] === "diff") return { stdout: "M\tsrc/x.ts\n" };
      return {};
    });
    const ctx = await createGitController(run).prContext("/x", "main");
    expect(ctx.commits).toContain("feat: add widget");
    expect(ctx.files).toContain("src/x.ts");
    const logCall = calls.find(c => c[0] === "log")!;
    expect(logCall).toContain("main..HEAD");
    const diffCall = calls.find(c => c[0] === "diff")!;
    expect(diffCall).toContain("--name-status");
    expect(diffCall).toContain("main...HEAD");
  });
});

describe("createGitController.ignore", () => {
  const tmpRepo = () => fs.mkdtemp(path.join(os.tmpdir(), "tr-ignore-"));

  // Resolves the local-exclude path the way real git does and accepts the `rm`; records calls.
  function ignoreRunner() {
    const calls: string[][] = [];
    const run: GitRunner = async (args) => {
      calls.push(args);
      if (args[0] === "rev-parse" && args.includes("--git-path")) return { stdout: ".git/info/exclude\n", stderr: "", code: 0 };
      return { stdout: "", stderr: "", code: 0 };
    };
    return { run, calls };
  }

  it("creates the repo .gitignore with the anchored line and untracks the path", async () => {
    const dir = await tmpRepo();
    const { run, calls } = ignoreRunner();
    const res = await createGitController(run).ignore(dir, "foo.ts", { scope: "repo", isDir: false });
    expect(res).toEqual({ line: "/foo.ts", added: true });
    expect(await fs.readFile(path.join(dir, ".gitignore"), "utf8")).toBe("/foo.ts\n");
    // git rm -r --cached --ignore-unmatch -- foo.ts → untracks it, keeps the working file.
    expect(calls).toContainEqual(["rm", "-r", "--cached", "--ignore-unmatch", "--", "foo.ts"]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("is a no-op write when the line is already present", async () => {
    const dir = await tmpRepo();
    await fs.writeFile(path.join(dir, ".gitignore"), "/foo.ts\n");
    const { run } = ignoreRunner();
    const res = await createGitController(run).ignore(dir, "foo.ts", { scope: "repo", isDir: false });
    expect(res).toEqual({ line: "/foo.ts", added: false });
    expect(await fs.readFile(path.join(dir, ".gitignore"), "utf8")).toBe("/foo.ts\n");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("writes a directory rule to .git/info/exclude for the local scope", async () => {
    const dir = await tmpRepo();
    const { run, calls } = ignoreRunner();
    const res = await createGitController(run).ignore(dir, "build", { scope: "local", isDir: true });
    expect(res).toEqual({ line: "/build/", added: true });
    expect(await fs.readFile(path.join(dir, ".git/info/exclude"), "utf8")).toBe("/build/\n");
    expect(calls.some(c => c[0] === "rev-parse" && c.includes("--git-path"))).toBe(true);
    expect(calls).toContainEqual(["rm", "-r", "--cached", "--ignore-unmatch", "--", "build"]);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("createGitController.renameBranch", () => {
  it("renames via git branch -m old new", async () => {
    const { run, calls } = fakeRunner(() => ({}));
    await createGitController(run).renameBranch("/x", "old", "new");
    expect(calls).toContainEqual(["branch", "-m", "old", "new"]);
  });

  it("throws GitError with git's stderr on failure", async () => {
    const { run } = fakeRunner(() => ({ code: 128, stderr: "fatal: a branch named 'new' already exists\n" }));
    await expect(createGitController(run).renameBranch("/x", "old", "new")).rejects.toThrow(GitError);
    await expect(createGitController(run).renameBranch("/x", "old", "new")).rejects.toThrow("already exists");
  });
});

describe("createGitController.init", () => {
  it("initializes a repository with git init", async () => {
    const { run, calls } = fakeRunner(() => ({}));
    await createGitController(run).init("/x");
    expect(calls).toContainEqual(["init"]);
  });

  it("throws GitError with git's stderr on failure", async () => {
    const { run } = fakeRunner(() => ({ code: 128, stderr: "fatal: cannot mkdir .git: Permission denied\n" }));
    await expect(createGitController(run).init("/x")).rejects.toThrow(GitError);
    await expect(createGitController(run).init("/x")).rejects.toThrow("Permission denied");
  });
});

describe("createGitController.merge", () => {
  it("runs git merge --no-edit and returns git's transcript", async () => {
    const { run, calls } = fakeRunner((a) => a[0] === "merge" ? { stdout: "Updating a..b\nFast-forward\n" } : {});
    const msg = await createGitController(run).merge("/x", "feat");
    expect(calls).toContainEqual(["merge", "--no-edit", "feat"]);
    expect(msg).toContain("Fast-forward");
  });

  it("falls back to 'Merged.' when git prints nothing", async () => {
    const { run } = fakeRunner((a) => a[0] === "merge" ? {} : {});
    expect(await createGitController(run).merge("/x", "feat")).toBe("Merged.");
  });

  it("throws GitError carrying git's conflict message", async () => {
    const { run } = fakeRunner(() => ({ code: 1, stdout: "CONFLICT (content): Merge conflict in a.ts\n" }));
    await expect(createGitController(run).merge("/x", "feat")).rejects.toThrow("CONFLICT");
  });
});

describe("createGitController.mergePreview", () => {
  it("reports a clean merge on exit 0", async () => {
    const { run, calls } = fakeRunner((a) => a[0] === "merge-tree" ? { stdout: "0123abcd\n", code: 0 } : {});
    const r = await createGitController(run).mergePreview("/x", "feat");
    expect(calls).toContainEqual(["merge-tree", "--write-tree", "--name-only", "HEAD", "feat"]);
    expect(r).toEqual({ clean: true, conflicts: [] });
  });

  it("lists the conflicting files on exit 1, ignoring the trailing messages", async () => {
    const { run } = fakeRunner((a) => a[0] === "merge-tree"
      ? { code: 1, stdout: "0123abcd\n\nsrc/a.ts\nsrc/b.ts\n\nAuto-merging src/a.ts\nCONFLICT (content): Merge conflict in src/a.ts\n" }
      : {});
    const r = await createGitController(run).mergePreview("/x", "feat");
    expect(r.clean).toBe(false);
    expect(r.conflicts).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("throws GitError when the branch can't be merged (any other exit)", async () => {
    const { run } = fakeRunner((a) => a[0] === "merge-tree" ? { code: 128, stderr: "fatal: not something we can merge\n" } : {});
    await expect(createGitController(run).mergePreview("/x", "nope")).rejects.toThrow("not something we can merge");
  });
});

describe("createGitController.stashFiles", () => {
  it("parses the name-status between the stash and its base commit", async () => {
    const { run, calls } = fakeRunner((a) => a[0] === "diff" ? { stdout: "M\tsrc/a.ts\nA\tnew.ts\n" } : {});
    const files = await createGitController(run).stashFiles("/x", "stash@{0}");
    expect(calls).toContainEqual(["diff", "--no-color", "--name-status", "stash@{0}^1", "stash@{0}"]);
    expect(files).toEqual([{ status: "M", path: "src/a.ts" }, { status: "A", path: "new.ts" }]);
  });
});

describe("createGitController.stageAll", () => {
  it("stages with --ignore-errors so one bad path can't abort the whole stage", async () => {
    const { run, calls } = fakeRunner(() => ({}));
    await createGitController(run).stageAll("/x");
    expect(calls[0]).toEqual(["add", "-A", "--ignore-errors"]);
  });

  it("does NOT throw on exit 1 (a path was skipped, e.g. an embedded repo with no commit)", async () => {
    const { run } = fakeRunner(() => ({ code: 1, stderr: "error: '.claude/skills/x/' does not have a commit checked out\n" }));
    await expect(createGitController(run).stageAll("/x")).resolves.toBeUndefined();
  });

  it("throws GitError on a fatal exit (128 — not a repo / bad pathspec)", async () => {
    const { run } = fakeRunner(() => ({ code: 128, stderr: "fatal: not a git repository\n" }));
    await expect(createGitController(run).stageAll("/x")).rejects.toThrow(GitError);
  });
});

describe("createGitController.stashFile", () => {
  it("scopes the stash to one pathspec with -u", async () => {
    const { run, calls } = fakeRunner(() => ({}));
    await createGitController(run).stashFile("/x", "src/a.ts");
    expect(calls).toContainEqual(["stash", "push", "-u", "--", "src/a.ts"]);
  });

  it("names the stash with -m when a message is given", async () => {
    const { run, calls } = fakeRunner(() => ({}));
    await createGitController(run).stashFile("/x", "src/a.ts", "wip on a");
    expect(calls).toContainEqual(["stash", "push", "-u", "-m", "wip on a", "--", "src/a.ts"]);
  });

  it("stashes multiple pathspecs into one stash entry", async () => {
    const { run, calls } = fakeRunner(() => ({}));
    await createGitController(run).stashFile("/x", ["src/a.ts", "src/b.ts"], "wip");
    expect(calls).toContainEqual(["stash", "push", "-u", "-m", "wip", "--", "src/a.ts", "src/b.ts"]);
  });
});

describe("createGitController.worktreeAdd", () => {
  it("checks out an existing branch in the new worktree", async () => {
    const { run, calls } = fakeRunner(() => ({}));
    await createGitController(run).worktreeAdd("/x", "../wt-feat", "feat/x");
    expect(calls).toContainEqual(["worktree", "add", "../wt-feat", "feat/x"]);
  });

  it("creates the branch with -b when newBranch is set", async () => {
    const { run, calls } = fakeRunner(() => ({}));
    await createGitController(run).worktreeAdd("/x", "../wt-new", "feat/new", true);
    expect(calls).toContainEqual(["worktree", "add", "-b", "feat/new", "../wt-new"]);
  });
});
