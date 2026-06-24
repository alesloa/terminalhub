import { describe, it, expect } from "vitest";
import { parseStatus, parseLog, parseBranches, parseWorktrees, LOG_FORMAT, BRANCH_FORMAT } from "./porcelain.js";

const US = "\x1f";

describe("parseStatus (porcelain v2)", () => {
  const out = [
    "# branch.oid abc123",
    "# branch.head main",
    "# branch.upstream origin/main",
    "# branch.ab +2 -1",
    "1 M. N... 100644 100644 100644 aaa bbb staged-mod.ts",
    "1 .M N... 100644 100644 100644 ccc ddd worktree-mod.ts",
    "1 MM N... 100644 100644 100644 eee fff both.ts",
    "1 A. N... 000000 100644 100644 000 ggg new staged.ts", // path with a space
    "2 R. N... 100644 100644 100644 hhh iii R100 renamed-new.ts\trenamed-old.ts",
    "u UU N... 100644 100644 100644 100644 jjj kkk lll conflict.ts",
    "? untracked.ts",
    "! ignored.ts",
  ].join("\n");

  const s = parseStatus(out);

  it("reads branch + upstream + ahead/behind", () => {
    expect(s.branch).toBe("main");
    expect(s.upstream).toBe("origin/main");
    expect(s.ahead).toBe(2);
    expect(s.behind).toBe(1);
    expect(s.detached).toBe(false);
  });

  it("groups staged entries (index side)", () => {
    expect(s.staged.map(e => e.path).sort()).toEqual(
      ["both.ts", "new staged.ts", "renamed-new.ts", "staged-mod.ts"],
    );
    expect(s.staged.find(e => e.path === "renamed-new.ts")?.orig).toBe("renamed-old.ts");
    expect(s.staged.find(e => e.path === "renamed-new.ts")?.index).toBe("R");
  });

  it("groups unstaged entries (worktree side), incl. partially staged", () => {
    expect(s.unstaged.map(e => e.path).sort()).toEqual(["both.ts", "worktree-mod.ts"]);
  });

  it("collects untracked and conflicted, drops ignored", () => {
    expect(s.untracked).toEqual(["untracked.ts"]);
    expect(s.conflicted.map(e => e.path)).toEqual(["conflict.ts"]);
  });

  it("handles a clean detached HEAD with no upstream", () => {
    const d = parseStatus("# branch.oid abc\n# branch.head (detached)\n");
    expect(d.detached).toBe(true);
    expect(d.branch).toBe(null);
    expect(d.ahead).toBe(0);
    expect(d.behind).toBe(0);
    expect(d.staged).toEqual([]);
  });
});

describe("parseStatus — submodules / gitlinks", () => {
  // porcelain v2 field 3 is the submodule state `S<c><m><u>`: c=commit changed, m=tracked
  // modifications inside, u=untracked content inside. A non-submodule entry is `N...`.
  const out = [
    "# branch.head main",
    "1 .M S..U 160000 160000 160000 e5e e5e sub-untracked",   // inner untracked only, commit unchanged
    "1 .M S.M. 160000 160000 160000 e5e e5e sub-dirty",       // inner tracked mods, commit unchanged
    "1 M. SC.. 160000 160000 160000 aaa bbb sub-bumped",      // staged gitlink bump, no inner dirt
    "1 .M SC.U 160000 160000 160000 aaa bbb sub-bumped-dirty",// gitlink moved (worktree) + inner untracked
    "1 .M N... 100644 100644 100644 ccc ddd plain.ts",        // ordinary file, still unstaged
  ].join("\n");
  const s = parseStatus(out);

  it("hides a submodule whose only change is inner dirt (commit unchanged) from the change lists", () => {
    // VS Code does the same — the parent can't stage inner content, so it isn't a stuck row.
    expect(s.unstaged.map(e => e.path)).not.toContain("sub-untracked");
    expect(s.unstaged.map(e => e.path)).not.toContain("sub-dirty");
    expect(s.unstaged.map(e => e.path)).toContain("plain.ts");
  });

  it("keeps a gitlink whose recorded commit moved (stageable in the parent)", () => {
    expect(s.staged.map(e => e.path)).toContain("sub-bumped");          // staged bump
    expect(s.unstaged.map(e => e.path)).toContain("sub-bumped-dirty");  // worktree bump → stageable
  });

  it("surfaces every dirty submodule (inner mods/untracked) in `submodules` with its inner state", () => {
    expect(s.submodules.map(m => m.path).sort()).toEqual(["sub-bumped-dirty", "sub-dirty", "sub-untracked"]);
    const u = s.submodules.find(m => m.path === "sub-untracked")!;
    expect(u).toEqual({ path: "sub-untracked", commitChanged: false, hasModifications: false, hasUntracked: true });
    const d = s.submodules.find(m => m.path === "sub-dirty")!;
    expect(d.hasModifications).toBe(true);
    expect(d.hasUntracked).toBe(false);
    const bd = s.submodules.find(m => m.path === "sub-bumped-dirty")!;
    expect(bd.commitChanged).toBe(true);
    expect(bd.hasUntracked).toBe(true);
  });

  it("does not list a clean gitlink bump (no inner dirt) as a drillable submodule", () => {
    expect(s.submodules.map(m => m.path)).not.toContain("sub-bumped");
  });
});

