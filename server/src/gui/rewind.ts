import type { SessionEntry } from "../claude/types.js";
import { extractTextContent } from "../claude/jsonl.js";

// Rewinding a GUI chat to an earlier user turn — the "edit this message" / "delete this message"
// path. Claude's conversation is an append-only chain, so there is no way to remove one message and
// keep what came after it: cutting at a turn necessarily drops that turn and everything past it.
//
// The cut itself is the SDK's own `resumeSessionAt` + `forkSession`, which starts a NEW session
// holding only the kept prefix. The original transcript is left untouched on disk — a rewind must
// never destroy the conversation it rewinds, because "I meant the other one" is the most likely
// thing to happen next.
//
// The fork point is a chain-entry UUID, so this module's whole job is turning "the user turn the
// browser clicked" into that UUID.

/** Identify a user turn by how many user turns come AFTER it — 0 is the most recent one. Counting
 *  from the end rather than the start is what makes this survive a truncated history window: the
 *  browser may only hold the last 200 messages, but the tail always lines up with the transcript. */
export interface RewindTarget {
  userTurnsAfter: number;
  /** The text the browser is showing for that turn. Verified against the transcript so a view that
   *  has drifted out of sync fails loudly instead of cutting the conversation at the wrong place. */
  text: string;
}

export interface ForkPoint {
  /** The chain entry to resume at — the last entry of the turn being KEPT. Null when the target is
   *  the very first thing in the conversation, i.e. nothing survives the cut. */
  uuid: string | null;
  /** The dropped user turn's own uuid — what `Query.rewindFiles()` restores the working tree to. */
  targetUuid: string | null;
  /** Line index of the targeted user entry, for callers that want to report what was dropped. */
  lineIndex: number;
  /** The dropped turn's position counting human turns from the start of the conversation — which is
   *  also how many turns survive the cut. This is the address a workspace checkpoint is filed under,
   *  read here from the transcript itself rather than from a counter that could have drifted. */
  turnIndex: number;
}

export type ForkPointResult =
  | { ok: true; point: ForkPoint }
  | { ok: false; error: string };

/** Human turns, in order. Mirrors the filter history.ts renders from — subagent narration and
 *  tool-result carriers are not turns the user can rewind to, so they must not be counted. */
function humanTurns(entries: SessionEntry[]): SessionEntry[] {
  return entries.filter((e) => {
    if (e.parsed.isSidechain === true) return false;
    if (e.parsed.type !== "user" || e.entryType !== "User") return false;
    const message = e.parsed.message as { content?: unknown } | undefined;
    return extractTextContent(message?.content).trim().length > 0;
  });
}

/** How many human turns a conversation holds. The address space workspace checkpoints are filed
 *  under, so the capture side can line itself up with a conversation it didn't start. */
export function countHumanTurns(entries: SessionEntry[]): number {
  return humanTurns(entries).length;
}

/** Resolve a rewind target to the chain entry a truncating resume should fork at. */
export function findForkPoint(entries: SessionEntry[], target: RewindTarget): ForkPointResult {
  if (target.userTurnsAfter < 0) return { ok: false, error: "Invalid rewind target." };
  const turns = humanTurns(entries);
  const turnIndex = turns.length - 1 - target.userTurnsAfter;
  const entry = turns[turnIndex];
  if (!entry) return { ok: false, error: "That message is no longer in this conversation." };

  const message = entry.parsed.message as { content?: unknown } | undefined;
  const actual = extractTextContent(message?.content).trim();
  if (actual !== target.text.trim()) {
    return { ok: false, error: "This chat has moved on since that message — reload and try again." };
  }

  // The kept turn's last chain entry is the line immediately before the one being dropped. The SDK
  // validates that everything past the fork point belongs to the discarded turn, so anything looser
  // (e.g. the previous assistant message's uuid) gets refused outright.
  let uuid: string | null = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.lineIndex >= entry.lineIndex) continue;
    if (typeof e.uuid === "string" && e.uuid) { uuid = e.uuid; break; }
  }
  return {
    ok: true,
    point: { uuid, targetUuid: entry.uuid ?? null, lineIndex: entry.lineIndex, turnIndex },
  };
}

/** The messages a rewound chat should show: everything before the targeted user turn. Same
 *  "count user turns from the end" addressing, applied to what the chat is rendering. */
export function truncateMessages<T extends { role: "user" | "assistant" }>(
  messages: T[], userTurnsAfter: number,
): T[] | null {
  const userIndexes = messages.flatMap((m, i) => (m.role === "user" ? [i] : []));
  const index = userIndexes[userIndexes.length - 1 - userTurnsAfter];
  return index === undefined ? null : messages.slice(0, index);
}
