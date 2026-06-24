import { describe, it, expect } from "vitest";
import { classifyEntry, extractTextContent, extractPreview } from "./jsonl.js";

describe("classifyEntry (claude)", () => {
  it("classifies a plain user turn as User", () => {
    expect(classifyEntry({ type: "user", message: { content: "hello" } }, "claude")).toBe("User");
  });
  it("classifies a user turn carrying a system-reminder as System", () => {
    expect(classifyEntry({ type: "user", message: { content: "<system-reminder>x</system-reminder>" } }, "claude")).toBe("System");
  });
  it("classifies a user turn with a tool_result block as Progress", () => {
    expect(classifyEntry({ type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } }, "claude")).toBe("Progress");
  });
  it("classifies an assistant tool-only turn as Progress, text turn as Assistant", () => {
    expect(classifyEntry({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash" }] } }, "claude")).toBe("Progress");
    expect(classifyEntry({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } }, "claude")).toBe("Assistant");
  });
  it("classifies system + attachment as System", () => {
    expect(classifyEntry({ type: "system" }, "claude")).toBe("System");
    expect(classifyEntry({ type: "attachment" }, "claude")).toBe("System");
  });
});

describe("classifyEntry (codex)", () => {
  it("maps response_item roles", () => {
    expect(classifyEntry({ type: "response_item", payload: { role: "user" } }, "codex")).toBe("User");
    expect(classifyEntry({ type: "response_item", payload: { role: "assistant" } }, "codex")).toBe("Assistant");
    expect(classifyEntry({ type: "session_meta" }, "codex")).toBe("System");
  });
});

describe("extractTextContent", () => {
  it("reads a string", () => expect(extractTextContent("hi")).toBe("hi"));
  it("joins text/input_text/output_text blocks", () => {
    expect(extractTextContent([{ type: "text", text: "a" }, { type: "output_text", output_text: "b" }])).toBe("a\nb");
  });
  it("ignores non-text blocks", () => {
    expect(extractTextContent([{ type: "tool_use", name: "x" }, { type: "text", text: "keep" }])).toBe("keep");
  });
});

describe("extractPreview", () => {
  it("collapses whitespace and truncates to 200 chars", () => {
    const long = "x".repeat(300);
    const preview = extractPreview({ type: "user", message: { content: long } }, "User", "claude");
    expect(preview.length).toBe(200);
    expect(preview.endsWith("...")).toBe(true);
  });
  it("falls back to a [type] tag when no text", () => {
    expect(extractPreview({ type: "progress" }, "Progress", "claude")).toBe("[progress]");
  });
});