describe("parseLog", () => {
  const NUL = "\x00";
  const out = [
    ["abc", "def ghi", "Ale", "ale@x.com", "1700000000",
      "HEAD -> refs/heads/main, refs/remotes/origin/main, refs/remotes/origin/HEAD, tag: refs/tags/v1",
      "first subject", "body line one\nbody line two\n"].join(US),
    ["def", "", "Ale", "ale@x.com", "1699999999", "", "root commit", ""].join(US),
  ].join(NUL);

  const commits = parseLog(out);

  it("parses hashes, parents, and dates (NUL-separated records)", () => {
    expect(commits).toHaveLength(2);
    expect(commits[0].hash).toBe("abc");
    expect(commits[0].parents).toEqual(["def", "ghi"]);
    expect(commits[0].date).toBe(1700000000);
    expect(commits[1].parents).toEqual([]); // root commit
  });

  it("classifies full-path decoration refs into local / remote / tag", () => {
    expect(commits[0].refs).toEqual([
      { name: "main", kind: "branch", current: true },
      { name: "origin/main", kind: "remote", current: false },
      { name: "origin/HEAD", kind: "remote", current: false },
      { name: "v1", kind: "tag", current: false },
    ]);
    expect(commits[1].refs).toEqual([]);
  });

  it("captures the multi-line body, trimming trailing blank lines", () => {
    expect(commits[0].body).toBe("body line one\nbody line two");
    expect(commits[1].body).toBe("");
  });

  it("LOG_FORMAT uses the unit separator between the 8 fields", () => {
    expect(LOG_FORMAT.split(US)).toHaveLength(8);
  });
});

describe("parseBranches", () => {
  const out = [
    ["*", "main", "origin/main"].join(US),
    [" ", "dev", ""].join(US),
  ].join("\n");

  it("flags the current branch and reads upstreams", () => {
    const b = parseBranches(out);
    expect(b).toEqual([
      { name: "main", current: true, upstream: "origin/main" },
      { name: "dev", current: false, upstream: null },
    ]);
  });

  it("BRANCH_FORMAT has 3 fields", () => {
    expect(BRANCH_FORMAT.split(US)).toHaveLength(3);
  });
});

describe("parseWorktrees", () => {
  const out = [
    "worktree /repo",
    "HEAD aaa111",
    "branch refs/heads/main",
    "",
    "worktree /repo/.worktrees/feat",
    "HEAD bbb222",
    "branch refs/heads/feat",
    "locked needs review",
    "",
    "worktree /repo/.worktrees/detached",
    "HEAD ccc333",
    "detached",
    "",
  ].join("\n");

  const trees = parseWorktrees(out);

  it("flags the first entry as the main worktree and reads its branch", () => {
    expect(trees).toHaveLength(3);
    expect(trees[0]).toEqual({ path: "/repo", head: "aaa111", branch: "main", bare: false, detached: false, locked: false, main: true });
  });

  it("reads a linked worktree's short branch + locked flag", () => {
    expect(trees[1].path).toBe("/repo/.worktrees/feat");
    expect(trees[1].branch).toBe("feat");
    expect(trees[1].locked).toBe(true);
    expect(trees[1].main).toBe(false);
  });

  it("marks a detached worktree with a null branch", () => {
    expect(trees[2].detached).toBe(true);
    expect(trees[2].branch).toBe(null);
    expect(trees[2].head).toBe("ccc333");
  });

  it("handles a bare main worktree (no HEAD/branch)", () => {
    const bare = parseWorktrees("worktree /repo.git\nbare\n");
    expect(bare[0]).toEqual({ path: "/repo.git", head: null, branch: null, bare: true, detached: false, locked: false, main: true });
  });
});
