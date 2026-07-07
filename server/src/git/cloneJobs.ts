import { spawn as nodeSpawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { AccountRef } from "./github.js";

/**
 * Async clone jobs — the non-blocking backend for "New workspace → Clone repo". The sync
 * /api/git/clone endpoints hold the HTTP request (and the modal) hostage for the whole download;
 * a job instead spawns the clone as a KILLABLE child, returns immediately, and the browser polls.
 * On success `onDone` fires (the route wires it to create the workspace row), so the finished
 * clone becomes a real card even if no browser is watching. In-memory only: a server restart
 * orphans nothing durable — the partial folder is the only residue, same as a crashed manual clone.
 */

export type CloneJobStatus = "running" | "done" | "error";

/** Where the finished workspace card should land — captured at start so placement matches the canvas. */
export interface CloneJobWs { spaceId: string | null; x: number; y: number; }

export interface CloneJob {
  id: string;
  name: string;          // folder + workspace name (single path segment, validated by the route)
  parent: string;        // resolved parent dir the clone runs in
  path: string;          // parent/name — the future workspace folder
  source: "url" | "github";
  url?: string;          // source "url"
  repo?: string;         // source "github" — owner/repo slug
  status: CloneJobStatus;
  error?: string;        // stderr tail when status === "error"
  createdAt: number;
  ws: CloneJobWs;
}

export interface StartInput {
  name: string; parent: string;
  url?: string;                                  // exactly one of url/repo (route-enforced)
  repo?: string; account?: AccountRef;
  ws: CloneJobWs;
}

/** The few child-process bits the manager needs — injectable so tests don't spawn real clones. */
export interface CloneChild {
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "close", cb: (code: number | null) => void): void;
  stderr: { on(event: "data", cb: (chunk: Buffer | string) => void): void } | null;
}
export type CloneSpawner = (cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => CloneChild;

const realSpawner: CloneSpawner = (cmd, args, opts) =>
  nodeSpawn(cmd, args, { ...opts, stdio: ["ignore", "ignore", "pipe"] });

/** Thrown by start() for a fast client-visible failure (target exists) — the route maps it to 400. */
export class CloneStartError extends Error {}

export interface CloneJobs {
  start(input: StartInput): Promise<CloneJob>;
  list(): CloneJob[];
  get(id: string): CloneJob | undefined;
  // Running job → SIGTERM the clone, delete the partial folder, drop the job. Finished job → just
  // dismiss it. Returns false for an unknown id.
  cancel(id: string): Promise<boolean>;
}

export interface CloneJobsOptions {
  // Fired once when a clone exits 0 — the route wires workspace creation here.
  onDone?: (job: CloneJob) => void | Promise<void>;
  // Resolves the GH_TOKEN/GH_HOST overlay for an account-scoped `gh repo clone` (github.authEnv).
  authEnv?: (cwd: string, account: AccountRef) => Promise<Record<string, string> | undefined>;
  spawn?: CloneSpawner;
  expireMs?: number; // how long a done/error job stays listed (default 60s)
}

// Matches the store's id() shape; local because db/store's helper isn't exported.
const jobId = () => "cj_" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

export function createCloneJobs(opts: CloneJobsOptions = {}): CloneJobs {
  const { onDone, authEnv, spawn = realSpawner, expireMs = 60_000 } = opts;
  interface Internal { job: CloneJob; child?: CloneChild; exited?: Promise<void>; cancelled?: boolean; }
  const jobs = new Map<string, Internal>();

  const expire = (id: string) => {
    const t = setTimeout(() => jobs.delete(id), expireMs);
    (t as { unref?: () => void }).unref?.();
  };

  return {
    async start(input) {
      const parent = path.resolve(input.parent);
      const target = path.join(parent, input.name);
      // Fast pre-check so the modal gets its inline error immediately instead of a card that
      // instantly errors. git/gh would also refuse, but only after the job round-trip.
      if (await fs.access(target).then(() => true, () => false)) {
        throw new CloneStartError(`destination path '${target}' already exists`);
      }
      // Same commands + `--` guards as the sync GitController.clone / GithubController.cloneRepo;
      // GIT_TERMINAL_PROMPT=0 matches the runner hardening (missing creds fail fast, never hang).
      const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
      let cmd: string, args: string[];
      if (input.repo) {
        if (input.account) Object.assign(env, await authEnv?.(parent, input.account));
        [cmd, args] = ["gh", ["repo", "clone", input.repo, target]];
      } else {
        [cmd, args] = ["git", ["clone", "--", input.url!, target]];
      }
      const job: CloneJob = {
        id: jobId(), name: input.name, parent, path: target,
        source: input.repo ? "github" : "url", url: input.url, repo: input.repo,
        status: "running", createdAt: Date.now(), ws: input.ws,
      };
      const child = spawn(cmd, args, { cwd: parent, env });
      let stderr = "";
      child.stderr?.on("data", (c) => { stderr = (stderr + String(c)).slice(-4096); });
      const internal: Internal = { job, child };
      internal.exited = new Promise<void>((resolve) => {
        child.on("close", (code) => {
          resolve();
          if (internal.cancelled) return; // cancel() owns cleanup
          if (code === 0) {
            job.status = "done";
            Promise.resolve(onDone?.(job)).catch((err) => {
              job.status = "error";
              job.error = String(err?.message ?? err);
            });
          } else {
            job.status = "error";
            job.error = stderr.trim() || `clone exited with code ${code}`;
          }
          expire(job.id);
        });
      });
      jobs.set(job.id, internal);
      return job;
    },

    list: () => [...jobs.values()].map((i) => i.job),
    get: (id) => jobs.get(id)?.job,

    async cancel(id) {
      const internal = jobs.get(id);
      if (!internal) return false;
      if (internal.job.status === "running" && internal.child) {
        internal.cancelled = true;
        internal.child.kill("SIGTERM");
        await internal.exited;
        // Only the exact folder THIS job was cloning into — recorded at start, nothing else.
        await fs.rm(internal.job.path, { recursive: true, force: true });
      }
      jobs.delete(id);
      return true;
    },
  };
}
