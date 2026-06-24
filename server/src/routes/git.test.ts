import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { createStore } from "../db/store.js";
import { createTmuxController } from "../tmux/controller.js";
import { createGitController } from "../git/controller.js";
import { createGithubController } from "../git/github.js";
import type { GitRunner } from "../git/run.js";
import type { GhRunner } from "../git/github.js";
import { gitRoutes } from "./git.js";

const US = "\x1f";

// Fake `git` process: dispatch on the subcommand. Reads return fixtures; `commit`
// exits non-zero so the route's GitError→400 mapping is exercised; other mutations
// succeed. The real controller + porcelain parsers run on top of this.
const fakeGit: GitRunner = async (args) => {
  const ok = (stdout: string) => ({ stdout, stderr: "", code: 0 });
  switch (args[0]) {
    case "--version": return ok("git version 2.42.0\n");
    case "rev-parse":
      if (args.includes("--git-path")) return ok(".git/info/exclude\n");
      if (args.includes("--abbrev-ref")) return ok("origin/main\n"); // @{upstream} / origin/HEAD
      return ok("/repo\n");
    case "status": return ok([
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +1 -0",
      "1 M. N... 100644 100644 100644 hhh iii staged.ts",
      "1 .M N... 100644 100644 100644 hhh iii changed.ts",
      "? new.ts",
    ].join("\n"));
    case "log": return ok(["abc123", "", "Ale", "ale@x", "1700000000", "HEAD -> refs/heads/main", "initial commit", "the body"].join(US));
    case "remote": return ok("origin\n");
    case "fetch": return { stdout: "", stderr: "", code: 0 }; // nothing new
    case "pull": return ok("Already up to date.\n");
    case "push": return { stdout: "", stderr: "Everything up-to-date\n", code: 0 };
    case "branch": return ok(["*", "main", "origin/main"].join(US));
    case "worktree": return ok("worktree /repo\nHEAD aaa111\nbranch refs/heads/main\n");
    case "clone": return ok("Cloning into '/repo/r'...\n");
    case "merge": return ok("Updating a..b\nFast-forward\n");
    case "merge-tree": return ok("0123abcd\n"); // clean: just the written-tree OID, exit 0
    case "diff": return args.includes("--name-status") ? ok("M\tsrc/a.ts\nA\tnew.ts\n") : ok("@@ -0,0 +1 @@\n+hello\n");
    case "diff-tree": return ok("M\tsrc/a.ts\nA\tnew.ts\n");
    case "show":
      // `git show <rev>:<file>` (no `--format`) prints a raw blob; the old diff path uses --format=.
      return args.includes("--format=") ? ok("@@ -0,0 +1 @@\n+hello\n") : ok("file contents at rev\n");
    case "commit": return { stdout: "", stderr: "nothing to commit, working tree clean\n", code: 1 };
    default: return ok(""); // add / reset / etc.
  }
};

