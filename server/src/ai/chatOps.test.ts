import { describe, it, expect } from "vitest";
import { parseChatReply, buildManifest } from "./chatOps.js";

describe("parseChatReply", () => {
  it("parses a clean JSON envelope into reply + ops", () => {
    const raw = JSON.stringify({
      reply: "Added a validate step.",
      ops: [{ op: "add", tempId: "t1", kind: "action", label: "Validate" }],
    });
    const r = parseChatReply(raw);
    expect(r.reply).toBe("Added a validate step.");
    expect(r.ops).toEqual([{ op: "add", tempId: "t1", kind: "action", label: "Validate" }]);
  });

  it("extracts the envelope from a ```json fenced block", () => {
    const raw = "Here you go:\n```json\n" + JSON.stringify({ reply: "ok", ops: [{ op: "delete", id: "n_1" }] }) + "\n```";
    const r = parseChatReply(raw);
    expect(r.reply).toBe("ok");
    expect(r.ops).toEqual([{ op: "delete", id: "n_1" }]);
  });

  it("extracts a balanced object even with prose before and after it", () => {
    const raw = 'Sure! ' + JSON.stringify({ reply: "wired up", ops: [{ op: "connect", from: "start", to: "t1" }] }) + ' Done.';
    const r = parseChatReply(raw);
    expect(r.reply).toBe("wired up");
    expect(r.ops).toEqual([{ op: "connect", from: "start", to: "t1" }]);
  });

  it("handles braces inside string values without truncating", () => {
    const raw = JSON.stringify({ reply: "use {curly} braces { like this", ops: [] });
    const r = parseChatReply(raw);
    expect(r.reply).toBe("use {curly} braces { like this");
    expect(r.ops).toEqual([]);
  });

  it("treats plain prose (no JSON) as the reply with no ops", () => {
    const r = parseChatReply("What are you trying to build? Tell me the goal first.");
    expect(r.reply).toBe("What are you trying to build? Tell me the goal first.");
    expect(r.ops).toEqual([]);
  });

  it("falls back to the raw text when the JSON is malformed", () => {
    const r = parseChatReply('{ "reply": "oops", ops: [broken] }');
    expect(r.reply).toContain("oops"); // raw text returned
    expect(r.ops).toEqual([]);
  });

  it("drops invalid ops but keeps the valid ones", () => {
    const raw = JSON.stringify({
      reply: "partial",
      ops: [
        { op: "add", tempId: "t1", kind: "action", label: "Good" },
        { op: "add", tempId: "t2", kind: "start" }, // start is not addable
        { op: "add", kind: "action" }, // missing tempId
        { op: "frobnicate", id: "x" }, // unknown op
        { op: "connect", from: "a", to: "b", branch: "yes" },
      ],
    });
    const r = parseChatReply(raw);
    expect(r.ops).toEqual([
      { op: "add", tempId: "t1", kind: "action", label: "Good" },
      { op: "connect", from: "a", to: "b", branch: "yes" },
    ]);
  });

  it("accepts every op kind in the vocabulary", () => {
    const ops = [
      { op: "add", tempId: "t1", kind: "switch", label: "Route", cases: ["A", "B"] },
      { op: "update", id: "n_1", label: "Renamed", kind: "loop" },
      { op: "delete", id: "n_2" },
      { op: "connect", from: "n_1", to: "t1", branch: "body" },
      { op: "disconnect", from: "n_1", to: "n_3" },
    ];
    const r = parseChatReply(JSON.stringify({ reply: "x", ops }));
    expect(r.ops).toEqual(ops);
  });
});

describe("buildManifest", () => {
  const graph = {
    nodes: [
      { id: "start", type: "start", data: { label: "Start" } },
      { id: "n_a", type: "action", data: { label: "Fetch data", description: "from the API" } },
      { id: "n_b", type: "condition", data: { label: "Valid?" } },
      { id: "n_s", type: "switch", data: { label: "Route", cases: ["fast", "slow"] } },
    ],
    edges: [
      { source: "start", target: "n_a", sourceHandle: null },
      { source: "n_a", target: "n_b", sourceHandle: null },
      { source: "n_b", target: "n_s", sourceHandle: "yes" },
    ],
  };

  it("lists every node with its id, kind and label", () => {
    const m = buildManifest(graph);
    expect(m).toContain("n_a");
    expect(m).toContain("[action]");
    expect(m).toContain("Fetch data");
    expect(m).toContain("from the API");
  });

  it("shows switch cases with their handle ids", () => {
    const m = buildManifest(graph);
    expect(m).toContain('c0="fast"');
    expect(m).toContain('c1="slow"');
    expect(m).toContain("else");
  });

  it("renders wires, including the branch handle on a fork", () => {
    const m = buildManifest(graph);
    expect(m).toContain("start"); // a wire mentions the source
    expect(m).toMatch(/n_b\s*--yes-->\s*n_s/);
  });

  it("marks the user's selected nodes", () => {
    const m = buildManifest(graph, ["n_b"]);
    const line = m.split("\n").find(l => l.startsWith("- n_b "));
    expect(line).toContain("SELECTED");
  });

  it("spells out what the selection means so the model resolves 'this'/'here' to it", () => {
    const m = buildManifest(graph, ["n_b"]);
    // The callout must name the selected id + label and tie deictic words to it.
    expect(m).toMatch(/select/i);
    expect(m).toContain("n_b");
    expect(m).toContain("Valid?");
    expect(m.toLowerCase()).toContain('"this"');
    expect(m.toLowerCase()).toContain('"here"');
  });

  it("names every selected card when more than one is highlighted", () => {
    const m = buildManifest(graph, ["n_a", "n_s"]);
    const callout = m.split("\n").find(l => /currently has/i.test(l)) ?? "";
    expect(callout).toContain("n_a");
    expect(callout).toContain("n_s");
  });

  it("adds no selection callout when nothing is selected", () => {
    const m = buildManifest(graph);
    expect(m).not.toMatch(/currently has/i);
  });

  it("reports an empty canvas plainly", () => {
    expect(buildManifest({ nodes: [], edges: [] })).toMatch(/empty/i);
  });
});
