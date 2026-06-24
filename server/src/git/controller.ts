import { promises as fs } from "node:fs";
import path from "node:path";
import { realRunner, type GitRunner, type GitResult } from "./run.js";
import type { RepoAuthEnv } from "./github.js";
import {
  parseStatus, parseLog, parseBranches, parseWorktrees, LOG_FORMAT, BRANCH_FORMAT,
} from "./porcelain.js";
import { ignoreLine, appendIgnoreLine } from "./ignore.js";
import type { GitInfo, GitStatus, GitCommit, GitBranch, GitWorktree } from "./types.js";

/** Thrown when a mutating git command exits non-zero. Carries git's stderr verbatim. */
export class GitError extends Error {
  constructor(message: string, readonly code: number) {
    super(message.trim() || "git command failed");
    this.name = "GitError";
  }
}

/**
 * Resolves which signed-in GitHub account git should authenticate as for a repo's network ops, given
 * that repo's `origin` URL. Injected by the app context (backed by the gh controller's `repoAuth`);
 * absent in tests/standalone, where git uses its ambient (active-account) credential as before.
 */
export type GitAuthResolver = (originUrl: string) => Promise<RepoAuthEnv>;

export interface StashEntry { ref: string; message: string; }
/** One file touched by a commit, from its name-status. `status` is git's letter (M/A/D/R…). */
export interface CommitFile { status: string; path: string; }

export interface GitController {
  info(cwd: string): Promise<GitInfo>;
  init(cwd: string): Promise<void>; // `git init` — put this folder under version control
  // Set this repo's LOCAL commit identity (user.name / user.email) — repo-scoped config that overrides
  // global/includeIf for just this repo. Used when a fresh repo is initialized under a chosen account.
  setIdentity(cwd: string, name: string, email: string): Promise<void>;
  // `git clone <url>` into <parentDir>/<folderName>; returns the new folder's absolute path so it
  // can become a workspace. git creates the target dir (and fails loudly if it already exists).
  clone(parentDir: string, url: string, folderName: string): Promise<{ path: string }>;

