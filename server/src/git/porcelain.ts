import type { GitStatus, GitFileEntry, GitCommit, GitRef, GitBranch, GitWorktree, SubmoduleEntry } from "./types.js";

// Unit separator — used as an in-record field delimiter for log/branch formats.
// Git output never contains it, so splitting is unambiguous even for paths/subjects
// with spaces, arrows, or commas.
const US = "\x1f";

/**
 * Parse `git status --porcelain=v2 --branch`.
 * v2 keeps the index and worktree status in two separate chars (XY), so a partially
 * staged file lands in BOTH the staged and unstaged groups — matching VS Code's SCM.
 */
export function parseStatus(out: string): GitStatus {
  const s: GitStatus = {
    branch: null, upstream: null, ahead: 0, behind: 0, detached: false,
    staged: [], unstaged: [], untracked: [], conflicted: [], remotes: [], submodules: [],
  };

  for (const line of out.split("\n")) {
    if (!line) continue;

    if (line.startsWith("# branch.head ")) {
      const head = line.slice("# branch.head ".length);
      if (head === "(detached)") s.detached = true;
      else s.branch = head;
    } else if (line.startsWith("# branch.upstream ")) {
      s.upstream = line.slice("# branch.upstream ".length) || null;
    } else if (line.startsWith("# branch.ab ")) {
      const m = line.match(/\+(-?\d+) -(-?\d+)/);
      if (m) { s.ahead = parseInt(m[1], 10); s.behind = parseInt(m[2], 10); }
    } else if (line.startsWith("1 ")) {
      // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
      const parts = line.split(" ");
      addEntry(s, line[2], line[3], parts[2], parts.slice(8).join(" "));
    } else if (line.startsWith("2 ")) {
      // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <Xscore> <path>\t<origPath>
      const parts = line.split(" ");
      const [path, orig] = parts.slice(9).join(" ").split("\t");
      addEntry(s, line[2], line[3], parts[2], path, orig);
    } else if (line.startsWith("u ")) {
      // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
      const parts = line.split(" ");
      s.conflicted.push({ path: parts.slice(10).join(" "), index: line[2], worktree: line[3] });
    } else if (line.startsWith("? ")) {
      s.untracked.push(line.slice(2));
    }
    // "! " ignored entries and "# branch.oid" are intentionally dropped.
  }
  return s;
}

/**
 * Route one changed entry, peeling off submodules first. `sub` is porcelain v2's field 3:
 * `S<c><m><u>` for a submodule (c=commit moved, m=inner mods, u=inner untracked), or `N...` for an
 * ordinary path. A submodule with inner dirt is recorded in `submodules` (drill-in target). When its
 * recorded commit hasn't moved AND nothing is staged for it, the parent literally can't stage it —
 * `git add` is a no-op — so we drop it from the change lists rather than leave a row that won't tick.
 * VS Code hides the same case from the parent and lets you commit it in the submodule's own repo.
 */
function addEntry(s: GitStatus, x: string, y: string, sub: string, path: string, orig?: string) {
  if (sub && sub[0] === "S") {
    const commitChanged = sub[1] === "C";
    const hasModifications = sub[2] === "M";
    const hasUntracked = sub[3] === "U";
    if (hasModifications || hasUntracked) s.submodules.push({ path, commitChanged, hasModifications, hasUntracked });
    if (!commitChanged && x === ".") return; // inner-only dirt → not stageable in the parent; skip the row
  }
  addChanged(s, x, y, path, orig);
}

function addChanged(s: GitStatus, x: string, y: string, path: string, orig?: string) {
  if (x !== ".") s.staged.push({ path, orig, index: x, worktree: "." });
  if (y !== ".") s.unstaged.push({ path, orig, index: ".", worktree: y });
}

/**
 * Custom pretty format whose fields parseLog() reads back. Keep in sync with parseLog.
 * `%b` (body) is last because it can contain newlines — commits are NUL-separated (`log -z`)
 * so an embedded newline never splits a record. Refs come from `--decorate=full`.
 */
