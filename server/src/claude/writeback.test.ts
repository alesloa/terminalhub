import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { deleteEntries, replaceRangeWithSummary, expandCodexRangeForPairs } from "./writeback.js";
import { parseSessionEntries, invalidateCache } from "./jsonl.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "tr-writeback-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Write lines to a jsonl file, invalidate the parse cache (mtime can tie within a test). */
function writeJsonl(name: string, objs: Record<string, unknown>[]): string {
  const p = path.join(dir, name);
  writeFileSync(p, objs.map((o) => JSON.stringify(o)).join("\n") + "\n");
  invalidateCache(p);
  return p;
}

function readLines(p: string): Record<string, unknown>[] {
  return readFileSync(p, "utf-8").trim().split("\n").map((l) => JSON.parse(l));
}

describe("deleteEntries (Claude)", () => {
  it("removes the range and relinks survivors' parentUuid to the nearest live ancestor", async () => {
    // Chain: A(0) -> B(1) -> C(2) -> D(3). Delete B and C (lines 1..2). D must relink to A.
    const p = writeJsonl("claude.jsonl", [
      { type: "user", uuid: "A", parentUuid: null, message: { content: "a" } },
      { type: "assistant", uuid: "B", parentUuid: "A", message: { content: [{ type: "text", text: "b" }] } },
      { type: "user", uuid: "C", parentUuid: "B", message: { content: "c" } },
      { type: "assistant", uuid: "D", parentUuid: "C", message: { content: [{ type: "text", text: "d" }] } },
    ]);

    const res = await deleteEntries(p, "claude", [[1, 2]]);
    expect(res.removed).toBe(2);

    const lines = readLines(p);
    expect(lines.map((l) => l.uuid)).toEqual(["A", "D"]);
    expect(lines[1].parentUuid).toBe("A"); // D relinked past the deleted B/C
  });

  it("sets parentUuid to null when no live ancestor survives", async () => {
    const p = writeJsonl("claude2.jsonl", [
      { type: "user", uuid: "A", parentUuid: null, message: { content: "a" } },
      { type: "assistant", uuid: "B", parentUuid: "A", message: { content: [{ type: "text", text: "b" }] } },
    ]);
    // Delete A (line 0). B's parent A is gone with no ancestor -> null root.
    await deleteEntries(p, "claude", [[0, 0]]);
    const lines = readLines(p);
    expect(lines.map((l) => l.uuid)).toEqual(["B"]);
    expect(lines[0].parentUuid).toBe(null);
  });
});

describe("expandCodexRangeForPairs", () => {
  it("expands a range so a function_call / function_call_output pair is not split", async () => {
    const p = writeJsonl("codex-pairs.jsonl", [
      { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "go" }] } },
      { type: "response_item", payload: { type: "function_call", call_id: "c1", name: "Bash" } },
      { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "mid" }] } },
      { type: "response_item", payload: { type: "function_call_output", call_id: "c1", output: "done" } },
    ]);
    const entries = await parseSessionEntries(p, "codex");
    // Selecting only line 1 (function_call) must pull in line 3 (its output).
    const expanded = expandCodexRangeForPairs(entries, 1, 1);
    expect(expanded).toEqual({ firstLineIndex: 1, lastLineIndex: 3 });
  });
});

describe("deleteEntries (Codex)", () => {
  it("widens a delete range so a split call_id pair is removed together", async () => {
    const p = writeJsonl("codex-del.jsonl", [
      { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "go" }] } },
      { type: "response_item", payload: { type: "function_call", call_id: "c1", name: "Bash" } },
      { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "mid" }] } },
      { type: "response_item", payload: { type: "function_call_output", call_id: "c1", output: "done" } },
      { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "end" }] } },
    ]);
    // Ask to delete just the function_call (line 1). Expansion must also remove its output (line 3),
    // and everything between (line 2) — i.e. lines 1..3 removed, leaving lines 0 and 4.
    const res = await deleteEntries(p, "codex", [[1, 1]]);
    expect(res.removed).toBe(3);
    const lines = readLines(p);
    expect(lines).toHaveLength(2);
    expect((lines[0].payload as any).role).toBe("user");
    expect((lines[1].payload as any).content[0].text).toBe("end");
  });
});

describe("replaceRangeWithSummary (Claude)", () => {
  it("replaces the range with one summary entry and redirects children to it", async () => {
    const p = writeJsonl("claude-sum.jsonl", [
      { type: "user", uuid: "A", parentUuid: null, sessionId: "s", cwd: "/w", message: { content: "a" } },
      { type: "assistant", uuid: "B", parentUuid: "A", message: { content: [{ type: "text", text: "b" }] } },
      { type: "user", uuid: "C", parentUuid: "B", message: { content: "c" } },
      { type: "assistant", uuid: "D", parentUuid: "C", message: { content: [{ type: "text", text: "d" }] } },
    ]);
    // Summarize B..C (lines 1..2). Result: A, SUMMARY(parent A), D(parent SUMMARY).
    await replaceRangeWithSummary(p, "claude", 1, 2, "the gist");

    const lines = readLines(p);
    expect(lines).toHaveLength(3);
    expect(lines[0].uuid).toBe("A");
    const summary = lines[1] as any;
    expect(summary.type).toBe("assistant");
    expect(summary.parentUuid).toBe("A"); // wired to the last uuid before the range
    expect(summary.message.content[0].text).toContain("the gist");
    expect(summary.sessionId).toBe("s"); // inherited field
    expect(lines[2].uuid).toBe("D");
    expect(lines[2].parentUuid).toBe(summary.uuid); // child redirected to summary
  });
});

describe("replaceRangeWithSummary (Codex)", () => {
  it("inserts a response_item summary and respects call_id pair expansion", async () => {
    const p = writeJsonl("codex-sum.jsonl", [
      { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "go" }] } },
      { type: "response_item", payload: { type: "function_call", call_id: "c1", name: "Bash" } },
      { type: "response_item", payload: { type: "function_call_output", call_id: "c1", output: "done" } },
      { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "end" }] } },
    ]);
    // Summarize just line 1; expansion pulls in line 2 (the pair output) too.
    await replaceRangeWithSummary(p, "codex", 1, 1, "tool work");
    const lines = readLines(p);
    expect(lines).toHaveLength(3); // user, summary, end
    const summary = lines[1] as any;
    expect(summary.type).toBe("response_item");
    expect(summary.payload.role).toBe("assistant");
    expect(summary.payload.content[0].text).toContain("tool work");
    expect((lines[2].payload as any).content[0].text).toBe("end");
  });
});
