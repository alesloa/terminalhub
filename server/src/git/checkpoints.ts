import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { realRunner, type GitResult, type GitRunner } from "./run.js";

/**
 * Working-tree snapshots that live entirely in git's object database, under refs nothing else looks
 * at. This is the mechanism behind "undo file changes" on a chat rewind.
 *
 * The whole trick is `GIT_INDEX_FILE`: staging into a throwaway index means `add -A` can see the
 * entire working tree without ever writing the user's real `.git/index`. Their staged changes, their
 * HEAD, their branch and their stash are untouched — a checkpoint is invisible unless you go looking
 * for the ref. `add -A` also means `.gitignore` is obeyed for free, so `node_modules` and `.env` are
 * neither snapshotted nor (on restore) deleted.
 *
 * Everything is scoped to `cwd` with a `-- .` pathspec, so a workspace that sits in a subdirectory of
 * a bigger repo only ever snapshots and restores its own subtree.
 *
 * The destructive half is `restore`: putting the tree back means `git clean -fd`, which deletes
 * untracked files created after the snapshot. That is what undo has to mean, so it is never implicit
 * — callers show `preview()`'s `removed` count first and make the user opt in.
 */

export const CHECKPOINT_REFS_PREFIX = "refs/terminalhub/checkpoints";

/** Identity on the checkpoint commits. They are never pushed and never reachable from a branch, but
 *  `commit-tree` still demands an author, and inheriting the user's would put their name on objects
 *  they never asked to create. */
const IDENTITY = {
  GIT_AUTHOR_NAME: "Terminal Hub",
  GIT_AUTHOR_EMAIL: "terminalhub@users.noreply.github.com",
  GIT_COMMITTER_NAME: "Terminal Hub",
  GIT_COMMITTER_EMAIL: "terminalhub@users.noreply.github.com",
} as const;

/** Ref namespace for one checkpoint scope. Base64url so an id with any character in it still lands
 *  in a valid ref name. */
export function checkpointScope(scopeId: string): string {
  return `${CHECKPOINT_REFS_PREFIX}/${Buffer.from(scopeId, "utf8").toString("base64url")}`;
}

export function checkpointRef(scopeId: string, turn: number): string {
  return `${checkpointScope(scopeId)}/turn/${turn}`;
}

/** What restoring a checkpoint would do to the working tree as it stands right now. */
export interface CheckpointStat {
  /** Tracked files whose content differs between the checkpoint and the working tree. */
  files: number;
  insertions: number;
  deletions: number;
  /** Files that exist now, aren't in the checkpoint, and aren't ignored — the ones `git clean`
   *  deletes. The number worth putting in front of the user before they say yes. */
  removed: number;
}

export const EMPTY_STAT: CheckpointStat = { files: 0, insertions: 0, deletions: 0, removed: 0 };

export interface GitCheckpoints {
  isRepo(cwd: string): Promise<boolean>;
  /** Snapshot the tree under `ref`, replacing whatever was there. `label` becomes the commit
   *  subject — callers use it to recognise their own checkpoints later. */
  capture(cwd: string, ref: string, label: string): Promise<boolean>;
  /** Re-point `ref` at its existing tree under a new label. Cheap (no working-tree walk) and, more
   *  importantly, non-destructive: the snapshot itself is preserved. */
  relabel(cwd: string, ref: string, label: string): Promise<boolean>;
  /** The commit subject stored with a checkpoint, or null when the ref doesn't exist. */
  label(cwd: string, ref: string): Promise<string | null>;
  preview(cwd: string, ref: string): Promise<CheckpointStat | null>;
  /** Put the working tree back. Returns what it changed, measured before doing it. */
  restore(cwd: string, ref: string): Promise<CheckpointStat | null>;
  /** Turn numbers currently checkpointed under a scope, ascending. */
  turns(cwd: string, scopeId: string): Promise<number[]>;
  remove(cwd: string, refs: string[]): Promise<void>;
}

const ok = (r: GitResult) => r.code === 0;

/** Split a `--numstat`/`ls-*` block into non-empty lines. */
function lines(out: string): string[] {
  return out.split("\n").map((l) => l.trim()).filter(Boolean);
}

