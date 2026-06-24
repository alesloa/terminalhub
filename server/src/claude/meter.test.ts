import { describe, it, expect } from "vitest";
import { extractAccessToken, parseUsageHeaders, readClaudeToken, createClaudeUsageProvider } from "./meter.js";

describe("extractAccessToken", () => {
  it("reads a direct accessToken", () => {
    expect(extractAccessToken('{"accessToken":"abc123XYZ"}')).toBe("abc123XYZ");
  });
  it("reads a nested claudeAiOauth.accessToken", () => {
    expect(extractAccessToken('{"claudeAiOauth":{"accessToken":"tok-nested"}}')).toBe("tok-nested");
  });
  it("falls back to a regex match on malformed JSON", () => {
    expect(extractAccessToken('garbage "accessToken": "tok-regex" trailing')).toBe("tok-regex");
  });
  it("accepts a bare raw token", () => {
    expect(extractAccessToken("sk-ant-abcdefghijklmnopqrstuvwxyz")).toBe("sk-ant-abcdefghijklmnopqrstuvwxyz");
  });
  it("returns null for empty or token-less blobs", () => {
    expect(extractAccessToken("")).toBeNull();
    expect(extractAccessToken("   ")).toBeNull();
    expect(extractAccessToken("{}")).toBeNull();
  });
});

describe("parseUsageHeaders", () => {
  it("computes pct from a 0–1 fraction and a reset ISO from epoch seconds", () => {
    const resetEpoch = 1_700_003_600; // arbitrary epoch seconds
    const h: Record<string, string> = {
      "anthropic-ratelimit-unified-5h-utilization": "0.42",
      "anthropic-ratelimit-unified-5h-reset": String(resetEpoch),
      "anthropic-ratelimit-unified-7d-utilization": "0.1",
      "anthropic-ratelimit-unified-7d-reset": String(resetEpoch),
      "anthropic-ratelimit-unified-5h-status": "allowed",
    };
    const u = parseUsageHeaders((n) => h[n]);
    expect(u.session.pct).toBe(42);
    expect(u.weekly.pct).toBe(10);
    expect(u.status).toBe("allowed");
    expect(u.session.resetsAt).toBe(new Date(resetEpoch * 1000).toISOString());
  });
  it("clamps pct to 0–100", () => {
    const u = parseUsageHeaders((n) => (n.includes("5h-utilization") ? "1.5" : undefined));
    expect(u.session.pct).toBe(100);
  });
  it("defaults missing headers", () => {
    const u = parseUsageHeaders(() => undefined);
    expect(u.session.pct).toBe(0);
    expect(u.session.resetsAt).toBeNull();
    expect(u.weekly.pct).toBe(0);
    expect(u.status).toBe("unknown");
  });
});

describe("readClaudeToken", () => {
  it("reads from ~/.claude/.credentials.json on linux", () => {
    const tok = readClaudeToken({
      platform: "linux",
      home: "/home/x",
      readFile: (p) => {
        expect(p).toBe("/home/x/.claude/.credentials.json");
        return '{"claudeAiOauth":{"accessToken":"file-tok"}}';
      },
    });
    expect(tok).toBe("file-tok");
  });
  it("returns null when the credentials file is missing", () => {
    expect(readClaudeToken({ platform: "linux", readFile: () => { throw new Error("ENOENT"); } })).toBeNull();
  });
  it("prefers the Keychain on darwin", () => {
    const tok = readClaudeToken({
      platform: "darwin",
      keychain: () => "kc-tok",
      readFile: () => { throw new Error("no file expected"); },
    });
    expect(tok).toBe("kc-tok");
  });
  it("falls back to the file on darwin when the Keychain is empty", () => {
    const tok = readClaudeToken({
      platform: "darwin",
      home: "/Users/x",
      keychain: () => null,
      readFile: () => '{"accessToken":"darwin-file-tok"}',
    });
    expect(tok).toBe("darwin-file-tok");
  });
});

function headerResponse(map: Record<string, string>, ok = true, status = 200) {
  return { ok, status, headers: { get: (n: string) => map[n] ?? null } } as unknown as Response;
}

describe("createClaudeUsageProvider", () => {
  it("reports unavailable when no token is found", async () => {
    const p = createClaudeUsageProvider({ readToken: () => null });
    const r = await p.get();
    expect(r.available).toBe(false);
  });

  it("reports unavailable when the API rejects the token", async () => {
    const p = createClaudeUsageProvider({
      readToken: () => "tok",
      fetch: (async () => headerResponse({}, false, 401)) as unknown as typeof fetch,
    });
    const r = await p.get();
    expect(r.available).toBe(false);
  });

  it("returns parsed usage and caches a successful poll", async () => {
    let calls = 0;
    const fakeFetch = (async () => {
      calls++;
      return headerResponse({
        "anthropic-ratelimit-unified-5h-utilization": "0.5",
        "anthropic-ratelimit-unified-5h-reset": "1700003600",
        "anthropic-ratelimit-unified-7d-utilization": "0.2",
        "anthropic-ratelimit-unified-5h-status": "allowed",
      });
    }) as unknown as typeof fetch;
    const p = createClaudeUsageProvider({ readToken: () => "tok", fetch: fakeFetch, now: () => 1000 });

    const r1 = await p.get();
    expect(r1.available).toBe(true);
    if (r1.available) {
      expect(r1.session.pct).toBe(50);
      expect(r1.weekly.pct).toBe(20);
      expect(r1.status).toBe("allowed");
    }
    const r2 = await p.get(); // within TTL → served from cache, no second fetch
    expect(calls).toBe(1);
    expect(r2).toEqual(r1);
  });
});
