import { execFile } from "node:child_process";
import type { SourceType } from "./types.js";

export interface NormalizedSource {
  cloneUrl: string;        // what to hand `git clone` (or a local path)
  ref?: string;            // branch/tag to check out
  subPath?: string;        // path of the skill within the repo (from a /tree/<ref>/<sub> url)
  sourceType: SourceType;
  isLocal: boolean;
}

// Never let git block on a credential/host prompt — the same guards the VS Code extension uses.
const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "echo",
  GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new",
};

/**
 * Turn anything a user might paste — `owner/repo`, `github:owner/repo`, a full https/ssh url, a
 * `/tree/<ref>/<subpath>` browse url, or a local path — into a clone url plus optional ref and
 * in-repo subpath. Keeps a `.git` suffix as-is.
 */
export function normalizeSource(input: string): NormalizedSource {
  const s = input.trim();

  if (s.startsWith("github:")) return { cloneUrl: `https://github.com/${s.slice(7)}`, sourceType: "github", isLocal: false };
  if (s.startsWith("gitlab:")) return { cloneUrl: `https://gitlab.com/${s.slice(7)}`, sourceType: "gitlab", isLocal: false };

  // scp-style ssh (git@host:owner/repo.git)
  if (/^[^/\s]+@[^/\s]+:/.test(s)) return { cloneUrl: s, sourceType: "git", isLocal: false };

  if (/^(https?|git|ssh):\/\//.test(s)) return parseHttpUrl(s);

  // owner/repo shorthand: two non-empty segments, no scheme, not a path
  if (/^[\w.-]+\/[\w.-]+$/.test(s) && !s.startsWith(".") && !s.startsWith("/")) {
    return { cloneUrl: `https://github.com/${s}`, sourceType: "github", isLocal: false };
  }

  // anything else is a local path
  return { cloneUrl: s, sourceType: "local", isLocal: true };
}

function parseHttpUrl(s: string): NormalizedSource {
  const host = s.match(/^[a-z]+:\/\/([^/]+)/)?.[1] ?? "";
  const type: SourceType = host.includes("github") ? "github" : host.includes("gitlab") ? "gitlab" : "git";

  // GitHub REST "git trees" endpoint, e.g. api.github.com/repos/<owner>/<repo>/git/trees/<ref>?recursive=1.
  // It's an API url, not a clone url — git can't clone it (returns 403). Convert it back to the repo + ref
  // so pasting the API url Just Works instead of failing the clone.
  const apiTree = s.match(/^https?:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/git\/trees\/([^/?#]+)/);
  if (apiTree) return { cloneUrl: `https://github.com/${apiTree[1]}/${apiTree[2]}`, ref: apiTree[3], sourceType: "github", isLocal: false };

  // raw.githubusercontent.com/<owner>/<repo>/<ref>/<path…> points at one file — convert to the repo + ref +
  // the file's folder so a pasted raw SKILL.md url indexes that skill's folder.
  const raw = s.match(/^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
  if (raw) {
    const sub = raw[4].replace(/\/?SKILL\.md$/i, "").replace(/\/+$/, "");
    return { cloneUrl: `https://github.com/${raw[1]}/${raw[2]}`, ref: raw[3], subPath: sub || undefined, sourceType: "github", isLocal: false };
  }

  // /tree/<ref>/<sub> (GitHub) or /-/tree/<ref>/<sub> (GitLab) → split repo, ref, subpath
  const tree = s.match(/^(.*?)\/(?:-\/)?tree\/([^/]+)\/(.+)$/);
  if (tree) return { cloneUrl: tree[1], ref: tree[2], subPath: tree[3], sourceType: type, isLocal: false };

  return { cloneUrl: s, sourceType: type, isLocal: false };
}

/** `git clone --depth 1 [--branch ref] <url> <dest>`. Throws git's stderr on failure. */
export async function cloneShallow(cloneUrl: string, dest: string, ref?: string): Promise<void> {
  const args = ["clone", "--depth", "1"];
  if (ref) args.push("--branch", ref);
  args.push(cloneUrl, dest);
  const r = await git(args, 60_000);
  if (r.code !== 0) throw new Error(`git clone failed: ${(r.stderr || r.stdout).trim()}`);
}

/** Remote HEAD sha via `git ls-remote <url> HEAD` — the cheap update pre-filter. null on error. */
export async function remoteHead(cloneUrl: string): Promise<string | null> {
  const r = await git(["ls-remote", cloneUrl, "HEAD"], 30_000);
  if (r.code !== 0) return null;
  return r.stdout.trim().split(/\s+/)[0] || null;
}

function git(args: string[], timeout: number): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile("git", args, { env: GIT_ENV, timeout, maxBuffer: 32 * 1024 * 1024 }, (err: any, stdout, stderr) => {
      const code = err ? (typeof err.code === "number" ? err.code : -1) : 0;
      resolve({ stdout: stdout ?? "", stderr: stderr ?? (err ? String(err.message ?? err) : ""), code });
    });
  });
}
