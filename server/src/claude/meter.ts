// Claude usage meter — reads the host's Claude Code OAuth token and asks the Anthropic API for the
// current rate-limit utilization, exactly the way the `claude-meter` daemon does. The token is read
// directly from where Claude Code stores it (macOS Keychain, else ~/.claude/.credentials.json); the
// numbers come from the response HEADERS of a 1-token Haiku ping (no inference, effectively free).
//
// Ported faithfully from claude-meter/daemon/claude_usage_daemon.py — keep the header names, the
// `anthropic-beta: oauth-2025-04-20` flag and the claude-code User-Agent, or the OAuth token is
// rejected. (This is the rate-limit meter; ./usage.ts is the unrelated per-session token/cost tally.)

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

const KEYCHAIN_SERVICE = "Claude Code-credentials";
const API_URL = "https://api.anthropic.com/v1/messages";
const API_HEADERS: Record<string, string> = {
  "anthropic-version": "2023-06-01",
  "anthropic-beta": "oauth-2025-04-20",
  "content-type": "application/json",
  "user-agent": "claude-code/2.1.5",
};
const API_BODY = { model: "claude-haiku-4-5-20251001", max_tokens: 1, messages: [{ role: "user", content: "hi" }] };

export interface ClaudeUsageWindow {
  /** 0–100, integer. */
  pct: number;
  /** ISO timestamp the window resets at, or null if the header was absent/unparseable. */
  resetsAt: string | null;
}
export interface ClaudeUsage {
  session: ClaudeUsageWindow; // unified 5-hour window
  weekly: ClaudeUsageWindow;  // unified 7-day window
  status: string;             // anthropic-ratelimit-unified-5h-status ("allowed" | "limited" | "unknown" | …)
}
export type ClaudeUsageResult =
  | ({ available: true; fetchedAt: string } & ClaudeUsage)
  | { available: false; reason: string };

/** Pull the accessToken out of a credentials blob: direct `{accessToken}`, nested
 *  `{claudeAiOauth:{accessToken}}`, a regex fallback for odd shapes, and finally a raw token. */
export function extractAccessToken(blob: string): string | null {
  const s = blob.trim();
  if (!s) return null;
  let data: unknown = null;
  try { data = JSON.parse(s); } catch { data = null; }
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (typeof d.accessToken === "string") return d.accessToken;
    for (const v of Object.values(d)) {
      if (v && typeof v === "object" && typeof (v as { accessToken?: unknown }).accessToken === "string") {
        return (v as { accessToken: string }).accessToken;
      }
    }
  }
  const m = s.match(/"accessToken"\s*:\s*"([^"]+)"/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_\-.~+/=]{20,}$/.test(s)) return s;
  return null;
}

/** Read the Claude Code OAuth token from where the CLI stores it. darwin → Keychain (with a file
 *  fallback); other platforms → ~/.claude/.credentials.json. All deps are injectable for tests. */
export function readClaudeToken(deps: {
  platform?: NodeJS.Platform;
  home?: string;
  user?: string;
  readFile?: (path: string) => string;
  keychain?: () => string | null;
} = {}): string | null {
  const platform = deps.platform ?? process.platform;
  const home = deps.home ?? homedir();
  const readFile = deps.readFile ?? ((p: string) => readFileSync(p, "utf8"));
  const credPath = join(home, ".claude", ".credentials.json");

  const fromFile = (): string | null => {
    try { return extractAccessToken(readFile(credPath)); } catch { return null; }
  };
  const fromKeychain = deps.keychain ?? ((): string | null => {
    try {
      const user = deps.user ?? userInfo().username;
      const out = execFileSync(
        "security",
        ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", user, "-w"],
        { encoding: "utf8", timeout: 10_000 },
      );
      return extractAccessToken(out);
    } catch { return null; }
  });

  if (platform === "darwin") return fromKeychain() ?? fromFile();
  return fromFile();
}

/** Turn the unified rate-limit response headers into a ClaudeUsage. `get` is a header accessor
 *  (so a `Headers` object or a plain map both work). util is a 0–1 fraction; reset is epoch seconds. */
export function parseUsageHeaders(get: (name: string) => string | null | undefined): ClaudeUsage {
  const pct = (util: string | null | undefined): number => {
    const n = Number(util);
    if (!Number.isFinite(n)) return 0;
    return Math.min(100, Math.max(0, Math.round(n * 100)));
  };
  const resetsAt = (reset: string | null | undefined): string | null => {
    if (reset == null || reset === "") return null;
    const n = Number(reset);
    if (Number.isFinite(n) && n > 0) return new Date(n * 1000).toISOString();
    const t = Date.parse(reset); // resilience if a future API hands back an ISO string instead
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  };
  return {
    session: {
      pct: pct(get("anthropic-ratelimit-unified-5h-utilization")),
      resetsAt: resetsAt(get("anthropic-ratelimit-unified-5h-reset")),
    },
    weekly: {
      pct: pct(get("anthropic-ratelimit-unified-7d-utilization")),
      resetsAt: resetsAt(get("anthropic-ratelimit-unified-7d-reset")),
    },
    status: get("anthropic-ratelimit-unified-5h-status") || "unknown",
  };
}

/** Ask the Anthropic API for the current usage. Throws on a non-2xx response. */
export async function fetchClaudeUsage(token: string, deps: { fetch?: typeof fetch } = {}): Promise<ClaudeUsage> {
  const fetchImpl = deps.fetch ?? fetch;
  const resp = await fetchImpl(API_URL, {
    method: "POST",
    headers: { ...API_HEADERS, authorization: `Bearer ${token}` },
    body: JSON.stringify(API_BODY),
  });
  if (!resp.ok) throw new Error(`anthropic API HTTP ${resp.status}`);
  return parseUsageHeaders((name) => resp.headers.get(name));
}

/** A cached, single-flight usage provider so every browser tab shares one real poll. */
export function createClaudeUsageProvider(deps: {
  readToken?: () => string | null;
  fetch?: typeof fetch;
  now?: () => number;
  ttlMs?: number;
} = {}) {
  const readToken = deps.readToken ?? (() => readClaudeToken());
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? (() => Date.now());
  const okTtl = deps.ttlMs ?? 55_000;
  const errTtl = Math.min(okTtl, 10_000); // recover quickly once the user logs in

  let cache: { at: number; result: ClaudeUsageResult } | null = null;
  let pending: Promise<ClaudeUsageResult> | null = null;

  async function compute(): Promise<ClaudeUsageResult> {
    const token = readToken();
    if (!token) {
      return { available: false, reason: "Claude Code isn't logged in on this machine. Run `claude` in a terminal to sign in." };
    }
    try {
      const usage = await fetchClaudeUsage(token, { fetch: fetchImpl });
      return { available: true, fetchedAt: new Date(now()).toISOString(), ...usage };
    } catch {
      return { available: false, reason: "Couldn't read Claude usage — your login may have expired. Re-run `claude` to sign in." };
    }
  }

  async function get(force = false): Promise<ClaudeUsageResult> {
    const t = now();
    if (!force && cache) {
      const ttl = cache.result.available ? okTtl : errTtl;
      if (t - cache.at < ttl) return cache.result;
    }
    if (pending) return pending;
    pending = compute()
      .then((result) => { cache = { at: now(), result }; pending = null; return result; })
      .catch((e) => { pending = null; throw e; });
    return pending;
  }

  return { get };
}

export const claudeUsage = createClaudeUsageProvider();
