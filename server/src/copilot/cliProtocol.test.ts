import { describe, it, expect } from "vitest";
import { parseCliEnvelope, buildCliPrompt, renderToolCatalog, renderTranscript } from "./cliProtocol.js";
import type { ToolDef, CopilotMessage } from "./types.js";

const tool = (name: string, description: string): ToolDef => ({
  name, description, skillId: "core",
  input_schema: { type: "object", properties: { q: { type: "string" } } },
  run: async () => ({ ok: true, summary: "" }),
});

describe("parseCliEnvelope", () => {
  it("parses a clean JSON envelope with reply + tool calls", () => {
    const raw = JSON.stringify({ reply: "On it.", tool_calls: [{ name: "add_card", input: { label: "Ship" } }] });
    const r = parseCliEnvelope(raw);
    expect(r.reply).toBe("On it.");
    expect(r.toolCalls).toEqual([{ name: "add_card", input: { label: "Ship" } }]);
  });

  it("extracts the envelope from a ```json code fence", () => {
    const raw = "Sure!\n```json\n{ \"reply\": \"hi\", \"tool_calls\": [] }\n```\n";
    expect(parseCliEnvelope(raw)).toEqual({ reply: "hi", toolCalls: [] });
  });

  it("extracts the first balanced object from surrounding prose", () => {
    const raw = 'Here you go: {"reply":"done","tool_calls":[]} — anything else?';
    expect(parseCliEnvelope(raw)).toEqual({ reply: "done", toolCalls: [] });
  });

  it("drops malformed tool calls (no name) but keeps the valid ones", () => {
    const raw = JSON.stringify({ reply: "", tool_calls: [{ input: {} }, { name: "ok", input: { a: 1 } }] });
    expect(parseCliEnvelope(raw).toolCalls).toEqual([{ name: "ok", input: { a: 1 } }]);
  });

  it("defaults a missing input to {}", () => {
    const raw = JSON.stringify({ reply: "", tool_calls: [{ name: "noargs" }] });
    expect(parseCliEnvelope(raw).toolCalls).toEqual([{ name: "noargs", input: {} }]);
  });

  it("treats a reply-only envelope (no tool_calls key) as a final answer", () => {
    expect(parseCliEnvelope('{"reply":"all set"}')).toEqual({ reply: "all set", toolCalls: [] });
  });

  it("falls back to the whole text as the reply when there is no usable envelope", () => {
    const raw = "I cannot find a JSON object here, just chatting.";
    expect(parseCliEnvelope(raw)).toEqual({ reply: raw, toolCalls: [] });
  });

  it("falls back to plain text on invalid JSON inside a fence", () => {
    const raw = "```json\n{ not valid json ]\n```";
    expect(parseCliEnvelope(raw).toolCalls).toEqual([]);
    expect(parseCliEnvelope(raw).reply).toContain("not valid json");
  });
});

describe("renderToolCatalog", () => {
  it("lists each tool's name, description, and args schema", () => {
    const out = renderToolCatalog([tool("add_card", "Add a card to the canvas")]);
    expect(out).toContain("add_card");
    expect(out).toContain("Add a card to the canvas");
    expect(out).toContain('"type":"object"');
  });

  it("says so when there are no tools", () => {
    expect(renderToolCatalog([]).toLowerCase()).toContain("no tools");
  });
});

describe("renderTranscript", () => {
  it("renders user/assistant text, tool calls, and tool results as readable lines", () => {
    const messages: CopilotMessage[] = [
      { role: "user", content: [{ type: "text", text: "add a card" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "c1", name: "add_card", input: { label: "X" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "Added card X" }] },
      { role: "assistant", content: [{ type: "text", text: "Done." }] },
    ];
    const out = renderTranscript(messages);
    expect(out).toContain("User: add a card");
    expect(out).toContain("add_card");
    expect(out).toContain("Added card X");
    expect(out).toContain("Assistant: Done.");
  });
});

describe("buildCliPrompt", () => {
  it("includes the system prompt, the tool catalog, the transcript, and the JSON protocol", () => {
    const messages: CopilotMessage[] = [{ role: "user", content: [{ type: "text", text: "hello" }] }];
    const prompt = buildCliPrompt("SYSTEM RULES", messages, [tool("ping", "ping the thing")]);
    expect(prompt).toContain("SYSTEM RULES");
    expect(prompt).toContain("ping");
    expect(prompt).toContain("User: hello");
    expect(prompt).toContain("tool_calls"); // the protocol envelope is described
  });
});
