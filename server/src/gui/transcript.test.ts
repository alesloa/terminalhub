import { describe, expect, it } from "vitest";
import { createTranscript } from "./transcript.js";
import type { GuiEvent } from "./types.js";

// The transcript is what a reconnecting client is replayed from, so the property that matters is:
// folding the emitted events reproduces exactly what the original client rendered.

const start = (id: string, role: "user" | "assistant" = "assistant"): GuiEvent =>
  ({ type: "message.start", id, role, ts: 1000 });

const text = (messageId: string, id: string, value = ""): GuiEvent =>
  ({ type: "block.start", messageId, block: { kind: "text", id, text: value } });

const tool = (messageId: string, id: string, toolUseId: string, name = "Bash"): GuiEvent =>
  ({ type: "block.start", messageId, block: { kind: "tool", id, toolUseId, name, input: {}, status: "running" } });

describe("createTranscript", () => {
  it("assembles a streamed assistant message", () => {
    const t = createTranscript();
    t.apply(start("m1"));
    t.apply(text("m1", "m1:0"));
    t.apply({ type: "block.delta", messageId: "m1", blockId: "m1:0", text: "Hel" });
    t.apply({ type: "block.delta", messageId: "m1", blockId: "m1:0", text: "lo" });
    t.apply({ type: "block.end", messageId: "m1", blockId: "m1:0" });
    t.apply({ type: "message.end", id: "m1" });

    expect(t.messages()).toEqual([
      { id: "m1", role: "assistant", ts: 1000, blocks: [{ kind: "text", id: "m1:0", text: "Hello" }] },
    ]);
  });

  it("keeps user turns and assistant turns in emission order", () => {
    const t = createTranscript();
    t.apply(start("u1", "user"));
    t.apply(text("u1", "u1:0", "fix the build"));
    t.apply({ type: "message.end", id: "u1" });
    t.apply(start("m1"));
    t.apply(text("m1", "m1:0", "on it"));

    expect(t.messages().map((m) => [m.role, m.blocks[0]])).toEqual([
      ["user", { kind: "text", id: "u1:0", text: "fix the build" }],
      ["assistant", { kind: "text", id: "m1:0", text: "on it" }],
    ]);
  });

  it("includes the message still in flight", () => {
    const t = createTranscript();
    t.apply(start("m1"));
    t.apply(text("m1", "m1:0", "part"));
    // No message.end — a client reconnecting mid-turn must still see what's been said.
    expect(t.messages()[0].blocks).toEqual([{ kind: "text", id: "m1:0", text: "part" }]);
  });

  it("fills a tool block's input from a later block.input", () => {
    const t = createTranscript();
    t.apply(start("m1"));
    t.apply(tool("m1", "m1:0", "toolu_1"));
    t.apply({ type: "block.input", messageId: "m1", blockId: "m1:0", input: { command: "ls" } });

    expect(t.messages()[0].blocks[0]).toMatchObject({ kind: "tool", input: { command: "ls" } });
  });

  it("attaches a tool result that arrives after its message closed", () => {
    const t = createTranscript();
    t.apply(start("m1"));
    t.apply(tool("m1", "m1:0", "toolu_1"));
    t.apply({ type: "message.end", id: "m1" });
    t.apply(start("m2"));
    t.apply({ type: "tool.result", toolUseId: "toolu_1", status: "ok", result: "a.ts\nb.ts" });

    expect(t.messages()[0].blocks[0]).toMatchObject({ status: "ok", result: "a.ts\nb.ts" });
  });

  it("records an errored tool result", () => {
    const t = createTranscript();
    t.apply(start("m1"));
    t.apply(tool("m1", "m1:0", "toolu_1"));
    t.apply({ type: "tool.result", toolUseId: "toolu_1", status: "error", result: "boom" });

    expect(t.messages()[0].blocks[0]).toMatchObject({ status: "error", result: "boom" });
  });

  it("keeps thinking blocks", () => {
    const t = createTranscript();
    t.apply(start("m1"));
    t.apply({ type: "block.start", messageId: "m1", block: { kind: "thinking", id: "m1:0", text: "" } });
    t.apply({ type: "block.delta", messageId: "m1", blockId: "m1:0", text: "hmm" });

    expect(t.messages()[0].blocks[0]).toEqual({ kind: "thinking", id: "m1:0", text: "hmm" });
  });

  it("ignores liveness events entirely", () => {
    const t = createTranscript();
    t.apply({ type: "state", state: "running" });
    t.apply({ type: "turn.start", turnId: "t1" });
    t.apply({ type: "turn.end", turnId: "t1", status: "completed" });
    t.apply({ type: "session", sessionId: "s1" });
    t.apply({ type: "error", message: "nope" });

    expect(t.messages()).toEqual([]);
  });

  it("ignores blocks and deltas for messages it never saw start", () => {
    const t = createTranscript();
    t.apply(text("ghost", "ghost:0", "x"));
    t.apply({ type: "block.delta", messageId: "ghost", blockId: "ghost:0", text: "y" });
    t.apply({ type: "tool.result", toolUseId: "nope", status: "ok", result: "" });

    expect(t.messages()).toEqual([]);
  });

  it("ignores a duplicate message.start or block.start", () => {
    const t = createTranscript();
    t.apply(start("m1"));
    t.apply(start("m1"));
    t.apply(text("m1", "m1:0", "a"));
    t.apply(text("m1", "m1:0", "b"));

    expect(t.messages()).toHaveLength(1);
    expect(t.messages()[0].blocks).toEqual([{ kind: "text", id: "m1:0", text: "a" }]);
  });

  it("hands out snapshots that later deltas cannot mutate", () => {
    const t = createTranscript();
    t.apply(start("m1"));
    t.apply(text("m1", "m1:0", "before"));
    const snapshot = t.messages();
    t.apply({ type: "block.delta", messageId: "m1", blockId: "m1:0", text: " after" });

    expect(snapshot[0].blocks[0]).toEqual({ kind: "text", id: "m1:0", text: "before" });
    expect(t.messages()[0].blocks[0]).toEqual({ kind: "text", id: "m1:0", text: "before after" });
  });

  describe("history.reset", () => {
    it("replaces the conversation with the kept prefix", () => {
      const t = createTranscript();
      t.apply({ type: "message.start", id: "m1", role: "user", ts: 1 });
      t.apply({ type: "block.start", messageId: "m1", block: { kind: "text", id: "b1", text: "first" } });
      t.apply({ type: "message.start", id: "m2", role: "assistant", ts: 2 });
      t.apply({ type: "block.start", messageId: "m2", block: { kind: "text", id: "b2", text: "reply" } });

      t.apply({ type: "history.reset", messages: [
        { id: "m1", role: "user", ts: 1, blocks: [{ kind: "text", id: "b1", text: "first" }] },
      ] });

      expect(t.messages()).toEqual([
        { id: "m1", role: "user", ts: 1, blocks: [{ kind: "text", id: "b1", text: "first" }] },
      ]);
    });

    it("drops the block index so a straggling delta cannot write into a dropped message", () => {
      const t = createTranscript();
      t.apply({ type: "message.start", id: "m1", role: "assistant", ts: 1 });
      t.apply({ type: "block.start", messageId: "m1", block: { kind: "text", id: "b1", text: "" } });
      t.apply({ type: "history.reset", messages: [] });
      t.apply({ type: "block.delta", messageId: "m1", blockId: "b1", text: "late" });

      expect(t.messages()).toEqual([]);
    });

    it("keeps tool results attachable in the kept prefix", () => {
      const t = createTranscript();
      t.apply({ type: "history.reset", messages: [
        {
          id: "m1", role: "assistant", ts: 1,
          blocks: [{ kind: "tool", id: "b1", toolUseId: "toolu_1", name: "Bash", input: {}, status: "running" }],
        },
      ] });
      t.apply({ type: "tool.result", toolUseId: "toolu_1", status: "ok", result: "done" });

      expect(t.messages()[0].blocks[0]).toMatchObject({ status: "ok", result: "done" });
    });
  });
});
