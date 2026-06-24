import { describe, it, expect } from "vitest";
import { headroomStatus, headroomSavings } from "./headroom.js";

const existsFor = (names: Set<string>) => (p: string) => names.has(p.split("/").pop()!);

// A trimmed but real-shaped /stats payload (mirrors the proxy's GET /stats summary block).
const STATS = {
  summary: {
    api_requests: 244,
    primary_model: "claude-opus-4-8",
    compression: {
      requests_compressed: 153,
      avg_compression_pct: 16.0,
      best_compression_pct: 48.8,
      total_tokens_removed: 2188082,
      total_tokens_before_with_cli_filtering: 18378603,
    },
    cost: { total_saved_usd: 7.24, savings_pct: 21.2, breakdown: { cache_savings_usd: 61.79 } },
  },
  agent_usage: { totals: { savings_percent: 11.91 } },
};

describe("headroom launcher status", () => {
  it("installed + running when the CLI is on PATH and the proxy answers", async () => {
    const s = await headroomStatus({
      pathEnv: "/bin", exists: existsFor(new Set(["headroom"])), port: 8787, probe: async () => true,
    });
    expect(s.installed).toBe(true);
    expect(s.running).toBe(true);
    expect(s.port).toBe(8787);
    expect(s.command).toBe('headroom wrap claude --model "opus[1m]"');
  });

  it("installed but not running when the proxy is down", async () => {
    const s = await headroomStatus({
      pathEnv: "/bin", exists: existsFor(new Set(["headroom"])), probe: async () => false,
    });
    expect(s.installed).toBe(true);
    expect(s.running).toBe(false);
  });

  it("not installed → never probes the network, running is false, install hint present", async () => {
    let probed = false;
    const s = await headroomStatus({
      pathEnv: "/bin", exists: existsFor(new Set()), probe: async () => { probed = true; return true; },
    });
    expect(s.installed).toBe(false);
    expect(s.running).toBe(false);
    expect(probed).toBe(false);
    expect(s.installHint).toContain("headroom-ai");
    expect(s.repoUrl).toContain("github.com");
  });
});

describe("headroom savings", () => {
  const installed = { pathEnv: "/bin", exists: existsFor(new Set(["headroom"])) };

  it("parses tokens + dollars + compression from /stats", async () => {
    const s = await headroomSavings({ ...installed, stats: async () => STATS });
    if (!s.available) throw new Error("expected available");
    expect(s.tokensSaved).toBe(2188082);
    expect(s.tokensBefore).toBe(18378603);
    expect(s.tokensAfter).toBe(18378603 - 2188082);
    expect(s.tokenSavingsPct).toBeCloseTo(11.91);
    expect(s.usdSaved).toBeCloseTo(7.24);
    expect(s.usdSavingsPct).toBeCloseTo(21.2);
    expect(s.cacheSavedUsd).toBeCloseTo(61.79);
    expect(s.avgCompressionPct).toBe(16);
    expect(s.bestCompressionPct).toBeCloseTo(48.8);
    expect(s.requestsCompressed).toBe(153);
    expect(s.apiRequests).toBe(244);
    expect(s.primaryModel).toBe("claude-opus-4-8");
    expect(s.at).toBeGreaterThan(0);
  });

  it("not installed → unavailable, never fetches /stats", async () => {
    let fetched = false;
    const s = await headroomSavings({
      pathEnv: "/bin", exists: existsFor(new Set()), stats: async () => { fetched = true; return STATS; },
    });
    expect(s.available).toBe(false);
    if (!s.available) expect(s.reason).toContain("not installed");
    expect(fetched).toBe(false);
  });

  it("proxy down (fetch throws) → unavailable with a 'not running' reason", async () => {
    const s = await headroomSavings({ ...installed, stats: async () => { throw new Error("ECONNREFUSED"); } });
    expect(s.available).toBe(false);
    if (!s.available) expect(s.reason).toContain("not running");
  });

  it("no traffic yet (zero tokens before) → unavailable, not a wall of zeros", async () => {
    const empty = { summary: { compression: { total_tokens_before_with_cli_filtering: 0 } } };
    const s = await headroomSavings({ ...installed, stats: async () => empty });
    expect(s.available).toBe(false);
    if (!s.available) expect(s.reason).toContain("no traffic");
  });
});
