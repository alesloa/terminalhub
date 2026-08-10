import type { GuiBlock, GuiMessage } from "../../api/guiTypes";
import type { GuiToolBlock } from "./ToolCard";

// A long turn is mostly tool calls, and the SDK puts each one in its own assistant message — so a
// per-message renderer draws a wall of one-line cards and the actual answer scrolls off. Runs of
// consecutive tool calls are folded into ONE run here, spanning message boundaries, so the view can
// collapse them behind a single toggle. Text and thinking always break a run: they're the thread of
// the conversation, and hiding them behind "+N tool calls" would hide the reasoning too.

export type TranscriptRow =
  /** A user turn, rendered verbatim. `userTurnsAfter` is how the server addresses it for a rewind:
   *  counting from the end survives a history window that only holds the tail of a long chat. */
  | { kind: "user"; id: string; message: GuiMessage; userTurnsAfter: number }
  /** Assistant text/thinking. */
  | { kind: "blocks"; id: string; blocks: GuiBlock[] }
  /** A run of back-to-back tool calls, however many messages it came from. */
  | { kind: "tools"; id: string; blocks: GuiToolBlock[] };

const isTool = (b: GuiBlock): b is GuiToolBlock => b.kind === "tool";

export function buildTranscriptRows(messages: GuiMessage[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  // The run currently being extended. Anything that isn't a tool call clears it, so a run only ever
  // covers calls that really were back-to-back.
  let openTools: Extract<TranscriptRow, { kind: "tools" }> | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      openTools = null;
      rows.push({ kind: "user", id: message.id, message, userTurnsAfter: 0 });
      continue;
    }
    for (const block of message.blocks) {
      if (isTool(block)) {
        if (openTools) openTools.blocks.push(block);
        else {
          openTools = { kind: "tools", id: block.id, blocks: [block] };
          rows.push(openTools);
        }
        continue;
      }
      openTools = null;
      const last = rows[rows.length - 1];
      if (last?.kind === "blocks") last.blocks.push(block);
      else rows.push({ kind: "blocks", id: block.id, blocks: [block] });
    }
  }
  // Fill in each user turn's distance from the end, now that the total is known.
  let after = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row.kind === "user") { row.userTurnsAfter = after; after += 1; }
  }
  return rows;
}

/** How many tool calls stay on screen when a run is collapsed — the newest one, so you can still see
 *  what the agent is doing right now. Matches the T3 chat's behaviour. */
export const VISIBLE_TOOL_CALLS = 1;

/** Split a run into the calls to hide and the calls to keep. A failed call is never hidden: an error
 *  you have to go looking for is an error you miss. */
export function splitToolRun(blocks: GuiToolBlock[]): { hidden: GuiToolBlock[]; shown: GuiToolBlock[] } {
  if (blocks.length <= VISIBLE_TOOL_CALLS) return { hidden: [], shown: blocks };
  const tail = new Set(blocks.slice(-VISIBLE_TOOL_CALLS));
  const hidden = blocks.filter((b) => !tail.has(b) && b.status !== "error");
  const hiddenSet = new Set(hidden);
  return { hidden, shown: blocks.filter((b) => !hiddenSet.has(b)) };
}