export function createGitCheckpoints(run: GitRunner = realRunner): GitCheckpoints {
  const headExists = async (cwd: string) =>
    ok(await run(["rev-parse", "--verify", "--quiet", "HEAD"], cwd));

  const commitOf = async (cwd: string, ref: string): Promise<string | null> => {
    const r = await run(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd);
    const oid = r.stdout.trim();
    return ok(r) && oid ? oid : null;
  };

  /** The real `.git` directory, which is where a scratch index has to live — a worktree's own gitdir
   *  is not where `write-tree` expects to find one. */
  const commonDir = async (cwd: string): Promise<string | null> => {
    const r = await run(["rev-parse", "--git-common-dir"], cwd);
    const dir = r.stdout.trim();
    if (!ok(r) || !dir) return null;
    return path.isAbsolute(dir) ? dir : path.resolve(cwd, dir);
  };

  /** Write a commit for `tree` under `label` and move `ref` onto it. */
  const commitTree = async (cwd: string, ref: string, tree: string, label: string) => {
    const commit = await run(["commit-tree", tree, "-m", label], cwd, { ...IDENTITY });
    const oid = commit.stdout.trim();
    if (!ok(commit) || !oid) return false;
    return ok(await run(["update-ref", ref, oid], cwd));
  };

  const stat = async (cwd: string, oid: string): Promise<CheckpointStat> => {
    const diff = await run(
      ["diff", "--numstat", "--no-color", "--no-ext-diff", "--no-textconv", oid, "--", "."],
      cwd,
    );
    let files = 0;
    let insertions = 0;
    let deletions = 0;
    if (ok(diff)) {
      for (const line of lines(diff.stdout)) {
        const [added, removed] = line.split("\t");
        files += 1;
        // Binary files report "-" for both counts; they still count as a changed file.
        insertions += Number(added) || 0;
        deletions += Number(removed) || 0;
      }
    }

    // `git clean -fd` deletes untracked, non-ignored files — but a restore writes the checkpoint's
    // own files back first, so anything the snapshot contains survives. Both listings are asked for
    // relative to the repo root so they can be compared at all when cwd is a subdirectory.
    const untracked = await run(
      ["ls-files", "--others", "--exclude-standard", "--full-name", "--", "."],
      cwd,
    );
    const kept = await run(["ls-tree", "-r", "--name-only", "--full-name", oid, "--", "."], cwd);
    const inCheckpoint = new Set(ok(kept) ? lines(kept.stdout) : []);
    const removedFiles = ok(untracked)
      ? lines(untracked.stdout).filter((p) => !inCheckpoint.has(p)).length
      : 0;

    return { files, insertions, deletions, removed: removedFiles };
  };

  return {
    async isRepo(cwd) {
      const r = await run(["rev-parse", "--is-inside-work-tree"], cwd);
      return ok(r) && r.stdout.trim() === "true";
    },

    async capture(cwd, ref, label) {
      const dir = await commonDir(cwd);
      if (!dir) return false;
      const indexFile = path.join(dir, `terminalhub-checkpoint-index-${randomUUID()}`);
      const env = { ...IDENTITY, GIT_INDEX_FILE: indexFile };
      try {
        // Seed the scratch index from HEAD so unchanged files keep their existing blobs instead of
        // being re-hashed. A repo with no commits yet has nothing to seed from, which is fine.
        if (await headExists(cwd)) {
          if (!ok(await run(["read-tree", "HEAD"], cwd, env))) return false;
        }
        if (!ok(await run(["add", "-A", "--", "."], cwd, env))) return false;
        const tree = await run(["write-tree"], cwd, env);
        const treeOid = tree.stdout.trim();
        if (!ok(tree) || !treeOid) return false;
        return await commitTree(cwd, ref, treeOid, label);
      } finally {
        await fs.rm(indexFile, { force: true }).catch(() => {});
      }
    },

    async relabel(cwd, ref, label) {
      const r = await run(["rev-parse", "--verify", "--quiet", `${ref}^{tree}`], cwd);
      const tree = r.stdout.trim();
      if (!ok(r) || !tree) return false;
      return commitTree(cwd, ref, tree, label);
    },

    async label(cwd, ref) {
      const r = await run(["log", "-1", "--format=%s", `${ref}^{commit}`], cwd);
      const subject = r.stdout.trim();
      return ok(r) && subject ? subject : null;
    },

    async preview(cwd, ref) {
      const oid = await commitOf(cwd, ref);
      return oid ? stat(cwd, oid) : null;
    },

    async restore(cwd, ref) {
      const oid = await commitOf(cwd, ref);
      if (!oid) return null;
      // Measured first: once the tree is back there is nothing left to count.
      const before = await stat(cwd, oid);
      if (!ok(await run(["restore", "--source", oid, "--worktree", "--staged", "--", "."], cwd))) {
        return null;
      }
      await run(["clean", "-fd", "--", "."], cwd);
      // `restore --staged` left the index holding the checkpoint's tree, which would show every
      // restored file as staged. Reset it back to HEAD so the user's staging area reads the way it
      // did before — the worktree keeps the restored content.
      if (await headExists(cwd)) await run(["reset", "--quiet", "--", "."], cwd);
      return before;
    },

    async turns(cwd, scopeId) {
      const r = await run(
        ["for-each-ref", "--format=%(refname)", `${checkpointScope(scopeId)}/turn/`],
        cwd,
      );
      if (!ok(r)) return [];
      const found: number[] = [];
      for (const line of lines(r.stdout)) {
        const match = /\/turn\/(\d+)$/.exec(line);
        if (match) found.push(Number(match[1]));
      }
      return found.sort((a, b) => a - b);
    },

    async remove(cwd, refs) {
      for (const ref of refs) await run(["update-ref", "-d", ref], cwd);
    },
  };
}
