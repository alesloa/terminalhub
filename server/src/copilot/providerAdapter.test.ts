import { describe, it, expect } from "vitest";
import {
  toAnthropicTools, toOpenAITools, toOpenAIMessages,
  createAnthropicAccumulator, createOpenAIAccumulator,
} from "./providerAdapter.js";
import type { ToolDef, CopilotMessage } from "./types.js";

const noteTool: ToolDef = {
  name: "note_add", description: "add a note", skillId: "core",
  input_schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
  async run() { return { ok: true, summary: "" }; },
};

describe("tool-shape conversion", () => {
  it("maps a ToolDef to the Anthropic tool shape", () => {
    expect(toAnthropicTools([noteTool])).toEqual([
      { name: "note_add", description: "add a note", input_schema: noteTool.input_schema },
    ]);
  });

  it("maps a ToolDef to the OpenAI function shape", () => {
    expect(toOpenAITools([noteTool])).toEqual([
      { type: "function", function: { name: "note_add", description: "add a note", parameters: noteTool.input_schema } },
    ]);
  });
});

describe("canonical -> OpenAI messages", () => {
  it("flattens text, tool_use and tool_result blocks into OpenAI roles", () => {
    const messages: CopilotMessage[] = [
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [
        { type: "text", text: "ok" },
        { type: "tool_use", id: "tu_1", name: "note_add", input: { title: "x" } },
      ] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: '{"ok":true}' }] },
    ];
    expect(toOpenAIMessages("SYS", messages)).toEqual([
      { role: "system", content: "SYS" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "ok", tool_calls: [
        { id: "tu_1", type: "function", function: { name: "note_add", arguments: '{"title":"x"}' } },
      ] },
      { role: "tool", tool_call_id: "tu_1", content: '{"ok":true}' },
    ]);
  });
});

describe("Anthropic stream accumulator", () => {
  it("accumulates streamed text then a tool_use into one turn", () => {
    const tokens: string[] = [];
    const acc = createAnthropicAccumulator((d) => tokens.push(d));
    acc.event("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
    acc.event("content_block_delta", { index: 0, delta: { type: "text_delta", text: "Hello" } });
    acc.event("content_block_delta", { index: 0, delta: { type: "text_delta", text: " there" } });
    acc.event("content_block_stop", { index: 0 });
    acc.event("content_block_start", { index: 1, content_block: { type: "tool_use", id: "tu_1", name: "note_add", input: {} } });
    acc.event("content_block_delta", { index: 1, delta: { type: "input_json_delta", partial_json: '{"title":' } });
    acc.event("content_block_delta", { index: 1, delta: { type: "input_json_delta", partial_json: '"hi"}' } });
    acc.event("content_block_stop", { index: 1 });
    acc.event("message_stop", {});

    const turn = acc.turn();
    expect(tokens).toEqual(["Hello", " there"]);
    expect(turn.text).toBe("Hello there");
    expect(turn.toolCalls).toEqual([{ id: "tu_1", name: "note_add", input: { title: "hi" } }]);
    expect(turn.message).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "Hello there" },
        { type: "tool_use", id: "tu_1", name: "note_add", input: { title: "hi" } },
      ],
    });
  });

  it("handles a text-only final answer (no tool calls)", () => {
    const acc = createAnthropicAccumulator(() => {});
    acc.event("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
    acc.event("content_block_delta", { index: 0, delta: { type: "text_delta", text: "Done." } });
    acc.event("content_block_stop", { index: 0 });
    const turn = acc.turn();
    expect(turn.text).toBe("Done.");
    expect(turn.toolCalls).toEqual([]);
  });
});

describe("OpenAI stream accumulator", () => {
  it("accumulates content + a tool_call whose arguments arrive in pieces", () => {
    const tokens: string[] = [];
    const acc = createOpenAIAccumulator((d) => tokens.push(d));
    acc.chunk({ content: "Hello" });
    acc.chunk({ content: " there" });
    acc.chunk({ tool_calls: [{ index: 0, id: "call_1", function: { name: "note_add", arguments: '{"title":' } }] });
    acc.chunk({ tool_calls: [{ index: 0, function: { arguments: '"hi"}' } }] });

    const turn = acc.turn();
    expect(tokens).toEqual(["Hello", " there"]);
    expect(turn.text).toBe("Hello there");
    expect(turn.toolCalls).toEqual([{ id: "call_1", name: "note_add", input: { title: "hi" } }]);
    expect(turn.message.content).toEqual([
      { type: "text", text: "Hello there" },
      { type: "tool_use", id: "call_1", name: "note_add", input: { title: "hi" } },
    ]);
  });
});
