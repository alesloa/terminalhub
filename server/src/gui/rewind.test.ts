import { describe, expect, it } from "vitest";
import type { SessionEntry } from "../claude/types.js";
import { countHumanTurns, findForkPoint, truncateMessages } from "./rewind.js";

function entry(lineIndex: number, parsed: Record<string, unknown>, entryType: SessionEntry["entryType"]): SessionEntry {
  return {
    lineIndex,
    rawLine: JSON.stringify(parsed),
    entryType,
    preview: "",
    uuid: parsed.uuid as string | undefined,
    parsed,
  };
}

const userEntry = (line: number, uuid: string, text: string) =>
  entry(line, { type: "user", uuid, message: { role: "user", content: [{ type: "text", text }] } }, "User");

const assistantEntry = (line: number, uuid: string, text: string) =>
  entry(line, { type: "assistant", uuid, message: { role: "assistant", content: [{ type: "text", text }] } }, "Assistant");

const toolResultEntry = (line: number, uuid: string) =>
  entry(line, {
    type: "user", uuid,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }] },
  }, "Progress");

// first → second → third, with an assistant reply and a tool_result carrier in between.
const transcript = () => [
  userEntry(0, "u1", "first"),
  assistantEntry(1, "a1", "sure"),
  toolResultEntry(2, "r1"),
  assistantEntry(3, "a2", "done"),
  userEntry(4, "u2", "second"),
  assistantEntry(5, "a3", "ok"),
  userEntry(6, "u3", "third"),
  assistantEntry(7, "a4", "yep"),
];

describe("findForkPoint", () => {
  it("forks at the entry right before the targeted turn, not the previous assistant message", () => {
    // Dropping "second" keeps everything through a2 — the last chain entry of the kept turn. The SDK
    // refuses a looser fork point, so "the previous assistant uuid" is the wrong answer here.
    expect(findForkPoint(transcript(), { userTurnsAfter: 1, text: "second" }))
      .toEqual({ ok: true, point: { uuid: "a2", targetUuid: "u2", lineIndex: 4, turnIndex: 1 } });
  });

  it("addresses the most recent turn as 0 turns after", () => {
    expect(findForkPoint(transcript(), { userTurnsAfter: 0, text: "third" }))
      .toEqual({ ok: true, point: { uuid: "a3", targetUuid: "u3", lineIndex: 6, turnIndex: 2 } });
  });

  it("returns a null fork point when nothing survives the cut", () => {
    expect(findForkPoint(transcript(), { userTurnsAfter: 2, text: "first" }))
      .toEqual({ ok: true, point: { uuid: null, targetUuid: "u1", lineIndex: 0, turnIndex: 0 } });
  });

  it("never counts a tool_result carrier as a user turn", () => {
    // r1 is a `type: "user"` line. Counting it would shift every target by one and cut the
    // conversation in the wrong place.
    const found = findForkPoint(transcript(), { userTurnsAfter: 1, text: "second" });
    expect(found).toEqual({ ok: true, point: { uuid: "a2", targetUuid: "u2", lineIndex: 4, turnIndex: 1 } });
  });

  it("never counts a subagent turn", () => {
    const withSidechain = [
      ...transcript(),
      entry(8, {
        type: "user", uuid: "s1", isSidechain: true,
        message: { role: "user", content: [{ type: "text", text: "subagent brief" }] },
      }, "User"),
    ];
    expect(findForkPoint(withSidechain, { userTurnsAfter: 0, text: "third" }))
      .toEqual({ ok: true, point: { uuid: "a3", targetUuid: "u3", lineIndex: 6, turnIndex: 2 } });
  });

  it("refuses when the text does not match what the browser is showing", () => {
    const found = findForkPoint(transcript(), { userTurnsAfter: 1, text: "something else" });
    expect(found.ok).toBe(false);
  });

  it("refuses a target past the start of the conversation", () => {
    const found = findForkPoint(transcript(), { userTurnsAfter: 9, text: "first" });
    expect(found.ok).toBe(false);
  });

  it("ignores leading and trailing whitespace when matching", () => {
    expect(findForkPoint(transcript(), { userTurnsAfter: 0, text: "  third\n" }).ok).toBe(true);
  });
});

describe("countHumanTurns", () => {
  it("counts only the turns a rewind can target", () => {
    // Three human turns among eight entries: the tool_result carrier and every assistant reply are
    // not turns, and counting them would file every workspace checkpoint under the wrong index.
    expect(countHumanTurns(transcript())).toBe(3);
  });

  it("is zero for a conversation with nothing in it", () => {
    expect(countHumanTurns([])).toBe(0);
  });

  it("agrees with the index findForkPoint reports, so capture and rewind address the same slot", () => {
    const found = findForkPoint(transcript(), { userTurnsAfter: 0, text: "third" });
    expect(found.ok && found.point.turnIndex).toBe(countHumanTurns(transcript()) - 1);
  });
});

describe("truncateMessages", () => {
  const messages = [
    { id: "1", role: "user" as const },
    { id: "2", role: "assistant" as const },
    { id: "3", role: "user" as const },
    { id: "4", role: "assistant" as const },
  ];

  it("keeps everything before the targeted turn", () => {
    expect(truncateMessages(messages, 0)?.map((m) => m.id)).toEqual(["1", "2"]);
  });

  it("empties the chat when the first turn is the target", () => {
    expect(truncateMessages(messages, 1)).toEqual([]);
  });

  it("returns null when the target does not exist", () => {
    expect(truncateMessages(messages, 5)).toBeNull();
  });
});