// Fake `gh` process: installed + authed, with one PR and one run.
const fakeGh: GhRunner = async (args) => {
  const ok = (stdout: string) => ({ stdout, stderr: "", code: 0 });
  switch (args[0]) {
    case "--version": return ok("gh version 2.0.0\n");
    case "auth":
      if (args[1] === "token") return ok("gho_faketoken\n");
      if (args[1] === "status") return ok([
        "github.com",
        "  ✓ Logged in to github.com account ale (keyring)",
        "  - Active account: true",
        "  ✓ Logged in to github.com account ale-work (keyring)",
        "  - Active account: false",
      ].join("\n"));
      return ok("Logged in\n");
    case "api":
      if (args[1] === "user") return ok("ale\n");
      if (args[1] === "user/orgs") return ok("acme\n");
      return ok("");
    case "repo":
      if (args[1] === "list") return ok(JSON.stringify([
        { nameWithOwner: "ale/proj", name: "proj", description: "a project", isPrivate: false, isFork: false, url: "https://github.com/ale/proj", sshUrl: "git@github.com:ale/proj.git", updatedAt: "2026-06-01" },
        { nameWithOwner: "ale/secret", name: "secret", description: "", isPrivate: true, isFork: false, url: "https://github.com/ale/secret", sshUrl: "git@github.com:ale/secret.git", updatedAt: "2026-06-10" },
      ]));
      if (args[1] === "clone") return ok("Cloning into 'proj'...\n");
      // repo create — fail for the "taken" owner so the GhError→400 path is exercised
      return args.includes("taken/dup")
        ? { stdout: "", stderr: "GraphQL: Name already exists on this account\n", code: 1 }
        : ok("https://github.com/ale/proj\n");
    case "pr": // `pr list` returns JSON; create prints the new PR url; comment/merge/close just succeed
      if (args[1] === "list") return ok(JSON.stringify([
        { number: 7, title: "Add X", author: { login: "ale" }, headRefName: "feat/x", state: "OPEN", url: "http://pr/7", isDraft: false },
      ]));
      if (args[1] === "create") return ok("https://github.com/ale/proj/pull/8\n");
      return ok("");
    case "run": return ok(JSON.stringify([
      { databaseId: 99, name: "CI", displayTitle: "build", status: "completed", conclusion: "success", headBranch: "main", event: "push", createdAt: "2026-06-07", url: "http://run/99" },
    ]));
    default: return ok("");
  }
};

function build() {
  const ctx = {
    store: createStore(":memory:"),
    tmux: createTmuxController(async () => ""),
    git: createGitController(fakeGit),
    github: createGithubController(fakeGh),
  };
  const app = Fastify();
  app.register(async a => gitRoutes(a, ctx));
  return { app, ctx };
}

