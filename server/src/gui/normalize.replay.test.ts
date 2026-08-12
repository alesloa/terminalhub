import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createNormalizer } from "./normalize.js";
import { createTranscript } from "./transcript.js";
import type { GuiBlock } from "./types.js";

// Recorded output of a real `claude` run (one Bash tool call, then a one-word reply) captured
// straight off the Agent SDK with includePartialMessages on. Hand-written fixtures kept agreeing
// with hand-written assumptions; this doesn't. In particular it pins the frame order that broke the
// UI: the `assistant` snapshot arrives BEFORE `content_block_stop`, so anything that treats the
// snapshot as the end of a message re-opens a bubble and draws every tool call twice.

const frames = JSON.parse(
  readFileSync(new URL("./__fixtures__/tool-turn.frames.json", import.meta.url), "utf8"),
) as Parameters<ReturnType<typeof createNormalizer>["push"]>[0][];

function render() {
  const normalizer = createNormalizer();
  const transcript = createTranscript();
  for (const frame of frames) for (const event of normalizer.push(frame)) transcript.apply(event);
  return transcript.messages();
}

describe("normalize — replay of real SDK frames", () => {
  it("draws one card per tool call, not one per frame view of it", () => {
    const tools = render().flatMap((m) => m.blocks).filter((b): b is Extract<GuiBlock, { kind: "tool" }> => b.kind === "tool");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ name: "Bash", status: "ok", input: { command: "echo hi" } });
  });

  it("resolves the tool card instead of leaving it spinning", () => {
    const tool = render().flatMap((m) => m.blocks).find((b) => b.kind === "tool");
    expect(tool).toMatchObject({ status: "ok" });
  });

  it("keeps the reply as its own message after the tool turn", () => {
    expect(render().map((m) => m.blocks.map((b) => b.kind))).toEqual([["tool"], ["text"]]);
    expect(render()[1].blocks[0]).toMatchObject({ kind: "text", text: "done" });
  });

  it("is idempotent across a re-run — no leaked state between messages", () => {
    // Frozen clock: a message is stamped with Date.now() as it opens, so two renders that straddle a
    // millisecond differ on `ts` alone — a real difference, but not the one this test is about.
    vi.useFakeTimers();
    try {
      expect(render()).toEqual(render());
    } finally {
      vi.useRealTimers();
    }
  });
});
