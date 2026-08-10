import { createHash } from "node:crypto";
import {
  checkpointRef, createGitCheckpoints, type CheckpointStat, type GitCheckpoints,
} from "../git/checkpoints.js";

// Ties git checkpoints to a GUI chat: one snapshot of the workspace taken just before each user
// turn runs, so "undo file changes" on a rewind can put the tree back exactly as that message found
// it — including whatever a Bash command, an install, a formatter or a migration did, none of which
// the agent's own per-file backups cover.
//
// Checkpoints are addressed by the turn's position in the conversation, counting human turns from
// the start. That index is the one thing both ends agree on: the capture side counts the turns it
// has sent, the rewind side reads the index straight out of the transcript it just parsed. To stop
// a drift between the two from restoring the WRONG tree — the one genuinely destructive failure
// here — every checkpoint records which message it precedes, and a restore that doesn't match that
// record refuses and lets the caller fall back.
//
// The scope is the terminal, not the Claude session id: a rewind forks the conversation into a new
// id, and the checkpoints have to survive that.

const LABEL_PREFIX = "terminalhub checkpoint";

/** Short digest of the turn text a checkpoint sits in front of. Only ever compared to itself, so a
 *  truncated sha256 is plenty — this is a mismatch detector, not a security boundary. */
function digest(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex").slice(0, 16);
}

export function checkpointLabel(turn: number, text: string): string {
  return `${LABEL_PREFIX} turn=${turn} next=${digest(text)}`;
}

export type CheckpointOutcome =
  | { ok: true; stat: CheckpointStat }
  /** Phrased to be read after "Could not undo file changes: …". */
  | { ok: false; reason: string };

export interface GuiCheckpointer {
  /** Snapshot the workspace before `text` runs. Resolves once the snapshot is safely taken — the
   *  caller must not let the agent start before that, or the baseline would already include the
   *  turn's own edits. Best-effort: a workspace that isn't a git repo resolves immediately. */
  beforeTurn(text: string): Promise<void>;
  /** What restoring the checkpoint in front of human turn `turnIndex` would change right now. */
  preview(turnIndex: number, text: string): Promise<CheckpointOutcome>;
  restore(turnIndex: number, text: string): Promise<CheckpointOutcome>;
  /** The conversation was cut back to `turnIndex` human turns. Drops the checkpoints that no longer
   *  describe anything, and re-bases the turn counter on the truth the rewind established. */
  cutTo(turnIndex: number): Promise<void>;
}

export interface GuiCheckpointerOptions {
  /** Stable id for the chat — the terminal, since the Claude session id changes on every fork. */
  scopeId: string;
  cwd: string;
  /** True when this session continues a conversation that already exists on disk. */
  resumed: boolean;
  /** Human turns the conversation already had when this session started. Null when that can't be
   *  established (the transcript isn't on disk yet), which disables checkpointing for the turn
   *  rather than guessing an index and snapshotting under the wrong one. */
  priorTurns: () => Promise<number | null>;
  checkpoints?: GitCheckpoints;
}

export function createGuiCheckpointer(opts: GuiCheckpointerOptions): GuiCheckpointer {
  const git = opts.checkpoints ?? createGitCheckpoints();
  const ref = (turn: number) => checkpointRef(opts.scopeId, turn);

  let isRepo: boolean | null = null;
  // Human turns before the first one this session sends. Null until resolved.
  let base: number | null = null;
  // Turns handed out since `base` was set.
  let assigned = 0;
  // Captures are serialized so two prompts sent back to back can't race for the same turn number,
  // and so the second snapshot can't land while the first turn is still being handed to the agent.
  let chain: Promise<unknown> = Promise.resolve();

  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const next = chain.then(task, task);
    chain = next.catch(() => {});
    return next;
  };

  const repoCheck = async (): Promise<boolean> => {
    if (isRepo === null) isRepo = await git.isRepo(opts.cwd);
    return isRepo;
  };

  /** Resolve the turn counter, and — for a conversation starting from scratch — clear whatever the
   *  terminal's previous chat left behind, so an old snapshot can never be mistaken for this one's. */
  const ready = async (): Promise<boolean> => {
    if (!(await repoCheck())) return false;
    if (base !== null) return true;
    const prior = opts.resumed ? await opts.priorTurns() : 0;
    if (prior === null) return false;
    base = prior;
    if (!opts.resumed) {
      const stale = await git.turns(opts.cwd, opts.scopeId);
      if (stale.length) await git.remove(opts.cwd, stale.map(ref));
    }
    return true;
  };

  const resolve = async (
    turnIndex: number, text: string,
  ): Promise<{ ok: true; ref: string } | { ok: false; reason: string }> => {
    if (!(await repoCheck())) return { ok: false, reason: "this workspace isn't a git repository" };
    const at = ref(turnIndex);
    const label = await git.label(opts.cwd, at);
    if (!label) return { ok: false, reason: "no snapshot was taken before that message" };
    if (label !== checkpointLabel(turnIndex, text)) {
      return { ok: false, reason: "the snapshot there belongs to a different message" };
    }
    return { ok: true, ref: at };
  };

  return {
    beforeTurn(text) {
      return enqueue(async () => {
        if (!(await ready())) return;
        const turn = (base ?? 0) + assigned;
        assigned += 1;
        const at = ref(turn);
        const label = checkpointLabel(turn, text);
        // A snapshot already sitting at this turn is an earlier attempt at the same position — the
        // user rewound here and is sending again. Keep its tree: "undo to this message" means the
        // tree as the message ORIGINALLY found it, not as the abandoned attempt left it. Only the
        // label is refreshed, so it describes whatever message occupies the slot now.
        const existing = await git.label(opts.cwd, at);
        if (existing) { await git.relabel(opts.cwd, at, label); return; }
        await git.capture(opts.cwd, at, label);
      });
    },

    async preview(turnIndex, text) {
      const found = await resolve(turnIndex, text);
      if (!found.ok) return found;
      const stat = await git.preview(opts.cwd, found.ref);
      return stat ? { ok: true, stat } : { ok: false, reason: "the snapshot could not be read" };
    },

    async restore(turnIndex, text) {
      const found = await resolve(turnIndex, text);
      if (!found.ok) return found;
      const stat = await git.restore(opts.cwd, found.ref);
      return stat ? { ok: true, stat } : { ok: false, reason: "the snapshot could not be read" };
    },

    cutTo(turnIndex) {
      return enqueue(async () => {
        // The rewind parsed the transcript, so this count is authoritative — trust it over whatever
        // the counter had drifted to.
        base = turnIndex;
        assigned = 0;
        if (isRepo === false) return;
        const turns = await git.turns(opts.cwd, opts.scopeId);
        const stale = turns.filter((t) => t > turnIndex).map(ref);
        if (stale.length) await git.remove(opts.cwd, stale);
      });
    },
  };
}
