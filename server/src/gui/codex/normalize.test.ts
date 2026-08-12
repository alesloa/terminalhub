import { describe, it, expect } from "vitest";
import { CODEX_NOTIFICATION, type CodexItem, type CodexTurn } from "../../codex/protocol.js";
import type { GuiEvent } from "../types.js";
import {
  blockForItem, createCodexNormalizer, historyFromTurns, resultTextFor, turnStatusOf,
} from "./normalize.js";

const N = CODEX_NOTIFICATION;

/** Feed a whole notification script through one normalizer and collect everything it emitted. */
function run(frames: [string, unknown][]): GuiEvent[] {
  const n = createCodexNormalizer();
  return frames.flatMap(([method, params]) => n.push(method, params));
}

const started = (item: CodexItem) => [N.itemStarted, { item, threadId: "t", turnId: "u" }] as [string, unknown];
const completed = (item: CodexItem) => [N.itemCompleted, { item, threadId: "t", turnId: "u" }] as [string, unknown];
const delta = (method: string, itemId: string, text: string, extra: object = {}) =>
  [method, { itemId, delta: text, threadId: "t", turnId: "u", ...extra }] as [string, unknown];

const textBlocks = (events: GuiEvent[]) =>
  events.filter((e) => e.type === "block.delta").map((e) => (e as { text: string }).text).join("");

describe("blockForItem", () => {
  it("renders an agent message as text and reasoning as thinking", () => {
    expect(blockForItem({ type: "agentMessage", id: "i1", text: "hi" }, "b0"))
      .toEqual({ kind: "text", id: "b0", text: "hi" });
    expect(blockForItem({ type: "reasoning", id: "i2", content: ["long"], summary: ["short"] }, "b1"))
      .toEqual({ kind: "thinking", id: "b1", text: "short" });
  });

  it("falls back to full reasoning content when no summary was published", () => {
    const block = blockForItem({ type: "reasoning", id: "i", content: ["a", "b"], summary: [] }, "b");
    expect(block).toEqual({ kind: "thinking", id: "b", text: "a\n\nb" });
  });

  it("uses the item id as the tool-use id, so results can join back onto the card", () => {
    const block = blockForItem(
      { type: "commandExecution", id: "cmd_7", command: "ls", cwd: "/w", status: "inProgress" },
      "b0",
    );
    expect(block).toMatchObject({ kind: "tool", toolUseId: "cmd_7", name: "Bash", status: "running" });
  });

  it("names a patch after its first file and carries every diff for the renderer", () => {
    const changes = [
      { path: "/w/a.ts", kind: "update", diff: "@@\n-a\n+b" },
      { path: "/w/b.ts", kind: "add", diff: "@@\n+new" },
    ];
    const block = blockForItem({ type: "fileChange", id: "p1", changes, status: "completed" }, "b0");
    expect(block).toMatchObject({
      kind: "tool", name: "ApplyPatch", status: "ok",
      input: { file_path: "/w/a.ts +1 more", changes },
    });
  });

  it("declines count as a settled error, not a missing result", () => {
    const block = blockForItem({ type: "fileChange", id: "p", changes: [], status: "declined" }, "b");
    expect(block).toMatchObject({ status: "error" });
  });

  it("ignores the user's own message and anything a newer CLI adds", () => {
    expect(blockForItem({ type: "userMessage", id: "u", content: [{ type: "text", text: "hi" }] }, "b")).toBeNull();
    expect(blockForItem({ type: "somethingNew", id: "x" }, "b")).toBeNull();
  });
});

describe("resultTextFor", () => {
  it("appends the exit code of a failed command, which the output often omits", () => {
    const item: CodexItem = {
      type: "commandExecution", id: "c", command: "false",
      aggregatedOutput: "boom", exitCode: 1, status: "failed",
    };
    expect(resultTextFor(item)).toBe("boom\nexit 1");
  });

  it("leaves a successful command's output alone", () => {
    const item: CodexItem = {
      type: "commandExecution", id: "c", command: "ls", aggregatedOutput: "a\nb", exitCode: 0, status: "completed",
    };
    expect(resultTextFor(item)).toBe("a\nb");
  });

  it("lists what a patch touched", () => {
    const item: CodexItem = {
      type: "fileChange", id: "p", status: "completed",
      changes: [{ path: "a.ts", kind: "update", diff: "" }, { path: "b.ts", kind: "add", diff: "" }],
    };
    expect(resultTextFor(item)).toBe("update a.ts\nadd b.ts");
  });

  it("prefers a tool's error message over its payload", () => {
    const item: CodexItem = {
      type: "mcpToolCall", id: "m", server: "s", tool: "t", status: "failed", error: { message: "nope" },
    };
    expect(resultTextFor(item)).toBe("nope");
  });
});

