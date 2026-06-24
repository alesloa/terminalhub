import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";

const pexec = promisify(execFile);

export interface GhResult { stdout: string; stderr: string; code: number; }
// `env` overlays process.env for this one call — used to inject GH_TOKEN/GH_HOST so a command runs
// as a SPECIFIC authenticated account without `gh auth switch` (which would flip the global active
// account for every terminal on the host).
export type GhRunner = (args: string[], cwd: string, env?: Record<string, string>) => Promise<GhResult>;

export const realGhRunner: GhRunner = async (args, cwd, env) => {
  try {
    const { stdout, stderr } = await pexec("gh", args, {
      cwd, maxBuffer: 16 * 1024 * 1024,
      env: env ? { ...process.env, ...env } : undefined,
    });
    return { stdout, stderr, code: 0 };
  } catch (err: any) {
    const code = typeof err?.code === "number" ? err.code : -1; // -1 = gh binary missing
    return { stdout: err?.stdout ?? "", stderr: err?.stderr ?? String(err?.message ?? err), code };
  }
};

/** Thrown when a mutating gh command exits non-zero. Carries gh's stderr verbatim. */
export class GhError extends Error {
  constructor(message: string, readonly code: number) {
    super(message.trim() || "gh command failed");
    this.name = "GhError";
  }
}

export interface GithubInfo { installed: boolean; authed: boolean; }

/** Accounts the authed gh user can create a repo under: their login + any orgs. */
export interface GithubOwners { login: string; orgs: string[]; }

export interface PublishOptions {
  name: string;
  owner: string; // login or org that will own the new repo
  visibility: "private" | "public";
  description?: string;
  account?: AccountRef; // which signed-in gh account to create under (its token is injected; the
                        // global active account is left untouched, so other terminals aren't flipped)
}

export interface PullRequest {
  number: number;
  title: string;
  author: string;
  branch: string;
  state: string;
  url: string;
  draft: boolean;
}

export interface ActionRun {
  id: number;
  name: string;
  title: string;
  status: string; // queued | in_progress | completed
  conclusion: string | null; // success | failure | cancelled | null (while running)
  branch: string;
  event: string;
  createdAt: string;
  url: string;
}

/** How `gh pr merge` integrates the branch: a merge commit, a squashed commit, or a rebase. */
export type PrMergeMethod = "merge" | "squash" | "rebase";

/** One signed-in `gh` account (gh supports several at once — personal + work, even across hosts). */
export interface GithubAccount { host: string; login: string; active: boolean; }
/** A signed-in account's git commit identity, resolved from its GitHub profile. `email` falls back to
 *  the account's GitHub `noreply` address when the profile email is private, so it's never blank. */
export interface GithubIdentity { login: string; name: string; email: string; }
/** Which signed-in account to act as for a scoped call (its token is injected via GH_TOKEN). */
export interface AccountRef { host: string; login: string; }

/**
 * Auth env overlays for git network ops on one repo. `primary` is the signed-in account that OWNS the
 * repo (its GH_TOKEN/GH_HOST injected) when that isn't the globally-active account — applied up front.
 * `fallbacks` are the other signed-in accounts to retry as, but ONLY if the first attempt fails to
 * authenticate (covers an org-owned private repo a non-active member account can read). An empty
 * `fallbacks` with no `primary` ⇒ nothing to do; git uses its ambient (active-account) credential.
 */
export interface RepoAuthEnv { primary?: Record<string, string>; fallbacks: Record<string, string>[]; }

/** One repo from `gh repo list`, for the New Workspace "browse my GitHub" picker. */
export interface GithubRepo {
  nameWithOwner: string; // "owner/repo" — the slug `gh repo clone` takes
  name: string;          // bare repo name, the default folder/workspace name
  description: string;
  isPrivate: boolean;
  isFork: boolean;
  url: string;           // https web/clone url
  sshUrl: string;        // git@… ssh clone url
  updatedAt: string;
}

