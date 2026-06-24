import type { FastifyInstance, FastifyReply } from "fastify";
import os from "node:os";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { GitError } from "../git/controller.js";
import { gitObjectBytes } from "../git/objectBytes.js";
import { GhError } from "../git/github.js";
import { writeGitignore, gitignorePreview } from "../git/gitignore.js";

// A folder name that becomes a single new directory under the clone parent: no path separators and
// not "."/".." (so it can't traverse out). The url/repo guards stop arg-injection separately.
const cloneName = z.string().min(1).regex(/^[^/\\]+$/).refine(n => n !== "." && n !== "..", "invalid name");

// Every git op is scoped to a folder the client names — the workspace's host path,
// exactly like the fs routes. The auth guard already gates /api/* when exposed.
const pathQuery = z.object({ path: z.string().min(1) });

/** Map a git/gh tool failure (its stderr) to a 400; anything else to a 500. */
function fail(reply: FastifyReply, err: any) {
  if (err instanceof GitError || err instanceof GhError) {
    return reply.code(400).send({ error: err.message, code: err.code });
  }
  return reply.code(500).send({ error: err?.message ?? "git failed" });
}

/** Run a mutating op that returns nothing meaningful; reply `{ ok: true }` on success. */
async function run(reply: FastifyReply, fn: () => Promise<unknown>) {
  try {
    await fn();
    return { ok: true };
  } catch (err: any) {
    return fail(reply, err);
  }
}

/** Run a mutating op whose result the client needs (e.g. the new repo URL). */
async function runValue<T>(reply: FastifyReply, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err: any) {
    return fail(reply, err);
  }
}