describe("turnStatusOf", () => {
  it("maps codex turn outcomes onto the chat's three", () => {
    expect(turnStatusOf("completed")).toBe("completed");
    expect(turnStatusOf("interrupted")).toBe("interrupted");
    expect(turnStatusOf("failed")).toBe("failed");
    // A turn still in flight has not failed — the caller only asks once it has ended.
    expect(turnStatusOf("inProgress")).toBe("completed");
  });
});

describe("historyFromTurns", () => {
  const turn = (id: string, items: CodexItem[]): CodexTurn => ({ id, items, status: "completed" });

  it("rebuilds a conversation as user turns followed by one assistant bubble each", () => {
    const messages = historyFromTurns([
      turn("t1", [
        { type: "userMessage", id: "u1", content: [{ type: "text", text: "hello" }] },
        { type: "reasoning", id: "r1", content: [], summary: ["thinking"] },
        { type: "agentMessage", id: "a1", text: "hi back" },
      ]),
    ]);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(messages[0].blocks).toEqual([{ kind: "text", id: expect.any(String), text: "hello" }]);
    expect(messages[1].blocks.map((b) => b.kind)).toEqual(["thinking", "text"]);
  });

  it("attaches results to replayed tool cards", () => {
    const [assistant] = historyFromTurns([
      turn("t1", [{
        type: "commandExecution", id: "c1", command: "ls",
        aggregatedOutput: "a.ts", exitCode: 0, status: "completed",
      }]),
    ]);
    expect(assistant.blocks[0]).toMatchObject({ kind: "tool", name: "Bash", status: "ok", result: "a.ts" });
  });

  it("starts a fresh assistant bubble after every user message in the same turn", () => {
    const messages = historyFromTurns([
      turn("t1", [
        { type: "userMessage", id: "u1", content: [{ type: "text", text: "one" }] },
        { type: "agentMessage", id: "a1", text: "first" },
        // Steering mid-turn puts a second human message inside the same turn.
        { type: "userMessage", id: "u2", content: [{ type: "text", text: "two" }] },
        { type: "agentMessage", id: "a2", text: "second" },
      ]),
    ]);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("drops turns and blocks that would render as nothing", () => {
    expect(historyFromTurns([turn("t1", [{ type: "agentMessage", id: "a", text: "" }])])).toEqual([]);
    expect(historyFromTurns([turn("t2", [{ type: "unknownThing", id: "x" }])])).toEqual([]);
  });

  it("gives every message a distinct id", () => {
    const messages = historyFromTurns([
      turn("t1", [
        { type: "userMessage", id: "u1", content: [{ type: "text", text: "a" }] },
        { type: "agentMessage", id: "a1", text: "b" },
      ]),
      turn("t2", [
        { type: "userMessage", id: "u2", content: [{ type: "text", text: "c" }] },
        { type: "agentMessage", id: "a2", text: "d" },
      ]),
    ]);
    expect(new Set(messages.map((m) => m.id)).size).toBe(messages.length);
  });
});

describe("createCodexNormalizer", () => {
  it("opens one assistant message per turn and streams text into it", () => {
    const events = run([
      started({ type: "agentMessage", id: "a1", text: "" }),
      delta(N.agentMessageDelta, "a1", "Hel"),
      delta(N.agentMessageDelta, "a1", "lo"),
      completed({ type: "agentMessage", id: "a1", text: "Hello" }),
    ]);
    expect(events.filter((e) => e.type === "message.start")).toHaveLength(1);
    expect(textBlocks(events)).toBe("Hello");
  });

  it("does not re-print streamed text when the completed snapshot arrives", () => {
    const events = run([
      started({ type: "agentMessage", id: "a1", text: "" }),
      delta(N.agentMessageDelta, "a1", "once"),
      completed({ type: "agentMessage", id: "a1", text: "once" }),
    ]);
    expect(textBlocks(events)).toBe("once");
  });

  it("prints the completed text for an item that never streamed", () => {
    const events = run([
      started({ type: "agentMessage", id: "a1", text: "" }),
      completed({ type: "agentMessage", id: "a1", text: "all at once" }),
    ]);
    expect(textBlocks(events)).toBe("all at once");
  });

  it("draws an item that completes without ever starting", () => {
    const events = run([completed({ type: "agentMessage", id: "a1", text: "fast" })]);
    expect(events.some((e) => e.type === "block.start")).toBe(true);
    expect(textBlocks(events)).toBe("fast");
  });

  it("separates reasoning summary parts into paragraphs", () => {
    const events = run([
      started({ type: "reasoning", id: "r1", content: [], summary: [] }),
      delta(N.reasoningSummaryTextDelta, "r1", "first", { summaryIndex: 0 }),
      delta(N.reasoningSummaryTextDelta, "r1", "second", { summaryIndex: 1 }),
    ]);
    expect(textBlocks(events)).toBe("first\n\nsecond");
  });

  it("spins a tool card while it runs and settles it on completion", () => {
    const events = run([
      started({ type: "commandExecution", id: "c1", command: "ls", status: "inProgress" }),
      completed({
        type: "commandExecution", id: "c1", command: "ls", cwd: "/w",
        aggregatedOutput: "a.ts", exitCode: 0, status: "completed",
      }),
    ]);
    const start = events.find((e) => e.type === "block.start") as { block: { status: string } };
    expect(start.block.status).toBe("running");
    // The cwd only shows up on completion, so the input has to be re-sent.
    expect(events.find((e) => e.type === "block.input")).toMatchObject({ input: { cwd: "/w" } });
    expect(events.find((e) => e.type === "tool.result"))
      .toMatchObject({ toolUseId: "c1", status: "ok", result: "a.ts" });
  });

  it("does not stream command output into the card — the aggregate lands on completion", () => {
    const events = run([
      started({ type: "commandExecution", id: "c1", command: "ls", status: "inProgress" }),
      delta(N.commandOutputDelta, "c1", "partial"),
    ]);
    expect(events.some((e) => e.type === "block.delta")).toBe(false);
  });

  it("settles cards still spinning when the run ends under them", () => {
    const n = createCodexNormalizer();
    n.push(...(started({ type: "commandExecution", id: "c1", command: "sleep 999", status: "inProgress" }) as [string, unknown]));
    expect(n.settleOpenTools("aborted")).toEqual([
      { type: "tool.result", toolUseId: "c1", status: "aborted", result: "" },
    ]);
    // Already settled — a second sweep has nothing left to close.
    expect(n.settleOpenTools("aborted")).toEqual([]);
  });

  it("leaves a completed card alone when the run ends afterwards", () => {
    const n = createCodexNormalizer();
    const item: CodexItem = { type: "commandExecution", id: "c1", command: "ls", exitCode: 0, status: "completed" };
    n.push(...(started(item) as [string, unknown]));
    n.push(...(completed(item) as [string, unknown]));
    expect(n.settleOpenTools("aborted")).toEqual([]);
  });

  it("closes the message and starts a new one for the next turn", () => {
    const n = createCodexNormalizer();
    n.push(...(started({ type: "agentMessage", id: "a1", text: "one" }) as [string, unknown]));
    const first = n.closeMessage();
    expect(first).toEqual([{ type: "message.end", id: expect.any(String) }]);
    const second = n.push(...(started({ type: "agentMessage", id: "a2", text: "two" }) as [string, unknown]));
    const opened = second.find((e) => e.type === "message.start") as { id: string };
    expect(opened.id).not.toBe((first[0] as { id: string }).id);
    expect(n.closeMessage()).toEqual([{ type: "message.end", id: opened.id }]);
    // Nothing left open — closing again is a no-op rather than a second end for the same message.
    expect(n.closeMessage()).toEqual([]);
  });

  it("never echoes the user's own message — the composer already did", () => {
    const events = run([
      started({ type: "userMessage", id: "u1", content: [{ type: "text", text: "hi" }] }),
      completed({ type: "userMessage", id: "u1", content: [{ type: "text", text: "hi" }] }),
    ]);
    expect(events).toEqual([]);
  });

  it("ignores noise and malformed frames instead of throwing", () => {
    const n = createCodexNormalizer();
    expect(n.push("mcpServer/startupStatus/updated", { anything: true })).toEqual([]);
    expect(n.push(N.itemStarted, null)).toEqual([]);
    expect(n.push(N.itemStarted, { item: {} })).toEqual([]);
    expect(n.push(N.agentMessageDelta, { itemId: "nope", delta: "x" })).toEqual([]);
  });
});