export interface GithubController {
  info(cwd: string): Promise<GithubInfo>;
  // The accounts the picker can publish under. `account` scopes the lookup to a specific signed-in
  // account (its login + the orgs IT can create in) instead of only the active account's.
  owners(cwd: string, account?: AccountRef): Promise<GithubOwners>;
  publish(cwd: string, opts: PublishOptions): Promise<{ url: string }>;
  // Every signed-in gh account (across hosts), with the active one flagged. `installed` is false
  // when the gh binary is missing; `accounts` is empty when gh is installed but nobody's logged in.
  accounts(cwd: string): Promise<{ installed: boolean; accounts: GithubAccount[] }>;
  // The git commit identity (name + email) for a signed-in account, read from its GitHub profile
  // (scoped to that account's token, so it works for a non-active account). A private profile email
  // falls back to GitHub's `<id>+<login>@users.noreply.github.com`. Throws GhError if it can't read.
  identity(cwd: string, account: AccountRef): Promise<GithubIdentity>;
  // Resolve which signed-in account git should authenticate as for network ops on the repo whose
  // `origin` is `originUrl` — so a private repo owned by a NON-active account still fetches/pulls/
  // pushes. See RepoAuthEnv. A no-op (empty) when gh is missing, only one account is signed in, or the
  // origin isn't a recognizable GitHub URL, leaving git's existing active-account behavior intact.
  repoAuth(originUrl: string): Promise<RepoAuthEnv>;
  // The signed-in user's repos (or a given owner's). `account` runs as that specific signed-in
  // account (so a second account's private repos show up). cwd only needs to be any readable dir.
  listRepos(cwd: string, opts?: { owner?: string; limit?: number; account?: AccountRef }): Promise<GithubRepo[]>;
  // `gh repo clone <owner/repo>` into <parentDir>/<folderName>; uses gh's own auth, so it clones
  // PRIVATE repos a plain `git clone` couldn't. `account` scopes it to a specific signed-in account
  // so a repo only that account can see still clones. Returns the new folder's absolute path.
  cloneRepo(parentDir: string, nameWithOwner: string, folderName: string, account?: AccountRef): Promise<{ path: string }>;
  listPullRequests(cwd: string): Promise<PullRequest[]>;
  listRuns(cwd: string): Promise<ActionRun[]>;
  // `gh pr create` for the current branch. `base` omitted ⇒ gh targets the repo's default branch.
  // Returns the new PR's URL gh prints. gh's own errors ("must first push", "no commits between …")
  // surface as a GhError the route maps to a 400 toast.
  createPr(cwd: string, opts: { title: string; body?: string; base?: string; draft?: boolean }): Promise<{ url: string }>;
  commentPr(cwd: string, number: number, body: string): Promise<void>;
  mergePr(cwd: string, number: number, method: PrMergeMethod): Promise<void>;
  closePr(cwd: string, number: number): Promise<void>;
}