  status(cwd: string): Promise<GitStatus>;
  ignored(cwd: string): Promise<string[]>; // gitignored paths (whole ignored dirs collapsed to "dir/")
  // Untracked entries with wholly-untracked dirs collapsed to "dir/" (.gitignore honored) — a cheap
  // top-level inventory of a fresh repo, used to summarize an initial commit WITHOUT staging everything.
  listUntracked(cwd: string): Promise<string[]>;
  diff(cwd: string, path: string, opts?: { staged?: boolean; untracked?: boolean }): Promise<string>;
  commitDiff(cwd: string, hash: string): Promise<string>; // full patch a commit introduced (vs its first parent)
  showFile(cwd: string, rev: string, file: string): Promise<string>; // a file's content at a rev (`HEAD`, `` for the index, a hash, `hash^`); "" if absent
  commitFiles(cwd: string, hash: string): Promise<CommitFile[]>; // files a commit touched (name-status), for a per-file side-by-side diff
  stagedDiff(cwd: string): Promise<string>; // whole staged diff, for AI commit-message generation
  stagedNameStatus(cwd: string): Promise<string>;
  stage(cwd: string, paths: string[]): Promise<void>;
  unstage(cwd: string, paths: string[]): Promise<void>;
  stageAll(cwd: string): Promise<void>;
  unstageAll(cwd: string): Promise<void>;
  discard(cwd: string, paths: string[]): Promise<void>;
  cleanUntracked(cwd: string): Promise<void>; // delete untracked (non-ignored) files + dirs — git clean -fd
  commit(cwd: string, message: string): Promise<void>;
  uncommit(cwd: string): Promise<void>; // undo the last commit, keeping its changes staged (soft reset)
  branches(cwd: string): Promise<GitBranch[]>;
  checkout(cwd: string, branch: string): Promise<void>;
  createBranch(cwd: string, name: string): Promise<void>;
  renameBranch(cwd: string, oldName: string, newName: string): Promise<void>;
  deleteBranch(cwd: string, name: string, force?: boolean): Promise<void>;
  merge(cwd: string, branch: string): Promise<string>; // git's transcript ("Fast-forward …" / "Merge made …")
  // Non-destructive conflict check: `git merge-tree` computes the merge in memory without touching
  // the working tree. `clean` ⇒ would merge cleanly; otherwise `conflicts` lists the clashing paths.
  mergePreview(cwd: string, branch: string): Promise<{ clean: boolean; conflicts: string[] }>;
  log(cwd: string, limit?: number): Promise<GitCommit[]>;
  // The repo's base branch for a PR: the remote's default (origin/HEAD → "main"), else the first of
  // main/master/develop that exists locally, else null. Used to preselect the PR base + scope generation.
  defaultBranch(cwd: string): Promise<string | null>;
  // The commits unique to HEAD over `base` (newest first, subject + body) and the files changed vs the
  // merge-base (name-status) — the raw material the AI PR-description generator summarizes.
  prContext(cwd: string, base: string): Promise<{ commits: string; files: string }>;
  worktrees(cwd: string): Promise<GitWorktree[]>;
  // `newBranch` ⇒ `git worktree add -b <branch> <path>` (create the branch in the new worktree);
  // otherwise `git worktree add <path> <branch>` (check out an existing branch).
  worktreeAdd(cwd: string, path: string, branch: string, newBranch?: boolean): Promise<void>;
  worktreeRemove(cwd: string, path: string, force?: boolean): Promise<void>;
  fetch(cwd: string): Promise<string>; // git's transcript ("Fetched." when nothing new)
  pull(cwd: string): Promise<string>; // "Already up to date." / "Fast-forward …"
  push(cwd: string, setUpstream?: boolean): Promise<string>; // git's status line ("Everything up-to-date" / "… -> main")
  sync(cwd: string): Promise<string>; // diverged branch: pull (merge) then push, in one go
  stashList(cwd: string): Promise<StashEntry[]>;
  stashFiles(cwd: string, ref: string): Promise<CommitFile[]>; // files a stash changed vs its base, for a side-by-side diff
  stashSave(cwd: string, message: string, includeUntracked: boolean): Promise<void>;
  stashFile(cwd: string, file: string | string[], message?: string): Promise<void>; // stash one or more pathspecs (incl. if untracked) into one stash, optionally named
  stashApply(cwd: string, ref: string): Promise<void>;
  stashPop(cwd: string, ref: string): Promise<void>;
  stashDrop(cwd: string, ref: string): Promise<void>;
  // Append `file` (repo-relative) to an ignore file, then untrack it so the rule takes effect on
  // an already-tracked path. `local` → .git/info/exclude (per-clone); `repo` → the shared .gitignore.
  ignore(cwd: string, file: string, opts: { scope: "local" | "repo"; isDir: boolean }): Promise<{ line: string; added: boolean }>;
}

