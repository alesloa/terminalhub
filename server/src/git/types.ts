// Git domain types. Mirrored by hand in web/src/api/types.ts when the API shape
// changes (there is no shared package — see CLAUDE.md).

/** One path in `git status`, split into its index (staged) and worktree (unstaged) side. */
export interface GitFileEntry {
  path: string;
  orig?: string; // rename/copy source
  index: string; // staged-side status char: M A D R C, or "." for none
  worktree: string; // worktree-side status char: M D, or "." for none
}

/**
 * A submodule / embedded-gitlink row from `git status` (porcelain v2 field `S<c><m><u>`).
 * The parent repo can only stage it when its recorded commit moved (`commitChanged`); dirt that
 * lives *inside* the submodule (modified/untracked files) isn't stageable from the parent — it's
 * committed in the submodule's own repo. Surfaced separately so the UI can drill into it (à la
 * VS Code opening the submodule as its own source-control scope) instead of showing a stuck row.
 */
export interface SubmoduleEntry {
  path: string;              // path to the submodule, relative to the parent work-tree root
  commitChanged: boolean;    // recorded gitlink commit differs from HEAD (a real, stageable parent change)
  hasModifications: boolean; // tracked files are modified inside the submodule
  hasUntracked: boolean;     // untracked files are present inside the submodule
}

export interface GitStatus {
  branch: string | null; // null when detached
  upstream: string | null;
  ahead: number;
  behind: number;
  detached: boolean;
  staged: GitFileEntry[];
  unstaged: GitFileEntry[];
  untracked: string[];
  conflicted: GitFileEntry[];
  remotes: string[]; // configured remote names ("origin", …); empty = never published
  // Submodules/gitlinks with inner dirt — drill-in targets, kept out of the change lists when the
  // parent can't stage them (commit unchanged). See SubmoduleEntry.
  submodules: SubmoduleEntry[];
}

/** A single decoration on a commit (branch tip, remote-tracking ref, tag, or bare HEAD). */
export interface GitRef {
  name: string; // short display name: "main", "origin/main", "v1.0", "HEAD"
  kind: "branch" | "remote" | "tag" | "head";
  current: boolean; // the checked-out branch (the target of "HEAD -> …")
}

export interface GitCommit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  date: number; // author timestamp, unix seconds
  refs: GitRef[]; // classified decorations (local branches, remotes, tags, HEAD)
  subject: string;
  body: string; // commit message body (everything after the subject line)
}

export interface GitBranch {
  name: string;
  current: boolean;
  upstream: string | null;
}

/** Repo probe result for the chosen folder. */
export interface GitInfo {
  installed: boolean; // git binary present on the host
  version: string | null;
  isRepo: boolean; // folder is inside a git work tree
  root: string | null; // work-tree root, when isRepo
}

/** One entry from `git worktree list --porcelain`. */
export interface GitWorktree {
  path: string;
  head: string | null; // checked-out commit sha, null for a bare worktree
  branch: string | null; // short branch name, null if detached or bare
  bare: boolean;
  detached: boolean;
  locked: boolean;
  main: boolean; // the first entry is the repo's main worktree
}