export function createGithubController(run: GhRunner = realGhRunner): GithubController {
  // Resolve a specific account's token (without switching the active one) and hand back the env that
  // scopes a gh call to it. `gh auth token --user` reads the stored token for that account directly.
  const accountEnv = async (cwd: string, account?: AccountRef): Promise<Record<string, string> | undefined> => {
    if (!account) return undefined;
    const t = await run(["auth", "token", "--hostname", account.host, "--user", account.login], cwd);
    if (t.code !== 0) throw new GhError(t.stderr || t.stdout, t.code);
    return { GH_TOKEN: t.stdout.trim(), GH_HOST: account.host };
  };

  // Signed-in accounts (across hosts), active flagged — [] if gh is missing or nobody's logged in.
  const listAccounts = async (cwd: string): Promise<GithubAccount[]> => {
    const ver = await run(["--version"], cwd);
    if (ver.code === -1) return [];
    const s = await run(["auth", "status"], cwd);
    if (s.code !== 0) return [];
    return parseAuthStatus(s.stdout + "\n" + s.stderr);
  };

  return {
    async info(cwd) {
      const ver = await run(["--version"], cwd);
      if (ver.code === -1) return { installed: false, authed: false };
      const auth = await run(["auth", "status"], cwd);
      return { installed: true, authed: auth.code === 0 };
    },

    async accounts(cwd) {
      const ver = await run(["--version"], cwd);
      if (ver.code === -1) return { installed: false, accounts: [] };
      const s = await run(["auth", "status"], cwd);
      if (s.code !== 0) return { installed: true, accounts: [] }; // installed but nobody logged in
      return { installed: true, accounts: parseAuthStatus(s.stdout + "\n" + s.stderr) };
    },

    // `gh api user` scoped to the account's token returns its public profile. `.name` is the display
    // name (fall back to the login if unset); `.email` is null when the user keeps it private, in which
    // case we use GitHub's stable noreply address so the repo identity is always a real, pushable email.
    async identity(cwd, account) {
      const env = await accountEnv(cwd, account);
      const r = await run(["api", "user"], cwd, env);
      if (r.code !== 0) throw new GhError(r.stderr || r.stdout, r.code);
      const u = safeJson<{ login?: string; id?: number; name?: string | null; email?: string | null }>(r.stdout);
      if (!u?.login) throw new GhError("couldn't read the account's GitHub profile", 1);
      const name = (u.name ?? "").trim() || u.login;
      const email = (u.email ?? "").trim() || `${u.id ?? 0}+${u.login}@users.noreply.github.com`;
      return { login: u.login, name, email };
    },

    // Match the repo's origin owner to a signed-in account so git network ops authenticate as the right
    // identity. The owner-login match is the deterministic primary (a user-owned private repo); other
    // accounts on the host become retry-on-auth-failure fallbacks (an org repo a non-active member sees).
    // gh state is global, so the cwd for these lookups is irrelevant — use the home dir.
    async repoAuth(originUrl) {
      const parsed = parseRemoteOwner(originUrl);
      if (!parsed) return { fallbacks: [] };
      const home = os.homedir();
      const accounts = await listAccounts(home);
      // Only meaningful with more than one account: with one (or none) the active account is the only
      // identity git could use, so leave its credential behavior exactly as it was.
      if (accounts.length < 2) return { fallbacks: [] };
      const onHost = accounts.filter(a => a.host === parsed.host);
      // Resolving a token can fail (account logged out of the keyring mid-session) — skip such accounts
      // rather than failing the whole network op.
      const envOf = async (a: GithubAccount): Promise<Record<string, string> | undefined> => {
        try { return await accountEnv(home, { host: a.host, login: a.login }); }
        catch { return undefined; }
      };
      const owner = onHost.find(a => a.login.toLowerCase() === parsed.owner.toLowerCase());
      // If the owning account is already active, git's ambient credential is correct — no primary.
      const primary = owner && !owner.active ? await envOf(owner) : undefined;
      const others = onHost.filter(a => !a.active && a !== owner);
      const fallbacks = (await Promise.all(others.map(envOf))).filter(Boolean) as Record<string, string>[];
      return { primary, fallbacks };
    },

    // The authed login and the orgs gh can create under, for the publish owner picker. `account`
    // scopes both lookups to a specific signed-in account (token injected) so the picker reflects
    // THAT account, not the active one. The orgs lookup is best-effort: missing `read:org` scope
    // just yields an empty list.
    async owners(cwd, account) {
      const env = await accountEnv(cwd, account);
      const me = await run(["api", "user", "--jq", ".login"], cwd, env);
      const login = me.stdout.trim();
      const o = await run(["api", "user/orgs", "--jq", ".[].login"], cwd, env);
      const orgs = o.code === 0 ? o.stdout.split("\n").map(s => s.trim()).filter(Boolean) : [];
      return { login, orgs };
    },

    // One shot: `gh repo create owner/name --<vis> --source <cwd> --remote origin --push`
    // creates the repo on GitHub, wires up the `origin` remote, and pushes the current
    // branch with tracking. Returns the repo URL gh prints (falling back to a constructed
    // one) so the UI can link it.
    async publish(cwd, opts) {
      const args = [
        "repo", "create", `${opts.owner}/${opts.name}`,
        `--${opts.visibility}`, "--source", cwd, "--remote", "origin", "--push",
      ];
      if (opts.description) args.push("--description", opts.description);
      const r = await run(args, cwd, await accountEnv(cwd, opts.account));
      if (r.code !== 0) throw new GhError(r.stderr || r.stdout, r.code);
      const url = (r.stdout + "\n" + r.stderr).match(/https?:\/\/\S+/)?.[0]
        ?? `https://github.com/${opts.owner}/${opts.name}`;
      return { url };
    },

    // `gh repo list [owner] --json … --limit N`. No owner → the authed user's own repos. Non-zero
    // (gh missing / not authed) throws a GhError the route maps to a 400 the picker shows.
    async listRepos(cwd, opts = {}) {
      const args = ["repo", "list"];
      if (opts.owner) args.push(opts.owner);
      args.push("--json", "nameWithOwner,name,description,isPrivate,isFork,url,sshUrl,updatedAt",
        "--limit", String(opts.limit ?? 100));
      const r = await run(args, cwd, await accountEnv(cwd, opts.account));
      if (r.code !== 0) throw new GhError(r.stderr || r.stdout, r.code);
      const rows = safeJson<any[]>(r.stdout) ?? [];
      return rows.map(x => ({
        nameWithOwner: x.nameWithOwner ?? "",
        name: x.name ?? "",
        description: x.description ?? "",
        isPrivate: Boolean(x.isPrivate),
        isFork: Boolean(x.isFork),
        url: x.url ?? "",
        sshUrl: x.sshUrl ?? "",
        updatedAt: x.updatedAt ?? "",
      }));
    },

    async cloneRepo(parentDir, nameWithOwner, folderName, account) {
      const parent = path.resolve(parentDir);
      const target = path.join(parent, folderName);
      const r = await run(["repo", "clone", nameWithOwner, target], parent, await accountEnv(parent, account));
      if (r.code !== 0) throw new GhError(r.stderr || r.stdout, r.code);
      return { path: target };
    },

    async listPullRequests(cwd) {
      const r = await run(
        ["pr", "list", "--json", "number,title,author,headRefName,state,url,isDraft", "--limit", "30"],
        cwd,
      );
      if (r.code !== 0) return [];
      const rows = safeJson<any[]>(r.stdout) ?? [];
      return rows.map(p => ({
        number: p.number,
        title: p.title,
        author: p.author?.login ?? "",
        branch: p.headRefName ?? "",
        state: p.state ?? "",
        url: p.url ?? "",
        draft: Boolean(p.isDraft),
      }));
    },

    async listRuns(cwd) {
      const r = await run(
        ["run", "list", "--json", "databaseId,name,displayTitle,status,conclusion,headBranch,event,createdAt,url", "--limit", "20"],
        cwd,
      );
      if (r.code !== 0) return [];
      const rows = safeJson<any[]>(r.stdout) ?? [];
      return rows.map(x => ({
        id: x.databaseId,
        name: x.name ?? "",
        title: x.displayTitle ?? "",
        status: x.status ?? "",
        conclusion: x.conclusion ?? null,
        branch: x.headBranch ?? "",
        event: x.event ?? "",
        createdAt: x.createdAt ?? "",
        url: x.url ?? "",
      }));
    },

    async createPr(cwd, opts) {
      const args = ["pr", "create", "--title", opts.title, "--body", opts.body ?? ""];
      if (opts.base) args.push("--base", opts.base);
      if (opts.draft) args.push("--draft");
      const r = await run(args, cwd);
      if (r.code !== 0) throw new GhError(r.stderr || r.stdout, r.code);
      const url = (r.stdout + "\n" + r.stderr).match(/https?:\/\/\S+/)?.[0] ?? "";
      return { url };
    },

    // The PR write actions. gh surfaces "not mergeable", "already merged", auth, etc. on stderr —
    // wrapped in GhError so the route maps it to a 400 the UI shows as a toast.
    async commentPr(cwd, number, body) {
      const r = await run(["pr", "comment", String(number), "--body", body], cwd);
      if (r.code !== 0) throw new GhError(r.stderr || r.stdout, r.code);
    },
    async mergePr(cwd, number, method) {
      const r = await run(["pr", "merge", String(number), `--${method}`], cwd);
      if (r.code !== 0) throw new GhError(r.stderr || r.stdout, r.code);
    },
    async closePr(cwd, number) {
      const r = await run(["pr", "close", String(number)], cwd);
      if (r.code !== 0) throw new GhError(r.stderr || r.stdout, r.code);
    },
  };
}

