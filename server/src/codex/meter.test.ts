import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { parseRateLimits, fetchCodexUsage, createCodexUsageProvider, type CodexUsage } from "./meter.js";

describe("parseRateLimits", () => {
  it("maps primary→session (5h) and secondary→weekly with epoch resets", () => {
    const reset5h = 1_781_452_685;
    const reset7d = 1_781_803_899;
    const u = parseRateLimits({
      primary: { usedPercent: 2, windowDurationMins: 300, resetsAt: reset5h },
      secondary: { usedPercent: 1, windowDurationMins: 10080, resetsAt: reset7d },
      planType: "plus",
      rateLimitReachedType: null,
    });
    expect(u.session.pct).toBe(2);
    expect(u.weekly.pct).toBe(1);
    expect(u.session.resetsAt).toBe(new Date(reset5h * 1000).toISOString());
    expect(u.weekly.resetsAt).toBe(new Date(reset7d * 1000).toISOString());
    expect(u.status).toBe("allowed");
    expect(u.planType).toBe("plus");
  });

  it("marks status limited when rateLimitReachedType is set", () => {
    const u = parseRateLimits({ primary: { usedPercent: 100 }, rateLimitReachedType: "rate_limit_reached" });
    expect(u.status).toBe("limited");
  });

  it("clamps pct and nulls missing/zero resets", () => {
    const u = parseRateLimits({ primary: { usedPercent: 150 }, secondary: { usedPercent: -5, resetsAt: 0 } });
    expect(u.session.pct).toBe(100);
    expect(u.weekly.pct).toBe(0);
    expect(u.session.resetsAt).toBeNull();
    expect(u.weekly.resetsAt).toBeNull();
  });

  it("defaults an empty snapshot to zeros", () => {
    const u = parseRateLimits({});
    expect(u.session.pct).toBe(0);
    expect(u.weekly.pct).toBe(0);
    expect(u.session.resetsAt).toBeNull();
    expect(u.status).toBe("allowed");
    expect(u.planType).toBeNull();
  });
});

// A fake `codex app-server` child that emits the given stdout chunks, ignores stdin, and supports kill.
function fakeSpawn(chunks: string[]) {
  return ((..._args: unknown[]) => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter; stdin: { write: () => boolean }; kill: () => void;
    };
    child.stdout = new EventEmitter();
    child.stdin = { write: () => true };
    child.kill = () => {};
    setImmediate(() => { for (const c of chunks) child.stdout.emit("data", Buffer.from(c)); });
    return child;
  }) as unknown as typeof import("node:child_process").spawn;
}

describe("fetchCodexUsage (JSON-RPC handshake)", () => {
  const RL = {
    id: 2,
    result: { rateLimits: { primary: { usedPercent: 7, resetsAt: 1_781_452_685 }, secondary: { usedPercent: 3, resetsAt: 1_781_803_899 }, planType: "plus", rateLimitReachedType: null } },
  };

  it("resolves the id:2 response, ignoring notifications and the initialize reply", async () => {
    const spawn = fakeSpawn([
      JSON.stringify({ method: "remoteControl/status/changed", params: {} }) + "\n",
      JSON.stringify({ id: 1, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n",
      JSON.stringify(RL) + "\n",
    ]);
    const u = await fetchCodexUsage({ spawn, timeoutMs: 1000 });
    expect(u.session.pct).toBe(7);
    expect(u.weekly.pct).toBe(3);
  });

  it("reassembles a response split across stdout chunks", async () => {
    const line = JSON.stringify(RL) + "\n";
    const spawn = fakeSpawn([line.slice(0, 20), line.slice(20)]);
    const u = await fetchCodexUsage({ spawn, timeoutMs: 1000 });
    expect(u.session.pct).toBe(7);
  });

  it("rejects when the child errors (e.g. CLI not installed)", async () => {
    const spawn = (() => {
      const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stdin: { write: () => boolean }; kill: () => void };
      child.stdout = new EventEmitter();
      child.stdin = { write: () => true };
      child.kill = () => {};
      setImmediate(() => child.emit("error", Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" })));
      return child;
    }) as unknown as typeof import("node:child_process").spawn;
    await expect(fetchCodexUsage({ spawn, timeoutMs: 1000 })).rejects.toThrow(/ENOENT/);
  });
});

describe("createCodexUsageProvider", () => {
  const usage: CodexUsage = {
    session: { pct: 7, resetsAt: null }, weekly: { pct: 3, resetsAt: null }, status: "allowed", planType: "plus",
  };

  it("returns parsed usage and caches a successful read", async () => {
    let calls = 0;
    const p = createCodexUsageProvider({ fetchUsage: async () => { calls++; return usage; }, now: () => 1000 });
    const r1 = await p.get();
    expect(r1.available).toBe(true);
    if (r1.available) expect(r1.session.pct).toBe(7);
    const r2 = await p.get(); // within TTL → cached, no second spawn
    expect(calls).toBe(1);
    expect(r2).toEqual(r1);
  });

  it("reports an install hint when the CLI is missing (ENOENT)", async () => {
    const p = createCodexUsageProvider({ fetchUsage: async () => { throw new Error("spawn codex ENOENT"); } });
    const r = await p.get();
    expect(r.available).toBe(false);
    if (!r.available) expect(r.reason).toMatch(/install/i);
  });

  it("reports a generic sign-in hint on other failures", async () => {
    const p = createCodexUsageProvider({ fetchUsage: async () => { throw new Error("codex app-server timed out"); } });
    const r = await p.get();
    expect(r.available).toBe(false);
    if (!r.available) expect(r.reason).toMatch(/sign in/i);
  });
});