export const LOG_FORMAT = ["%H", "%P", "%an", "%ae", "%at", "%D", "%s", "%b"].join(US);

export function parseLog(out: string): GitCommit[] {
  const commits: GitCommit[] = [];
  for (const record of out.split("\0")) {
    if (!record) continue;
    const f = record.split(US);
    if (f.length < 7) continue;
    const [hash, parents, author, email, at, refs, subject] = f;
    commits.push({
      hash,
      parents: parents ? parents.split(" ").filter(Boolean) : [],
      author,
      email,
      date: parseInt(at, 10) || 0,
      refs: parseRefs(refs),
      subject,
      body: f.slice(7).join(US).replace(/\n+$/, ""), // trailing field; drop trailing blank lines
    });
  }
  return commits;
}

/** Strip the refs/{heads,remotes,tags}/ namespace from a full ref path to its short name. */
function shortRef(full: string): string {
  return full.replace(/^refs\/(heads|remotes|tags)\//, "");
}

/**
 * Classify the `%D` decoration (with `--decorate=full`) into local branches, remote-tracking
 * refs, tags, and bare HEAD. Full ref paths are what make local-vs-remote unambiguous — a
 * local branch "feature/x" and a remote "origin/x" both contain a slash, so the namespace
 * prefix is the only reliable signal.
 */
function parseRefs(decoration: string): GitRef[] {
  const refs: GitRef[] = [];
  for (const raw of decoration.split(", ").map(s => s.trim()).filter(Boolean)) {
    if (raw === "HEAD") refs.push({ name: "HEAD", kind: "head", current: false });
    else if (raw.startsWith("HEAD -> ")) refs.push({ name: shortRef(raw.slice(8)), kind: "branch", current: true });
    else if (raw.startsWith("tag: ")) refs.push({ name: shortRef(raw.slice(5)), kind: "tag", current: false });
    else if (raw.startsWith("refs/remotes/")) refs.push({ name: raw.slice("refs/remotes/".length), kind: "remote", current: false });
    else if (raw.startsWith("refs/tags/")) refs.push({ name: raw.slice("refs/tags/".length), kind: "tag", current: false });
    else if (raw.startsWith("refs/heads/")) refs.push({ name: raw.slice("refs/heads/".length), kind: "branch", current: false });
    else refs.push({ name: raw, kind: "branch", current: false }); // short-form fallback (tests)
  }
  return refs;
}

/** for-each-ref / branch format whose fields parseBranches() reads back. */
export const BRANCH_FORMAT = ["%(HEAD)", "%(refname:short)", "%(upstream:short)"].join(US);

export function parseBranches(out: string): GitBranch[] {
  const branches: GitBranch[] = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    const [head, name, upstream] = line.split(US);
    if (!name) continue;
    branches.push({ name, current: head === "*", upstream: upstream || null });
  }
  return branches;
}

/**
 * Parse `git worktree list --porcelain`. Records are separated by a blank line; each
 * has a `worktree <path>` line plus optional `HEAD`, `branch refs/heads/<name>`,
 * `bare`, `detached`, `locked [reason]`. The first record is the main worktree.
 */
export function parseWorktrees(out: string): GitWorktree[] {
  const trees: GitWorktree[] = [];
  for (const block of out.split("\n\n")) {
    const lines = block.split("\n").filter(Boolean);
    const head = lines.find(l => l.startsWith("worktree "));
    if (!head) continue;
    const branch = lines.find(l => l.startsWith("branch "));
    const sha = lines.find(l => l.startsWith("HEAD "));
    trees.push({
      path: head.slice("worktree ".length),
      head: sha ? sha.slice("HEAD ".length) : null,
      branch: branch ? branch.slice("branch ".length).replace(/^refs\/heads\//, "") : null,
      bare: lines.includes("bare"),
      detached: lines.includes("detached"),
      locked: lines.some(l => l === "locked" || l.startsWith("locked ")),
      main: trees.length === 0,
    });
  }
  return trees;
}

export type { GitStatus, GitFileEntry, GitCommit, GitRef, GitBranch, GitWorktree };