describe("git routes", () => {
  let h: ReturnType<typeof build>;
  beforeEach(() => { h = build(); });

  const get = (url: string) => h.app.inject({ method: "GET", url });
  const post = (url: string, payload: unknown) => h.app.inject({ method: "POST", url, payload });

  it("GET /api/git/info reports installed + repo", async () => {
    const res = await get("/api/git/info?path=/repo");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ installed: true, version: "2.42.0", isRepo: true, root: "/repo" });
  });

  it("GET /api/git/status splits staged / unstaged / untracked and reads the branch header", async () => {
    const body = (await get("/api/git/status?path=/repo")).json();
    expect(body.branch).toBe("main");
    expect(body.upstream).toBe("origin/main");
    expect(body.ahead).toBe(1);
    expect(body.staged.map((f: any) => f.path)).toEqual(["staged.ts"]);
    expect(body.unstaged.map((f: any) => f.path)).toEqual(["changed.ts"]);
    expect(body.untracked).toEqual(["new.ts"]);
    expect(body.remotes).toEqual(["origin"]);
  });

  it("GET /api/git/log parses commits", async () => {
    const { commits } = (await get("/api/git/log?path=/repo")).json();
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      hash: "abc123", author: "Ale", subject: "initial commit", body: "the body",
      refs: [{ name: "main", kind: "branch", current: true }],
    });
  });

  it("GET /api/git/branches parses the current branch", async () => {
    const { branches } = (await get("/api/git/branches?path=/repo")).json();
    expect(branches).toEqual([{ name: "main", current: true, upstream: "origin/main" }]);
  });

  it("GET /api/git/default-branch resolves origin/HEAD to the bare branch name", async () => {
    const { branch } = (await get("/api/git/default-branch?path=/repo")).json();
    expect(branch).toBe("main");
  });

  it("GET /api/git/default-branch 400s without a path", async () => {
    expect((await get("/api/git/default-branch")).statusCode).toBe(400);
  });

  it("GET /api/git/worktrees lists the main worktree", async () => {
    const { worktrees } = (await get("/api/git/worktrees?path=/repo")).json();
    expect(worktrees).toEqual([
      { path: "/repo", head: "aaa111", branch: "main", bare: false, detached: false, locked: false, main: true },
    ]);
  });

  it("GET /api/git/diff returns the diff text", async () => {
    const { diff } = (await get("/api/git/diff?path=/repo&file=staged.ts&staged=true")).json();
    expect(diff).toContain("+hello");
  });

  it("GET /api/git/commit-diff returns the commit patch", async () => {
    const { diff } = (await get("/api/git/commit-diff?path=/repo&hash=abc123")).json();
    expect(diff).toContain("+hello");
  });

  it("GET /api/git/commit-diff 400s on a non-hex hash", async () => {
    expect((await get("/api/git/commit-diff?path=/repo&hash=../etc")).statusCode).toBe(400);
  });

  it("GET /api/git/show-file returns a file's content at a rev", async () => {
    const res = await get("/api/git/show-file?path=/repo&rev=HEAD&file=src%2Fa.ts");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ content: "file contents at rev\n" });
  });

  it("GET /api/git/show-file allows an empty rev (the index side)", async () => {
    expect((await get("/api/git/show-file?path=/repo&file=a.ts")).statusCode).toBe(200);
  });

  it("GET /api/git/show-file 400s on a rev that starts like a git option", async () => {
    expect((await get("/api/git/show-file?path=/repo&rev=-output&file=a.ts")).statusCode).toBe(400);
  });

  it("GET /api/git/show-file-bytes returns the null shape when the object is absent, 400s on a bad rev", async () => {
    // The fake repo path resolves to no real git object, so the bytes reader returns null gracefully.
    const ok = await get("/api/git/show-file-bytes?path=/repo&rev=HEAD&file=img.jpg");
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ dataBase64: null, size: 0 });
    expect((await get("/api/git/show-file-bytes?path=/repo&rev=-output&file=a.png")).statusCode).toBe(400);
  });

  it("GET /api/git/commit-files lists the files a commit touched", async () => {
    const { files } = (await get("/api/git/commit-files?path=/repo&hash=abc123")).json();
    expect(files).toEqual([{ status: "M", path: "src/a.ts" }, { status: "A", path: "new.ts" }]);
  });

  it("POST /api/git/push returns git's status message so the UI can confirm it", async () => {
    const res = await post("/api/git/push", { path: "/repo" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ message: "Everything up-to-date" });
  });

  it("POST /api/git/fetch confirms even when nothing is new", async () => {
    expect((await post("/api/git/fetch", { path: "/repo" })).json()).toEqual({ message: "Fetched." });
  });

  it("POST /api/git/pull returns git's pull transcript", async () => {
    expect((await post("/api/git/pull", { path: "/repo" })).json()).toEqual({ message: "Already up to date." });
  });

  it("POST /api/git/sync pulls then pushes and returns the push message", async () => {
    expect((await post("/api/git/sync", { path: "/repo" })).json()).toEqual({ message: "Everything up-to-date" });
  });

  it("POST /api/git/stash/file stashes a single pathspec", async () => {
    const res = await post("/api/git/stash/file", { path: "/repo", file: "changed.ts" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("POST /api/git/stash/file 400s without a file", async () => {
    expect((await post("/api/git/stash/file", { path: "/repo" })).statusCode).toBe(400);
  });

  it("POST /api/git/uncommit soft-resets and returns ok", async () => {
    const res = await post("/api/git/uncommit", { path: "/repo" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("POST /api/git/stage succeeds", async () => {
    const res = await post("/api/git/stage", { path: "/repo", files: ["staged.ts"] });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("POST /api/git/commit maps a GitError to 400 with git's stderr + exit code", async () => {
    const res = await post("/api/git/commit", { path: "/repo", message: "x" });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toContain("nothing to commit");
    expect(body.code).toBe(1);
  });

  it("GET /api/git/info 400s without a path", async () => {
    expect((await get("/api/git/info")).statusCode).toBe(400);
  });

  it("POST /api/git/stage 400s without files", async () => {
    expect((await post("/api/git/stage", { path: "/repo" })).statusCode).toBe(400);
  });

  it("POST /api/git/commit 400s without a message", async () => {
    expect((await post("/api/git/commit", { path: "/repo" })).statusCode).toBe(400);
  });

  it("POST /api/git/ignore appends the anchored line to the repo .gitignore", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tr-route-ignore-"));
    const res = await post("/api/git/ignore", { path: dir, file: "secret.env", scope: "repo" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ line: "/secret.env", added: true });
    expect(await fs.readFile(path.join(dir, ".gitignore"), "utf8")).toBe("/secret.env\n");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("POST /api/git/ignore 400s without a scope", async () => {
    expect((await post("/api/git/ignore", { path: "/repo", file: "x" })).statusCode).toBe(400);
  });

  it("GET /api/git/github/info reports installed + authed", async () => {
    expect((await get("/api/git/github/info?path=/repo")).json()).toEqual({ installed: true, authed: true });
  });

  it("GET /api/git/github/owners returns the login and orgs", async () => {
    expect((await get("/api/git/github/owners?path=/repo")).json()).toEqual({ login: "ale", orgs: ["acme"] });
  });

  it("GET /api/git/github/owners accepts an account to scope the lookup", async () => {
    const res = await get("/api/git/github/owners?path=/repo&account=ale-work");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ login: "ale", orgs: ["acme"] });
  });

  it("POST /api/git/github/publish creates the repo and returns its url", async () => {
    const res = await post("/api/git/github/publish", { path: "/repo", name: "proj", owner: "ale", visibility: "private" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ url: "https://github.com/ale/proj" });
  });

  it("POST /api/git/github/publish accepts an account to publish under", async () => {
    const res = await post("/api/git/github/publish", { path: "/repo", name: "proj", owner: "ale", visibility: "private", account: "ale-work" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ url: "https://github.com/ale/proj" });
  });

  it("POST /api/git/github/publish maps a gh failure to 400 with gh's stderr", async () => {
    const res = await post("/api/git/github/publish", { path: "/repo", name: "dup", owner: "taken", visibility: "private" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Name already exists");
  });

  it("POST /api/git/github/publish 400s without a name", async () => {
    expect((await post("/api/git/github/publish", { path: "/repo", owner: "ale", visibility: "private" })).statusCode).toBe(400);
  });

  it("GET /api/git/github/prs lists pull requests", async () => {
    const { prs } = (await get("/api/git/github/prs?path=/repo")).json();
    expect(prs).toEqual([
      { number: 7, title: "Add X", author: "ale", branch: "feat/x", state: "OPEN", url: "http://pr/7", draft: false },
    ]);
  });

  it("POST /api/git/github/pr/create opens a PR and returns its url", async () => {
    const res = await post("/api/git/github/pr/create", { path: "/repo", title: "Add X", base: "main" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ url: "https://github.com/ale/proj/pull/8" });
  });

  it("POST /api/git/github/pr/create 400s without a title", async () => {
    expect((await post("/api/git/github/pr/create", { path: "/repo" })).statusCode).toBe(400);
  });

  it("GET /api/git/github/runs lists Actions runs", async () => {
    const { runs } = (await get("/api/git/github/runs?path=/repo")).json();
    expect(runs).toEqual([
      { id: 99, name: "CI", title: "build", status: "completed", conclusion: "success", branch: "main", event: "push", createdAt: "2026-06-07", url: "http://run/99" },
    ]);
  });

  it("POST /api/git/branch/rename renames a branch", async () => {
    const res = await post("/api/git/branch/rename", { path: "/repo", name: "old", newName: "new" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("POST /api/git/branch/rename 400s on a newName that looks like a git option", async () => {
    expect((await post("/api/git/branch/rename", { path: "/repo", name: "old", newName: "-x" })).statusCode).toBe(400);
  });

  it("POST /api/git/clone clones into <parent>/<name> and returns the path", async () => {
    const res = await post("/api/git/clone", { url: "https://github.com/u/r.git", parent: "/repo", name: "r" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ path: "/repo/r" });
  });

  it("POST /api/git/clone 400s on a url that looks like a git option", async () => {
    expect((await post("/api/git/clone", { url: "-x", parent: "/repo", name: "r" })).statusCode).toBe(400);
  });

  it("POST /api/git/clone 400s on a name with a path separator", async () => {
    expect((await post("/api/git/clone", { url: "https://x/y.git", parent: "/repo", name: "a/b" })).statusCode).toBe(400);
  });

  it("GET /api/git/github/accounts lists every signed-in account with the active one flagged", async () => {
    const { installed, accounts } = (await get("/api/git/github/accounts")).json();
    expect(installed).toBe(true);
    expect(accounts).toEqual([
      { host: "github.com", login: "ale", active: true },
      { host: "github.com", login: "ale-work", active: false },
    ]);
  });

  it("GET /api/git/github/repos lists the signed-in user's repos", async () => {
    const { repos } = (await get("/api/git/github/repos")).json();
    expect(repos.map((r: any) => r.nameWithOwner)).toEqual(["ale/proj", "ale/secret"]);
    expect(repos[1].isPrivate).toBe(true);
  });

  it("GET /api/git/github/repos accepts an account to scope the listing", async () => {
    const res = await get("/api/git/github/repos?account=ale-work");
    expect(res.statusCode).toBe(200);
    expect(res.json().repos.map((r: any) => r.nameWithOwner)).toEqual(["ale/proj", "ale/secret"]);
  });

  it("POST /api/git/github/clone clones the picked repo into <parent>/<name>", async () => {
    const res = await post("/api/git/github/clone", { repo: "ale/proj", parent: "/repo", name: "proj" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ path: "/repo/proj" });
  });

  it("POST /api/git/github/clone scopes to a given account and still returns the path", async () => {
    const res = await post("/api/git/github/clone", { repo: "ale/proj", parent: "/repo", name: "proj", account: "ale-work" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ path: "/repo/proj" });
  });

  it("POST /api/git/github/clone 400s on a bad repo slug", async () => {
    expect((await post("/api/git/github/clone", { repo: "not-a-slug", parent: "/repo", name: "x" })).statusCode).toBe(400);
  });

  it("POST /api/git/init initializes a repository", async () => {
    const res = await post("/api/git/init", { path: "/repo" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("POST /api/git/init 400s without a path", async () => {
    expect((await post("/api/git/init", {})).statusCode).toBe(400);
  });

  it("POST /api/git/merge returns git's transcript", async () => {
    const res = await post("/api/git/merge", { path: "/repo", branch: "feat" });
    expect(res.statusCode).toBe(200);
    expect(res.json().message).toContain("Fast-forward");
  });

  it("POST /api/git/merge 400s on a branch that looks like a git option", async () => {
    expect((await post("/api/git/merge", { path: "/repo", branch: "-x" })).statusCode).toBe(400);
  });

  it("GET /api/git/merge-preview reports a clean merge", async () => {
    const res = await get("/api/git/merge-preview?path=/repo&branch=feat");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ clean: true, conflicts: [] });
  });

  it("GET /api/git/merge-preview 400s on a branch that looks like a git option", async () => {
    expect((await get("/api/git/merge-preview?path=/repo&branch=-x")).statusCode).toBe(400);
  });

  it("GET /api/git/stash-files lists the files a stash changed", async () => {
    const res = await get("/api/git/stash-files?path=/repo&ref=" + encodeURIComponent("stash@{0}"));
    expect(res.statusCode).toBe(200);
    expect(res.json().files).toEqual([{ status: "M", path: "src/a.ts" }, { status: "A", path: "new.ts" }]);
  });

  it("GET /api/git/stash-files 400s on a ref that isn't a stash", async () => {
    expect((await get("/api/git/stash-files?path=/repo&ref=HEAD")).statusCode).toBe(400);
  });

  it("POST /api/git/github/pr/comment posts a comment", async () => {
    const res = await post("/api/git/github/pr/comment", { path: "/repo", number: 7, body: "nice" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("POST /api/git/github/pr/comment 400s on an empty body", async () => {
    expect((await post("/api/git/github/pr/comment", { path: "/repo", number: 7, body: "" })).statusCode).toBe(400);
  });

  it("POST /api/git/github/pr/merge merges with the chosen method", async () => {
    const res = await post("/api/git/github/pr/merge", { path: "/repo", number: 7, method: "squash" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("POST /api/git/github/pr/merge 400s on an unknown method", async () => {
    expect((await post("/api/git/github/pr/merge", { path: "/repo", number: 7, method: "bogus" })).statusCode).toBe(400);
  });

  it("POST /api/git/github/pr/close closes the PR", async () => {
    const res = await post("/api/git/github/pr/close", { path: "/repo", number: 7 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

// Account-scoped init: identity resolution from a chosen gh account + the optional first commit.
// Uses recording runners so we can assert the exact git config / add / commit sequence the route runs.
describe("account-scoped git init", () => {
  // gh returning a real profile JSON for `api user`; the email branch is parameterized per test.
  const ghUser = (profile: object): GhRunner => async (args) => {
    const ok = (s: string) => ({ stdout: s, stderr: "", code: 0 });
    if (args[0] === "--version") return ok("gh version 2.0.0\n");
    if (args[0] === "auth" && args[1] === "token") return ok("gho_tok\n");
    if (args[0] === "api" && args[1] === "user") return ok(JSON.stringify(profile));
    return ok("");
  };

  function build2(gh: GhRunner) {
    const calls: string[][] = [];
    const git: GitRunner = async (args) => {
      calls.push(args);
      return { stdout: args[0] === "--version" ? "git version 2.42.0\n" : "", stderr: "", code: 0 };
    };
    const ctx = {
      store: createStore(":memory:"),
      tmux: createTmuxController(async () => ""),
      git: createGitController(git),
      github: createGithubController(gh),
    };
    const app = Fastify();
    app.register(async a => gitRoutes(a, ctx));
    return { app, calls };
  }

  it("sets the chosen account's identity locally and makes the first commit", async () => {
    const { app, calls } = build2(ghUser({ login: "ale-work", id: 42, name: "Ale Work", email: "ale@work.com" }));
    const res = await app.inject({
      method: "POST", url: "/api/git/init",
      payload: { path: "/repo", account: "ale-work", commit: { message: "Initial commit" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(calls).toContainEqual(["init"]);
    expect(calls).toContainEqual(["config", "user.name", "Ale Work"]);
    expect(calls).toContainEqual(["config", "user.email", "ale@work.com"]);
    expect(calls).toContainEqual(["add", "-A", "--ignore-errors"]); // stageAll
    expect(calls).toContainEqual(["commit", "-m", "Initial commit"]);
  });

  it("falls back to the noreply email when the account's profile email is private", async () => {
    const { app, calls } = build2(ghUser({ login: "ale", id: 7, name: "", email: null }));
    const res = await app.inject({ method: "POST", url: "/api/git/init", payload: { path: "/repo", account: "ale" } });
    expect(res.statusCode).toBe(200);
    expect(calls).toContainEqual(["config", "user.name", "ale"]); // empty profile name → login
    expect(calls).toContainEqual(["config", "user.email", "7+ale@users.noreply.github.com"]);
    expect(calls).not.toContainEqual(["commit", "-m", "Initial commit"]); // no commit requested
  });

  it("GET /api/git/github/identity returns the account's resolved commit identity", async () => {
    const { app } = build2(ghUser({ login: "ale", id: 9, name: "Ale", email: null }));
    const res = await app.inject({ method: "GET", url: "/api/git/github/identity?account=ale" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ login: "ale", name: "Ale", email: "9+ale@users.noreply.github.com" });
  });
});
