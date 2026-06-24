import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { computeSessionState, readTail, scanMarkerFiles, MARKER_DIR, MARKER_PREFIX, STALE_THRESHOLD_MS } from "./activity.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "tr-activity-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function writeJsonl(lines: object[]): string {
  const file = path.join(dir, "session.jsonl");
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return file;
}

const now = () => new Date().toISOString();
const stale = () => new Date(Date.now() - STALE_THRESHOLD_MS - 5_000).toISOString();

describe("computeSessionState", () => {
  it("idle for an empty / missing file", async () => {
    expect(await computeSessionState(path.join(dir, "nope.jsonl"))).toBe("idle");
    expect(await computeSessionState(writeJsonl([]))).toBe("idle");
  });

  it("active when the last real entry is a fresh user prompt (Claude processing)", async () => {
    const f = writeJsonl([{ type: "user", message: { content: "hello" }, timestamp: now() }]);
    expect(await computeSessionState(f)).toBe("active");
  });

  it("idle when the last user entry is stale", async () => {
    const f = writeJsonl([{ type: "user", message: { content: "old" }, timestamp: stale() }]);
    expect(await computeSessionState(f)).toBe("idle");
  });

  it("idle when the last user entry is an interrupt (escape pressed)", async () => {
    const f = writeJsonl([{
      type: "user",
      message: { content: [{ type: "text", text: "[Request interrupted by user]" }] },
      timestamp: now(),
    }]);
    expect(await computeSessionState(f)).toBe("idle");
  });

  it("idle when the last user entry is a rejected tool_result", async () => {
    const f = writeJsonl([{
      type: "user",
      message: { content: [{ type: "tool_result", is_error: true, content: "tool use was rejected" }] },
      timestamp: now(),
    }]);
    expect(await computeSessionState(f)).toBe("idle");
  });

  it("idle when the last assistant turn ended (stop_reason end_turn)", async () => {
    const f = writeJsonl([{ type: "assistant", message: { stop_reason: "end_turn" }, timestamp: now() }]);
    expect(await computeSessionState(f)).toBe("idle");
  });

  it("active when the last assistant turn is mid-flight (stop_reason tool_use, fresh)", async () => {
    const f = writeJsonl([{ type: "assistant", message: { stop_reason: "tool_use" }, timestamp: now() }]);
    expect(await computeSessionState(f)).toBe("active");
  });

  it("active for a null stop_reason that is still fresh", async () => {
    const f = writeJsonl([{ type: "assistant", message: { stop_reason: null }, timestamp: now() }]);
    expect(await computeSessionState(f)).toBe("active");
  });

  it("idle for a tool_use that has gone stale", async () => {
    const f = writeJsonl([{ type: "assistant", message: { stop_reason: "tool_use" }, timestamp: stale() }]);
    expect(await computeSessionState(f)).toBe("idle");
  });

  it("idle when the last entry is a turn_duration system event", async () => {
    const f = writeJsonl([
      { type: "assistant", message: { stop_reason: "tool_use" }, timestamp: now() },
      { type: "system", subtype: "turn_duration", timestamp: now() },
    ]);
    expect(await computeSessionState(f)).toBe("idle");
  });

  it("skips trailing non-user/assistant lines to find the last real entry", async () => {
    const f = writeJsonl([
      { type: "user", message: { content: "go" }, timestamp: now() },
      { type: "progress", data: {} },
      { type: "file-history-snapshot" },
    ]);
    expect(await computeSessionState(f)).toBe("active");
  });
});

describe("readTail", () => {
  it("returns only the last N bytes of a large file", async () => {
    const file = path.join(dir, "big.jsonl");
    writeFileSync(file, "X".repeat(1000) + "TAIL");
    const tail = await readTail(file, 4);
    expect(tail).toBe("TAIL");
  });
});

describe("scanMarkerFiles", () => {
  it("returns the session ids that have an attention marker", async () => {
    mkdirSync(MARKER_DIR, { recursive: true });
    const id = "marker-test-" + Math.random().toString(36).slice(2);
    const markerPath = path.join(MARKER_DIR, MARKER_PREFIX + id);
    writeFileSync(markerPath, "");
    try {
      const waiting = await scanMarkerFiles();
      expect(waiting.has(id)).toBe(true);
    } finally {
      rmSync(markerPath, { force: true });
    }
  });
});
