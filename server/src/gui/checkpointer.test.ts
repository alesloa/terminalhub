import { describe, it, expect } from "vitest";
import { checkpointRef, type CheckpointStat, type GitCheckpoints } from "../git/checkpoints.js";
import { checkpointLabel, createGuiCheckpointer } from "./checkpointer.js";

const CWD = "/ws";
const SCOPE = "tm_1";
const STAT: CheckpointStat = { files: 2, insertions: 7, deletions: 1, removed: 1 };

/** In-memory stand-in for the git plumbing. Trees are opaque tokens, so a test can tell "the
 *  snapshot was kept" from "the snapshot was retaken" — the distinction the relabel path exists for. */
function fakeGit(isRepo = true) {
  const refs = new Map<string, { tree: string; label: string }>();
  const calls: string[] = [];
  let trees = 0;
  let worktree = "live";

  const git: GitCheckpoints = {
    async isRepo() { calls.push("isRepo"); return isRepo; },
    async capture(_cwd, ref, label) {
      calls.push(`capture ${ref}`);
      refs.set(ref, { tree: `tree${++trees}`, label });
      return true;
    },
    async relabel(_cwd, ref, label) {
      calls.push(`relabel ${ref}`);
      const existing = refs.get(ref);
      if (!existing) return false;
      refs.set(ref, { ...existing, label });
      return true;
    },
    async label(_cwd, ref) { return refs.get(ref)?.label ?? null; },
    async preview(_cwd, ref) { calls.push(`preview ${ref}`); return refs.has(ref) ? STAT : null; },
    async restore(_cwd, ref) {
      calls.push(`restore ${ref}`);
      const found = refs.get(ref);
      if (!found) return null;
      worktree = found.tree;
      return STAT;
    },
    async turns() {
      return [...refs.keys()]
        .flatMap((r) => { const m = /\/turn\/(\d+)$/.exec(r); return m ? [Number(m[1])] : []; })
        .sort((a, b) => a - b);
    },
    async remove(_cwd, list) { for (const r of list) { calls.push(`remove ${r}`); refs.delete(r); } },
  };

  return { git, refs, calls, worktree: () => worktree };
}

function make(over: Partial<Parameters<typeof createGuiCheckpointer>[0]> = {}, isRepo = true) {
  const fake = fakeGit(isRepo);
  const checkpointer = createGuiCheckpointer({
    scopeId: SCOPE, cwd: CWD, resumed: false,
    priorTurns: async () => 0,
    checkpoints: fake.git,
    ...over,
  });
  return { ...fake, checkpointer };
}

describe("createGuiCheckpointer.beforeTurn", () => {
  it("snapshots the workspace before the turn runs, labelled for that message", async () => {
    const { checkpointer, refs } = make();
    await checkpointer.beforeTurn("do the thing");
    expect(refs.get(checkpointRef(SCOPE, 0))?.label).toBe(checkpointLabel(0, "do the thing"));
  });

  it("numbers turns in the order they were sent", async () => {
    const { checkpointer, refs } = make();
    await Promise.all([checkpointer.beforeTurn("one"), checkpointer.beforeTurn("two")]);
    expect(refs.get(checkpointRef(SCOPE, 0))?.label).toBe(checkpointLabel(0, "one"));
    expect(refs.get(checkpointRef(SCOPE, 1))?.label).toBe(checkpointLabel(1, "two"));
  });

  it("starts a resumed conversation after the turns already on disk", async () => {
    const { checkpointer, refs } = make({ resumed: true, priorTurns: async () => 3 });
    await checkpointer.beforeTurn("next");
    expect(refs.has(checkpointRef(SCOPE, 3))).toBe(true);
    expect(refs.has(checkpointRef(SCOPE, 0))).toBe(false);
  });

  it("clears a previous conversation's snapshots before starting a fresh one", async () => {
    const { checkpointer, git, refs } = make();
    await git.capture(CWD, checkpointRef(SCOPE, 0), "leftover");
    await git.capture(CWD, checkpointRef(SCOPE, 1), "leftover");
    await checkpointer.beforeTurn("brand new chat");
    expect([...refs.keys()]).toEqual([checkpointRef(SCOPE, 0)]);
    expect(refs.get(checkpointRef(SCOPE, 0))?.label).toBe(checkpointLabel(0, "brand new chat"));
  });

  it("does nothing in a workspace that isn't a git repository", async () => {
    const { checkpointer, calls } = make({}, false);
    await checkpointer.beforeTurn("hello");
    expect(calls.some((c) => c.startsWith("capture"))).toBe(false);
  });

  it("skips rather than guessing when the conversation's turn count is unknown", async () => {
    const { checkpointer, calls } = make({ resumed: true, priorTurns: async () => null });
    await checkpointer.beforeTurn("hello");
    expect(calls.some((c) => c.startsWith("capture"))).toBe(false);
  });

  it("keeps the original tree when a message is re-sent at a rewound turn", async () => {
    const { checkpointer, refs } = make();
    await checkpointer.beforeTurn("first wording");
    const original = refs.get(checkpointRef(SCOPE, 0))?.tree;

    await checkpointer.cutTo(0);
    await checkpointer.beforeTurn("second wording");

    const after = refs.get(checkpointRef(SCOPE, 0));
    // Same snapshot — undoing to this message must mean the tree it ORIGINALLY found.
    expect(after?.tree).toBe(original);
    // …but the label follows the message that now occupies the slot, so a restore still verifies.
    expect(after?.label).toBe(checkpointLabel(0, "second wording"));
  });
});