export async function gitRoutes(app: FastifyInstance, ctx: AppContext) {
  const { git, github } = ctx;

  // ---- reads ----
  app.get("/api/git/info", async (req, reply) => {
    const q = pathQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "path required" });
    return git.info(q.data.path);
  });

  app.get("/api/git/status", async (req, reply) => {
    const q = pathQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "path required" });
    return git.status(q.data.path);
  });

  app.get("/api/git/ignored", async (req, reply) => {
    const q = pathQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "path required" });
    return { ignored: await git.ignored(q.data.path) };
  });

  app.get("/api/git/diff", async (req, reply) => {
    const q = z.object({
      path: z.string().min(1), file: z.string().min(1),
      staged: z.enum(["true", "false"]).optional(), untracked: z.enum(["true", "false"]).optional(),
    }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "path and file required" });
    const diff = await git.diff(q.data.path, q.data.file, {
      staged: q.data.staged === "true", untracked: q.data.untracked === "true",
    });
    return { diff };
  });

  app.get("/api/git/commit-diff", async (req, reply) => {
    const q = z.object({ path: z.string().min(1), hash: z.string().regex(/^[0-9a-fA-F]{4,64}$/) }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "path and a valid commit hash required" });
    return { diff: await git.commitDiff(q.data.path, q.data.hash) };
  });

  // One side of a side-by-side diff: a file's content at a revision. `rev` is a ref/hash
  // (`HEAD`, a commit, `hash^`) or empty for the index; the file's worktree side comes from
  // the fs routes. Restrict `rev` to ref-safe characters so it can't smuggle git options.
  app.get("/api/git/show-file", async (req, reply) => {
    const q = z.object({
      path: z.string().min(1), file: z.string().min(1),
      rev: z.string().regex(/^(?!-)[0-9a-zA-Z_./^~@{}-]*$/).optional(), // no leading dash → can't pose as a git option
    }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "path and file required" });
    return { content: await git.showFile(q.data.path, q.data.rev ?? "", q.data.file) };
  });

  // The same one side of a diff, but as RAW BYTES (base64) — for image diffs, where showFile's utf8
  // decode would corrupt the blob. `dataBase64` is null when the file is absent at that rev (the
  // empty side of an add/delete). Same ref-safe `rev` guard as show-file.
  app.get("/api/git/show-file-bytes", async (req, reply) => {
    const q = z.object({
      path: z.string().min(1), file: z.string().min(1),
      rev: z.string().regex(/^(?!-)[0-9a-zA-Z_./^~@{}-]*$/).optional(),
    }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "path and file required" });
    const buf = await gitObjectBytes(q.data.path, q.data.rev ?? "", q.data.file);
    return { dataBase64: buf ? buf.toString("base64") : null, size: buf?.length ?? 0 };
  });

  // The files a commit touched, so a commit's diff can render one side-by-side view per file.
  app.get("/api/git/commit-files", async (req, reply) => {
    const q = z.object({ path: z.string().min(1), hash: z.string().regex(/^[0-9a-fA-F]{4,64}$/) }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "path and a valid commit hash required" });
    return { files: await git.commitFiles(q.data.path, q.data.hash) };
  });

  app.get("/api/git/log", async (req, reply) => {
    const q = z.object({ path: z.string().min(1), limit: z.coerce.number().int().positive().max(2000).optional() })
      .safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "path required" });
    return { commits: await git.log(q.data.path, q.data.limit) };
  });

  app.get("/api/git/branches", async (req, reply) => {
    const q = pathQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "path required" });
    return { branches: await git.branches(q.data.path) };
  });

  // The repo's base branch (for preselecting the PR dialog's merge target). null = couldn't resolve one.
  app.get("/api/git/default-branch", async (req, reply) => {
    const q = pathQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "path required" });
    return { branch: await git.defaultBranch(q.data.path) };
  });

  // Read-only merge conflict check. `branch` can't start with "-" so it can't pose as a git option.
  app.get("/api/git/merge-preview", async (req, reply) => {
    const q = z.object({ path: z.string().min(1), branch: z.string().min(1).regex(/^[^-]/) }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "path and a valid branch required" });
    return runValue(reply, () => git.mergePreview(q.data.path, q.data.branch));
  });

  app.get("/api/git/stash", async (req, reply) => {
    const q = pathQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "path required" });
    return { stashes: await git.stashList(q.data.path) };
  });

  // The files a stash changed (vs its base), so the diff view can render it per file. `ref` is
  // constrained to the `stash@{N}` form so it can't smuggle an arbitrary rev or git option.
  app.get("/api/git/stash-files", async (req, reply) => {
    const q = z.object({ path: z.string().min(1), ref: z.string().regex(/^stash@\{\d+\}$/) }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "path and a valid stash ref required" });
    return { files: await git.stashFiles(q.data.path, q.data.ref) };
  });

  app.get("/api/git/worktrees", async (req, reply) => {
    const q = pathQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "path required" });
    return { worktrees: await git.worktrees(q.data.path) };
  });

  // ---- mutations ----
  const files = z.object({ path: z.string().min(1), files: z.array(z.string()).min(1) });

  // The one write that's valid on a folder that isn't a repo yet — `git init` to start tracking it.
  // Optionally scopes the new repo's commit identity to a chosen signed-in GitHub `account` (its
  // name/email set repo-locally) and, with `commit`, stages everything and makes the first commit —
  // so a fresh repo lands under the right identity (and optionally with an initial commit) in one step.
  app.post("/api/git/init", async (req, reply) => {
    const b = z.object({
      path: z.string().min(1),
      account: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/).optional(),
      host: z.string().regex(/^[A-Za-z0-9.-]+$/).optional(),
      gitignore: z.boolean().optional(), // write a stack-aware default .gitignore before staging
      commit: z.object({ message: z.string().min(1) }).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path required" });
    const acct = b.data.account ? { login: b.data.account, host: b.data.host ?? "github.com" } : undefined;
    return run(reply, async () => {
      // Resolve the chosen account's identity FIRST — a bad/unreadable account fails before the folder
      // is touched, so we never leave a half-initialized repo with the wrong (or no) identity.
      const id = acct ? await github.identity(os.homedir(), acct) : null;
      await git.init(b.data.path);
      if (id) await git.setIdentity(b.data.path, id.name, id.email);
      // The .gitignore goes in BEFORE staging, so the first commit excludes node_modules/.env/etc.
      if (b.data.gitignore) await writeGitignore(b.data.path);
      if (b.data.commit) {
        await git.stageAll(b.data.path);
        await git.commit(b.data.path, b.data.commit.message);
      }
    });
  });

  // Which stacks the folder holds + whether a .gitignore already exists, for the Initialize dialog's
  // ".gitignore" preview line. A read-only probe (no writes), so it's safe to run as the dialog opens.
  app.get("/api/git/gitignore-preview", async (req, reply) => {
    const q = pathQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "path required" });
    return gitignorePreview(q.data.path);
  });

  // Clone a remote repo (any git url) into <parent>/<name> on the host; the New Workspace flow then
  // points a fresh workspace at the returned path. `url` can't begin with "-" (can't pose as a git
  // option) and `name` must be a single path segment.
  app.post("/api/git/clone", async (req, reply) => {
    const b = z.object({
      url: z.string().min(1).regex(/^[^-]/, "url cannot start with '-'"),
      parent: z.string().min(1),
      name: cloneName,
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "url, parent and a valid name required" });
    return runValue(reply, () => git.clone(b.data.parent, b.data.url, b.data.name));
  });

  app.post("/api/git/stage", async (req, reply) => {
    const b = files.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path and files required" });
    return run(reply, () => git.stage(b.data.path, b.data.files));
  });

  app.post("/api/git/unstage", async (req, reply) => {
    const b = files.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path and files required" });
    return run(reply, () => git.unstage(b.data.path, b.data.files));
  });

  app.post("/api/git/discard", async (req, reply) => {
    const b = files.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path and files required" });
    return run(reply, () => git.discard(b.data.path, b.data.files));
  });

  app.post("/api/git/clean", async (req, reply) => {
    const b = pathQuery.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path required" });
    return run(reply, () => git.cleanUntracked(b.data.path));
  });

  app.post("/api/git/stage-all", async (req, reply) => {
    const b = pathQuery.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path required" });
    return run(reply, () => git.stageAll(b.data.path));
  });

  app.post("/api/git/unstage-all", async (req, reply) => {
    const b = pathQuery.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path required" });
    return run(reply, () => git.unstageAll(b.data.path));
  });

  app.post("/api/git/commit", async (req, reply) => {
    const b = z.object({ path: z.string().min(1), message: z.string().min(1) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path and message required" });
    return run(reply, () => git.commit(b.data.path, b.data.message));
  });

  app.post("/api/git/uncommit", async (req, reply) => {
    const b = pathQuery.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path required" });
    return run(reply, () => git.uncommit(b.data.path));
  });

  app.post("/api/git/checkout", async (req, reply) => {
    const b = z.object({ path: z.string().min(1), branch: z.string().min(1) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path and branch required" });
    return run(reply, () => git.checkout(b.data.path, b.data.branch));
  });

  app.post("/api/git/branch", async (req, reply) => {
    const b = z.object({ path: z.string().min(1), name: z.string().min(1) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path and name required" });
    return run(reply, () => git.createBranch(b.data.path, b.data.name));
  });

  app.post("/api/git/branch/delete", async (req, reply) => {
    const b = z.object({ path: z.string().min(1), name: z.string().min(1), force: z.boolean().optional() })
      .safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path and name required" });
    return run(reply, () => git.deleteBranch(b.data.path, b.data.name, b.data.force));
  });

  // newName can't start with "-" (it can't pose as a git option); name is the existing branch.
  app.post("/api/git/branch/rename", async (req, reply) => {
    const b = z.object({ path: z.string().min(1), name: z.string().min(1), newName: z.string().min(1).regex(/^[^-]/) })
      .safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path, name and a valid newName required" });
    return run(reply, () => git.renameBranch(b.data.path, b.data.name, b.data.newName));
  });

  app.post("/api/git/merge", async (req, reply) => {
    const b = z.object({ path: z.string().min(1), branch: z.string().min(1).regex(/^[^-]/) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path and a valid branch required" });
    return runValue(reply, async () => ({ message: await git.merge(b.data.path, b.data.branch) }));
  });

  app.post("/api/git/worktree", async (req, reply) => {
    const b = z.object({ path: z.string().min(1), worktreePath: z.string().min(1), branch: z.string().min(1), newBranch: z.boolean().optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path, worktreePath and branch required" });
    return run(reply, () => git.worktreeAdd(b.data.path, b.data.worktreePath, b.data.branch, b.data.newBranch));
  });

  app.post("/api/git/worktree/remove", async (req, reply) => {
    const b = z.object({ path: z.string().min(1), worktreePath: z.string().min(1), force: z.boolean().optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path and worktreePath required" });
    return run(reply, () => git.worktreeRemove(b.data.path, b.data.worktreePath, b.data.force));
  });

  app.post("/api/git/fetch", async (req, reply) => {
    const b = pathQuery.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path required" });
    return runValue(reply, async () => ({ message: await git.fetch(b.data.path) }));
  });

  app.post("/api/git/pull", async (req, reply) => {
    const b = pathQuery.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path required" });
    return runValue(reply, async () => ({ message: await git.pull(b.data.path) }));
  });

  app.post("/api/git/push", async (req, reply) => {
    const b = z.object({ path: z.string().min(1), setUpstream: z.boolean().optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path required" });
    return runValue(reply, async () => ({ message: await git.push(b.data.path, b.data.setUpstream) }));
  });

  app.post("/api/git/sync", async (req, reply) => {
    const b = pathQuery.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path required" });
    return runValue(reply, async () => ({ message: await git.sync(b.data.path) }));
  });

  app.post("/api/git/stash", async (req, reply) => {
    const b = z.object({ path: z.string().min(1), message: z.string().optional(), includeUntracked: z.boolean().optional() })
      .safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path required" });
    return run(reply, () => git.stashSave(b.data.path, b.data.message ?? "", Boolean(b.data.includeUntracked)));
  });

  app.post("/api/git/stash/file", async (req, reply) => {
    const b = z.object({
      path: z.string().min(1),
      file: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
      message: z.string().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path and file(s) required" });
    return run(reply, () => git.stashFile(b.data.path, b.data.file, b.data.message));
  });

  for (const op of ["apply", "pop", "drop"] as const) {
    app.post(`/api/git/stash/${op}`, async (req, reply) => {
      const b = z.object({ path: z.string().min(1), ref: z.string().min(1) }).safeParse(req.body);
      if (!b.success) return reply.code(400).send({ error: "path and ref required" });
      const fn = op === "apply" ? git.stashApply : op === "pop" ? git.stashPop : git.stashDrop;
      return run(reply, () => fn(b.data.path, b.data.ref));
    });
  }

  // Append a path to .git/info/exclude (local) or the shared .gitignore (repo), then untrack it.
  app.post("/api/git/ignore", async (req, reply) => {
    const b = z.object({
      path: z.string().min(1), file: z.string().min(1),
      scope: z.enum(["local", "repo"]), isDir: z.boolean().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path, file and scope required" });
    return runValue(reply, () => git.ignore(b.data.path, b.data.file, { scope: b.data.scope, isDir: Boolean(b.data.isDir) }));
  });

  // ---- GitHub (gh CLI) ----
  app.get("/api/git/github/info", async (req, reply) => {
    const q = pathQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "path required" });
    return github.info(q.data.path);
  });

  app.get("/api/git/github/owners", async (req, reply) => {
    const q = z.object({
      path: z.string().min(1),
      account: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/).optional(),
      host: z.string().regex(/^[A-Za-z0-9.-]+$/).optional(),
    }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "path required" });
    const account = q.data.account ? { login: q.data.account, host: q.data.host ?? "github.com" } : undefined;
    return github.owners(q.data.path, account);
  });

  // Every signed-in gh account (across hosts), with the active one flagged — without needing a repo
  // path. The New Workspace GitHub picker uses this to gate browsing AND to offer an account switcher
  // when more than one is connected. Runs gh from the host home dir.
  app.get("/api/git/github/accounts", async () => github.accounts(os.homedir()));

  // The git commit identity (name + email) a chosen signed-in account would commit under, for the
  // Initialize-repo dialog's "commits as …" preview. gh state is global, so it runs from the home dir.
  app.get("/api/git/github/identity", async (req, reply) => {
    const q = z.object({
      account: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/),
      host: z.string().regex(/^[A-Za-z0-9.-]+$/).optional(),
    }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "account required" });
    return runValue(reply, () => github.identity(os.homedir(), { login: q.data.account, host: q.data.host ?? "github.com" }));
  });

  // The signed-in user's repos (or a given owner's) for the New Workspace "browse my GitHub" picker.
  // No repo path needed — gh runs from the host home dir. `owner` is a GitHub login (user or org).
  // `account` (+ optional `host`) scopes the listing to a SPECIFIC signed-in account, so a second
  // account's private repos show up instead of only the active account's.
  app.get("/api/git/github/repos", async (req, reply) => {
    const q = z.object({
      owner: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/).optional(),
      limit: z.coerce.number().int().positive().max(200).optional(),
      account: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/).optional(),
      host: z.string().regex(/^[A-Za-z0-9.-]+$/).optional(),
    }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "invalid query" });
    const account = q.data.account ? { login: q.data.account, host: q.data.host ?? "github.com" } : undefined;
    return runValue(reply, async () => ({ repos: await github.listRepos(os.homedir(), { owner: q.data.owner, limit: q.data.limit, account }) }));
  });

  // Clone a repo picked from the GitHub browser into <parent>/<name> via `gh repo clone` (gh's own
  // auth, so private repos work). `repo` is the "owner/repo" slug; `name` is a single path segment.
  // `account` (+ optional `host`) scopes the clone to a specific signed-in account, so a repo only
  // that account can see still clones.
  app.post("/api/git/github/clone", async (req, reply) => {
    const b = z.object({
      repo: z.string().regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/, "must be owner/repo"),
      parent: z.string().min(1),
      name: cloneName,
      account: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/).optional(),
      host: z.string().regex(/^[A-Za-z0-9.-]+$/).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "repo, parent and a valid name required" });
    const account = b.data.account ? { login: b.data.account, host: b.data.host ?? "github.com" } : undefined;
    return runValue(reply, () => github.cloneRepo(b.data.parent, b.data.repo, b.data.name, account));
  });

  // Create the repo on GitHub for a never-published folder, wire up origin, and push. `account`
  // (+ optional `host`) creates it under a SPECIFIC signed-in account (token injected) rather than
  // the active one, so a multi-account host can publish to either identity.
  app.post("/api/git/github/publish", async (req, reply) => {
    const b = z.object({
      path: z.string().min(1),
      name: z.string().min(1),
      owner: z.string().min(1),
      visibility: z.enum(["private", "public"]),
      description: z.string().optional(),
      account: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/).optional(),
      host: z.string().regex(/^[A-Za-z0-9.-]+$/).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path, name, owner and visibility required" });
    const account = b.data.account ? { login: b.data.account, host: b.data.host ?? "github.com" } : undefined;
    return runValue(reply, () => github.publish(b.data.path, {
      name: b.data.name, owner: b.data.owner, visibility: b.data.visibility,
      description: b.data.description, account,
    }));
  });

  app.get("/api/git/github/prs", async (req, reply) => {
    const q = pathQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "path required" });
    return { prs: await github.listPullRequests(q.data.path) };
  });

  app.get("/api/git/github/runs", async (req, reply) => {
    const q = pathQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "path required" });
    return { runs: await github.listRuns(q.data.path) };
  });

  app.post("/api/git/github/pr/create", async (req, reply) => {
    const b = z.object({
      path: z.string().min(1), title: z.string().min(1),
      body: z.string().optional(), base: z.string().optional(), draft: z.boolean().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path and a title required" });
    return runValue(reply, () => github.createPr(b.data.path, { title: b.data.title, body: b.data.body, base: b.data.base, draft: b.data.draft }));
  });

  app.post("/api/git/github/pr/comment", async (req, reply) => {
    const b = z.object({ path: z.string().min(1), number: z.number().int().positive(), body: z.string().min(1) })
      .safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path, number and a non-empty body required" });
    return run(reply, () => github.commentPr(b.data.path, b.data.number, b.data.body));
  });

  app.post("/api/git/github/pr/merge", async (req, reply) => {
    const b = z.object({
      path: z.string().min(1), number: z.number().int().positive(), method: z.enum(["merge", "squash", "rebase"]),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path, number and a valid method required" });
    return run(reply, () => github.mergePr(b.data.path, b.data.number, b.data.method));
  });

  app.post("/api/git/github/pr/close", async (req, reply) => {
    const b = z.object({ path: z.string().min(1), number: z.number().int().positive() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path and number required" });
    return run(reply, () => github.closePr(b.data.path, b.data.number));
  });
}