export function createGitController(run: GitRunner = realRunner, resolveAuth?: GitAuthResolver): GitController {
  // Read: ignore non-zero (git uses exit codes as data), just hand back stdout.
  const read = async (args: string[], cwd: string) => (await run(args, cwd)).stdout;
  // Mutate: a non-zero exit is a real failure — surface git's stderr to the caller.
  const mutate = async (args: string[], cwd: string) => {
    const r = await run(args, cwd);
    if (r.code !== 0) throw new GitError(r.stderr || r.stdout, r.code);
    return r.stdout;
  };

  // A network op failed because git couldn't AUTHENTICATE to the remote — as opposed to a real git
  // outcome like a non-fast-forward push or a merge conflict, which must surface as-is and never be
  // retried as a different account. GitHub returns "Repository not found" (a 404, not 403) for a private
  // repo the current credential can't see — exactly the multi-account case worth retrying.
  const isAuthFail = (r: GitResult) =>
    r.code !== 0 &&
    /repository not found|authentication failed|could not read username|terminal prompts disabled|invalid username or password|permission to .* denied|403 forbidden|fatal: could not read/i
      .test(`${r.stderr}\n${r.stdout}`);

  // Run a network op (fetch/pull/push) as the right GitHub account. With no resolver (tests/standalone)
  // it's a plain single run — no behavior change. Otherwise it injects the owning account's token up
  // front and, ONLY if the attempt fails to authenticate, retries with each other signed-in account, so
  // a private repo owned by a non-active account (or an org) works without the user switching gh accounts.
  const runNet = async (args: string[], cwd: string): Promise<GitResult> => {
    if (!resolveAuth) return run(args, cwd);
    const originUrl = (await run(["remote", "get-url", "origin"], cwd)).stdout.trim();
    const { primary, fallbacks } = await resolveAuth(originUrl);
    const attempts: (Record<string, string> | undefined)[] = primary ? [primary, ...fallbacks] : [undefined, ...fallbacks];
    let last = await run(args, cwd, attempts[0]);
    for (let i = 1; i < attempts.length; i++) {
      if (last.code === 0 || !isAuthFail(last)) return last;
      last = await run(args, cwd, attempts[i]);
    }
    return last;
  };

  // The refs the graph log walks. VS Code's SCM graph scopes to the current branch's "history item
  // group" — HEAD, its upstream tracking ref, and the repo's base/default branch — and feeds those
  // as explicit revs (filter default `'auto'`, scmHistoryViewPane.ts). It never passes `--all`:
  // `--all` unions every branch tip, so tips NOT reachable from HEAD appear as lanes that pop in
  // mid-graph and never connect within the window (a branchy repo shatters into fragments). Scoping
  // to these refs is what makes the DAG read as one connected graph. Missing refs (no upstream,
  // local-only repo) are skipped; the union always includes HEAD, so a fresh repo still works.
  const graphRefs = async (cwd: string): Promise<string[]> => {
    const refs = ["HEAD"];
    const add = async (rev: string) => {
      const r = await run(["rev-parse", "--abbrev-ref", rev], cwd);
      const name = r.stdout.trim();
      if (r.code === 0 && name && name !== rev) refs.push(name); // non-zero / echoed-back input = unresolved
    };
    await add("@{upstream}"); // remote-tracking ref → the branch's incoming/outgoing commits
    await add("origin/HEAD"); // the remote's default branch → the base lane (e.g. origin/main)
    return [...new Set(refs)];
  };

  return {
    async info(cwd) {
      const ver = await run(["--version"], cwd);
      if (ver.code === -1) return { installed: false, version: null, isRepo: false, root: null };
      const version = ver.stdout.replace(/^git version /, "").trim() || null;
      const top = await run(["rev-parse", "--show-toplevel"], cwd);
      const isRepo = top.code === 0;
      return { installed: true, version, isRepo, root: isRepo ? top.stdout.trim() : null };
    },

    init: (cwd) => mutate(["init"], cwd).then(() => undefined),

    // Repo-local `git config` for the two identity keys. Repo-scoped (no --global) so it can't disturb
    // the host's global identity or any includeIf rule for other repos. name/email come from the chosen
    // account's resolved GitHub profile, so neither is empty.
    async setIdentity(cwd, name, email) {
      await mutate(["config", "user.name", name], cwd);
      await mutate(["config", "user.email", email], cwd);
    },

    // `--` ends option parsing so a url/dir that begins with "-" can't pose as a git flag (the route
    // also rejects a leading "-" url and a folderName with separators). Credential prompts are
    // disabled in the runner, so a private https repo without configured creds fails fast.
    async clone(parentDir, url, folderName) {
      const parent = path.resolve(parentDir);
      const target = path.join(parent, folderName);
      const r = await run(["clone", "--", url, target], parent);
      if (r.code !== 0) throw new GitError(r.stderr || r.stdout, r.code);
      return { path: target };
    },

    async status(cwd) {
      // --untracked-files=all lists every untracked FILE. Git's default ("normal") collapses a
      // wholly-untracked folder into a single `dir/` entry, so a new directory showed as one row
      // and its files stayed hidden until a Stage All (`git add -A`) expanded them — VS Code uses
      // -uall for exactly this reason. .gitignore is still honoured, so node_modules/ etc. stay out.
      const s = parseStatus(await read(["status", "--porcelain=v2", "--branch", "--untracked-files=all"], cwd));
      // Remotes aren't in `status` output — a separate (instant, local) read tells the UI
      // whether the repo has ever been published, so it can offer "Publish to GitHub".
      s.remotes = (await read(["remote"], cwd)).split("\n").map(r => r.trim()).filter(Boolean);
      return s;
    },

    // Ignored paths for the explorer's "grey out" decoration. `--directory` collapses a
    // wholly-ignored folder (node_modules/, dist/) into one entry instead of every file.
    async ignored(cwd) {
      const out = await read(["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"], cwd);
      return out.split("\n").map(l => l.trim().replace(/\/$/, "")).filter(Boolean);
    },

    // Untracked entries, dirs collapsed (--directory) so a fresh repo's huge folders (node_modules/)
    // are ONE line each instead of every file — keeps it instant and the summary readable. No staging.
    async listUntracked(cwd) {
      const out = await read(["ls-files", "--others", "--exclude-standard", "--directory"], cwd);
      return out.split("\n").map(l => l.trim()).filter(Boolean);
    },

    async diff(cwd, path, opts = {}) {
      if (opts.untracked) {
        // Untracked files aren't known to git, so a normal diff is empty. --no-index
        // against /dev/null renders the whole file as additions (exits 1 — not an error).
        return read(["diff", "--no-color", "--no-index", "--", "/dev/null", path], cwd);
      }
      const args = ["diff", "--no-color"];
      if (opts.staged) args.push("--cached");
      args.push("--", path);
      return read(args, cwd);
    },

    // Empty --format suppresses the commit header so only the unified patch comes back
    // (the same shape `diff` returns), which the web DiffView already knows how to render.
    commitDiff: (cwd, hash) => read(["show", "--no-color", "--format=", hash], cwd),

    // Raw blob at a revision (`git show <rev>:<file>`). An empty rev yields `:file` — the
    // index (stage 0). `read` swallows git's non-zero exit, so a file absent from that rev
    // (added, deleted, root commit) comes back as "" — exactly the empty side a diff wants.
    showFile: (cwd, rev, file) => read(["show", `${rev}:${file}`], cwd),

    // The files a commit touched, so the diff can render one side-by-side view per file.
    // --root makes the first (parentless) commit list its files instead of nothing.
    async commitFiles(cwd, hash) {
      const out = await read(["diff-tree", "--no-commit-id", "--name-status", "-r", "--root", hash], cwd);
      return out.split("\n").filter(Boolean).map(line => {
        const parts = line.split("\t");
        // Renames/copies are "R100\told\tnew" — take the last field as the current path.
        return { status: parts[0][0], path: parts[parts.length - 1] };
      });
    },

    stagedDiff: (cwd) => read(["diff", "--cached", "--no-color"], cwd),
    stagedNameStatus: (cwd) => read(["diff", "--cached", "--name-status"], cwd),

    stage: (cwd, paths) => mutate(["add", "--", ...paths], cwd).then(() => undefined),
    unstage: (cwd, paths) => mutate(["reset", "-q", "HEAD", "--", ...paths], cwd).then(() => undefined),
    // `--ignore-errors` so one unindexable path can't make `git add -A` abort atomically and stage
    // NOTHING. Without it, an embedded git repo with no commit checked out (a half-cloned skill
    // folder, `.git` but no HEAD) fails the WHOLE command with exit 128 — so "Stage All" silently
    // stages nothing. With the flag git stages every other change and just skips that path, exiting
    // 1 (non-fatal "some paths skipped"). Only a real fatal exit (128: not a repo, bad pathspec)
    // throws; exit 1 is the expected partial-success and resolves normally.
    async stageAll(cwd) {
      const r = await run(["add", "-A", "--ignore-errors"], cwd);
      if (r.code !== 0 && r.code !== 1) throw new GitError(r.stderr || r.stdout, r.code);
    },
    unstageAll: (cwd) => mutate(["reset", "-q", "HEAD", "--"], cwd).then(() => undefined),
    // Restore worktree to HEAD for tracked paths. Untracked files are left untouched
    // (git can't restore what it doesn't track — the route handles those separately).
    discard: (cwd, paths) => mutate(["checkout", "--", ...paths], cwd).then(() => undefined),
    // -f force, -d recurse into untracked dirs. No -x, so .gitignore'd files are kept (we only
    // trash what shows as untracked in status). Destructive — surfaced behind a UI confirm modal.
    cleanUntracked: (cwd) => mutate(["clean", "-fd"], cwd).then(() => undefined),
    commit: (cwd, message) => mutate(["commit", "-m", message], cwd).then(() => undefined),
    // Soft reset: moves HEAD back one commit but leaves the index + worktree intact, so the
    // undone commit's changes reappear staged. Non-destructive — no file content is lost.
    uncommit: (cwd) => mutate(["reset", "--soft", "HEAD~1"], cwd).then(() => undefined),

    branches: (cwd) => read(["branch", "--format", BRANCH_FORMAT], cwd).then(parseBranches),
    checkout: (cwd, branch) => mutate(["checkout", branch], cwd).then(() => undefined),
    createBranch: (cwd, name) => mutate(["checkout", "-b", name], cwd).then(() => undefined),
    renameBranch: (cwd, oldName, newName) => mutate(["branch", "-m", oldName, newName], cwd).then(() => undefined),
    deleteBranch: (cwd, name, force) => mutate(["branch", force ? "-D" : "-d", name], cwd).then(() => undefined),

    // --no-edit so a non-fast-forward merge never blocks on $EDITOR for the merge-commit message.
    // A conflict exits non-zero (and leaves the tree mid-merge) — surfaced to the UI via GitError.
    async merge(cwd, branch) {
      const r = await run(["merge", "--no-edit", branch], cwd);
      if (r.code !== 0) throw new GitError(r.stderr || r.stdout, r.code);
      return (r.stdout || r.stderr).trim() || "Merged.";
    },
    // `git merge-tree --write-tree` (git ≥ 2.38) computes the merge without touching the index or
    // working tree. Exit 0 = clean, 1 = conflicts, anything else = a real error (e.g. bad branch).
    // With --name-only the output is the written-tree OID, then a blank line, then the conflicting
    // paths, then a blank line and informational messages — collect the first non-empty block.
    async mergePreview(cwd, branch) {
      const r = await run(["merge-tree", "--write-tree", "--name-only", "HEAD", branch], cwd);
      if (r.code !== 0 && r.code !== 1) throw new GitError(r.stderr || r.stdout, r.code);
      const conflicts: string[] = [];
      for (const line of r.stdout.split("\n").slice(1)) {  // slice(1): drop the OID line
        if (line.trim() === "") { if (conflicts.length) break; continue; } // stop at the blank line after the paths
        conflicts.push(line.trim());
      }
      return { clean: r.code === 0, conflicts: r.code === 0 ? [] : conflicts };
    },

    // -z: NUL-separate commits so multi-line bodies don't split records.
    // --decorate=full: emit full ref paths so parseRefs can tell local/remote/tag apart.
    // Scoped to graphRefs (HEAD + upstream + base), NOT `--all` — see graphRefs for why.
    async log(cwd, limit = 200) {
      const refs = await graphRefs(cwd);
      return read(["log", "-z", "--decorate=full", `--pretty=format:${LOG_FORMAT}`, "--topo-order", "-n", String(limit), ...refs], cwd)
        .then(parseLog);
    },

    // origin/HEAD ("origin/main") is the canonical base; strip the remote. A local-only repo (no
    // remote HEAD) falls back to a conventional branch name if one exists, else null (caller picks).
    async defaultBranch(cwd) {
      const r = await run(["rev-parse", "--abbrev-ref", "origin/HEAD"], cwd);
      const head = r.stdout.trim();
      if (r.code === 0 && head && head !== "origin/HEAD") return head.replace(/^origin\//, "");
      const locals = (await read(["branch", "--format=%(refname:short)"], cwd)).split("\n").map(s => s.trim()).filter(Boolean);
      return ["main", "master", "develop"].find(b => locals.includes(b)) ?? null;
    },
    // `base..HEAD` = commits on this branch but not the base (what the PR introduces). `base...HEAD`
    // (three-dot) diffs vs the merge-base, so files reflect the branch's own changes, not the base's.
    // `read` swallows git's non-zero exit, so a bad base yields empty output the controller treats as
    // "no commits". Renders are advisory text for the model, not parsed — keep them plain.
    async prContext(cwd, base) {
      const commits = await read(["log", `${base}..HEAD`, "--pretty=format:- %s%n%b"], cwd);
      const files = await read(["diff", "--name-status", `${base}...HEAD`], cwd);
      return { commits, files };
    },

    worktrees: (cwd) => read(["worktree", "list", "--porcelain"], cwd).then(parseWorktrees),
    worktreeAdd: (cwd, path, branch, newBranch) =>
      mutate(newBranch ? ["worktree", "add", "-b", branch, path] : ["worktree", "add", path, branch], cwd).then(() => undefined),
    // Destructive (removes the linked worktree dir). Surfaced behind a UI confirm.
    worktreeRemove: (cwd, path, force) =>
      mutate(force ? ["worktree", "remove", "--force", path] : ["worktree", "remove", path], cwd).then(() => undefined),

    // fetch/pull/push all return git's own transcript so the UI can confirm what happened
    // instead of completing in silence. git scatters this across stdout/stderr depending on
    // the command, so each runs directly (mutate would discard it) and picks the right stream.
    async fetch(cwd) {
      const r = await runNet(["fetch", "--all", "--prune"], cwd);
      if (r.code !== 0) throw new GitError(r.stderr || r.stdout, r.code);
      return (r.stderr || r.stdout).trim() || "Fetched."; // fetch reports on stderr; empty = nothing new
    },
    async pull(cwd) {
      const r = await runNet(["pull", "--ff-only"], cwd);
      if (r.code !== 0) throw new GitError(r.stderr || r.stdout, r.code);
      return (r.stdout || r.stderr).trim() || "Pulled."; // pull reports on stdout ("Already up to date.")
    },
    async push(cwd, setUpstream) {
      const r = await runNet(setUpstream ? ["push", "-u", "origin", "HEAD"] : ["push"], cwd);
      if (r.code !== 0) throw new GitError(r.stderr || r.stdout, r.code);
      return (r.stderr || r.stdout).trim() || "Pushed."; // push reports on stderr
    },
    // A diverged branch (ahead AND behind) can't fast-forward push — integrate first.
    // `--no-rebase` forces a merge so we never depend on the host's pull.rebase config
    // (unset, modern git refuses to pull on diverge). A failed pull (conflict) throws
    // before we ever push, surfacing git's message.
    async sync(cwd) {
      const pulled = await runNet(["pull", "--no-rebase"], cwd);
      if (pulled.code !== 0) throw new GitError(pulled.stderr || pulled.stdout, pulled.code);
      const pushed = await runNet(["push"], cwd);
      if (pushed.code !== 0) throw new GitError(pushed.stderr || pushed.stdout, pushed.code);
      return (pushed.stderr || pushed.stdout).trim() || "Synced.";
    },

    async stashList(cwd) {
      const out = await read(["stash", "list", "--format=%gd\x1f%s"], cwd);
      return out.split("\n").filter(Boolean).map(l => {
        const [ref, message] = l.split("\x1f");
        return { ref, message: message ?? "" };
      });
    },
    // A stash commit's tree is the stashed working state; its first parent (`^1`) is the commit it
    // was made from. Diffing the two yields exactly what the stash would reintroduce — same shape as
    // commitFiles, so the web DiffView renders it with the existing per-file side-by-side machinery.
    async stashFiles(cwd, ref) {
      const out = await read(["diff", "--no-color", "--name-status", `${ref}^1`, ref], cwd);
      return out.split("\n").filter(Boolean).map(line => {
        const parts = line.split("\t");
        return { status: parts[0][0], path: parts[parts.length - 1] };
      });
    },
    stashSave: (cwd, message, includeUntracked) => {
      const args = ["stash", "push"];
      if (includeUntracked) args.push("-u");
      if (message) args.push("-m", message);
      return mutate(args, cwd).then(() => undefined);
    },
    // -u so untracked files can be stashed too; the pathspec(s) scope it to just the given file(s),
    // all landing in ONE stash entry. Accepts a single path or an array (multi-select bulk stash).
    stashFile: (cwd, file, message) =>
      mutate(["stash", "push", "-u", ...(message ? ["-m", message] : []), "--", ...(Array.isArray(file) ? file : [file])], cwd).then(() => undefined),
    stashApply: (cwd, ref) => mutate(["stash", "apply", ref], cwd).then(() => undefined),
    stashPop: (cwd, ref) => mutate(["stash", "pop", ref], cwd).then(() => undefined),
    stashDrop: (cwd, ref) => mutate(["stash", "drop", ref], cwd).then(() => undefined),

    async ignore(cwd, file, { scope, isDir }) {
      const line = ignoreLine(file, isDir);
      // Local exclude lives in the gitdir — `--git-path` resolves it correctly even for
      // worktrees/submodules (where `.git` is a file). Repo ignore is the shared root file.
      const target = scope === "local"
        ? path.resolve(cwd, (await run(["rev-parse", "--git-path", "info/exclude"], cwd)).stdout.trim())
        : path.join(cwd, ".gitignore");

      let existing = "";
      try { existing = await fs.readFile(target, "utf8"); }
      catch (err: any) { if (err?.code !== "ENOENT") throw err; } // missing file → create it

      const next = appendIgnoreLine(existing, line);
      const added = next !== null;
      if (added) {
        await fs.mkdir(path.dirname(target), { recursive: true }); // info/ may not exist yet
        await fs.writeFile(target, next, "utf8");
      }
      // Drop it from the index so the ignore actually applies to an already-tracked path. The
      // working file is kept (`--cached`); `--ignore-unmatch` makes it a no-op when untracked;
      // `-r` covers directories. Reversible with `git add`.
      await mutate(["rm", "-r", "--cached", "--ignore-unmatch", "--", file], cwd);
      return { line, added };
    },
  };
}