function safeJson<T>(s: string): T | null {
  try { return JSON.parse(s) as T; } catch { return null; }
}

/**
 * Parse a git remote URL into host + owner + repo. Handles the forms `git remote get-url` prints:
 * `https://github.com/owner/repo(.git)` (optionally `https://user@host/…`) and the SSH shorthand
 * `git@github.com:owner/repo(.git)` / `ssh://git@host/owner/repo`. Returns null for anything else (a
 * non-GitHub or unparseable remote) so callers fall back to git's ambient credentials.
 */
export function parseRemoteOwner(url: string): { host: string; owner: string; repo: string } | null {
  const u = (url ?? "").trim();
  if (!u) return null;
  let m = u.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/);
  if (m) return { host: m[1], owner: m[2], repo: m[3] };
  m = u.match(/^https?:\/\/(?:[^@/]+@)?([^/]+)\/([^/]+)\/(.+?)(?:\.git)?\/?$/);
  if (m) return { host: m[1], owner: m[2], repo: m[3] };
  return null;
}

/**
 * Parse `gh auth status` text into the signed-in accounts. There's no `--json` for auth status, so
 * we read the human output: each account is a `Logged in to <host> account <login>` line, optionally
 * followed by `Active account: true`. Handles multiple accounts and multiple hosts.
 */
export function parseAuthStatus(text: string): GithubAccount[] {
  const accounts: GithubAccount[] = [];
  let current: GithubAccount | null = null;
  for (const line of text.split("\n")) {
    const m = line.match(/Logged in to (\S+) account (\S+)/);
    if (m) { current = { host: m[1], login: m[2], active: false }; accounts.push(current); continue; }
    if (current && /Active account:\s*true/i.test(line)) current.active = true;
  }
  return accounts;
}