describe("createGuiCheckpointer.restore", () => {
  it("puts the tree back and reports what it changed", async () => {
    const { checkpointer, worktree, refs } = make();
    await checkpointer.beforeTurn("turn zero");
    const tree = refs.get(checkpointRef(SCOPE, 0))?.tree;

    const result = await checkpointer.restore(0, "turn zero");
    expect(result).toEqual({ ok: true, stat: STAT });
    expect(worktree()).toBe(tree);
  });

  it("refuses when nothing was snapshotted before that message", async () => {
    const { checkpointer, calls } = make();
    const result = await checkpointer.restore(2, "never ran");
    expect(result).toEqual({ ok: false, reason: "no snapshot was taken before that message" });
    expect(calls.some((c) => c.startsWith("restore"))).toBe(false);
  });

  it("refuses — without touching the tree — when the snapshot is for a different message", async () => {
    const { checkpointer, calls, worktree } = make();
    await checkpointer.beforeTurn("the real turn zero");
    const result = await checkpointer.restore(0, "some other message entirely");
    expect(result).toEqual({ ok: false, reason: "the snapshot there belongs to a different message" });
    expect(calls.some((c) => c.startsWith("restore"))).toBe(false);
    expect(worktree()).toBe("live");
  });

  it("refuses in a workspace that isn't a git repository", async () => {
    const { checkpointer } = make({}, false);
    expect(await checkpointer.restore(0, "x"))
      .toEqual({ ok: false, reason: "this workspace isn't a git repository" });
  });
});

describe("createGuiCheckpointer.preview", () => {
  it("reports what a restore would change without changing anything", async () => {
    const { checkpointer, calls, worktree } = make();
    await checkpointer.beforeTurn("turn zero");
    expect(await checkpointer.preview(0, "turn zero")).toEqual({ ok: true, stat: STAT });
    expect(calls.some((c) => c.startsWith("restore"))).toBe(false);
    expect(worktree()).toBe("live");
  });

  it("gives the same refusal a restore would, so the UI can say why up front", async () => {
    const { checkpointer } = make();
    expect(await checkpointer.preview(1, "nothing here"))
      .toEqual({ ok: false, reason: "no snapshot was taken before that message" });
  });
});

describe("createGuiCheckpointer.cutTo", () => {
  it("drops the snapshots for turns the rewind threw away, and keeps the target's", async () => {
    const { checkpointer, refs } = make();
    await checkpointer.beforeTurn("a");
    await checkpointer.beforeTurn("b");
    await checkpointer.beforeTurn("c");

    await checkpointer.cutTo(1);
    expect([...refs.keys()].sort()).toEqual([checkpointRef(SCOPE, 0), checkpointRef(SCOPE, 1)].sort());
  });

  it("re-bases the turn counter on the rewind's own count", async () => {
    const { checkpointer, refs } = make({ resumed: true, priorTurns: async () => 9 });
    await checkpointer.beforeTurn("a");
    await checkpointer.cutTo(2);
    await checkpointer.beforeTurn("b");
    expect(refs.get(checkpointRef(SCOPE, 2))?.label).toBe(checkpointLabel(2, "b"));
  });
});
