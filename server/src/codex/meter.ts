// Codex usage meter — the OpenAI Codex sibling of ../claude/meter.ts. Codex doesn't expose usage via
// response headers like Claude; instead the official `codex` CLI ships an "app-server" that speaks
// newline-delimited JSON-RPC over stdio. We spawn `codex app-server --stdio`, do the
// initialize → initialized handshake, then call `account/rateLimits/read`, which returns the live
// rate-limit snapshot the Codex TUI itself uses (reusing the machine's ChatGPT OAuth login in
// ~/.codex/auth.json — no API key needed). `primary` is the 5-hour window, `secondary` the weekly one.
//
// Verified against codex-cli 0.139.0 (`codex app-server generate-json-schema`): method
// `account/rateLimits/read` → { rateLimits: { primary, secondary, planType, rateLimitReachedType } },
// each window { usedPercent:int, resetsAt:int64 epoch-seconds|null, windowDurationMins:int|null }.

import { spawn as nodeSpawn } from "node:child_process";

const RL_ID = 2; // JSON-RPC id for the rate-limits request (initialize is id 1)
const CLIENT_INFO = { name: "terminalhub", version: "1.0.0" };

export interface CodexUsageWindow {
  /** 0–100, integer. */
  pct: number;
  /** ISO timestamp the window resets at, or null if absent. */
  resetsAt: string | null;
}
export interface CodexUsage {
  session: CodexUsageWindow; // Codex `primary` — 5-hour window
  weekly: CodexUsageWindow;  // Codex `secondary` — 7-day window
  status: string;            // "limited" when rateLimitReachedType is set, else "allowed"
  planType: string | null;   // "plus" | "pro" | … from the snapshot, or null
}
export type CodexUsageResult =
  | ({ available: true; fetchedAt: string } & CodexUsage)
  | { available: false; reason: string };

interface CodexWindow { usedPercent?: number | null; resetsAt?: number | null; windowDurationMins?: number | null }
interface CodexRateLimits {
  primary?: CodexWindow | null;
  secondary?: CodexWindow | null;
  planType?: string | null;
  rateLimitReachedType?: string | null;
}

function clampPct(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.min(100, Math.max(0, Math.round(v)));
}
function epochToIso(secs: unknown): string | null {
  const n = Number(secs);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

/** Turn an `account/rateLimits/read` snapshot into a CodexUsage. Pure — easy to unit-test. */
export function parseRateLimits(rl: CodexRateLimits): CodexUsage {
  const win = (w?: CodexWindow | null): CodexUsageWindow => ({ pct: clampPct(w?.usedPercent), resetsAt: epochToIso(w?.resetsAt) });
  return {
    session: win(rl.primary),
    weekly: win(rl.secondary),
    status: rl.rateLimitReachedType ? "limited" : "allowed",
    planType: rl.planType ?? null,
  };
}

type SpawnFn = typeof nodeSpawn;

/** Spawn `codex app-server --stdio`, run the JSON-RPC handshake, and resolve the live rate limits.
 *  Notifications (no `id`) and the initialize response (`id:1`) are ignored — we match by `id:2`.
 *  Rejects on spawn failure (e.g. ENOENT when the CLI isn't installed) or timeout. Deps injectable. */
export function fetchCodexUsage(deps: { spawn?: SpawnFn; bin?: string; timeoutMs?: number } = {}): Promise<CodexUsage> {
  const spawnImpl = deps.spawn ?? nodeSpawn;
  const bin = deps.bin ?? "codex";
  const timeoutMs = deps.timeoutMs ?? 15_000;

  return new Promise<CodexUsage>((resolve, reject) => {
    const child = spawnImpl(bin, ["app-server", "--stdio"], { stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    let settled = false;

    const finish = (err: Error | null, val?: CodexUsage) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch { /* detach is best-effort */ }
      if (err) reject(err); else resolve(val as CodexUsage);
    };
    const timer = setTimeout(() => finish(new Error("codex app-server timed out")), timeoutMs);

    child.on("error", (e: Error) => finish(e)); // spawn ENOENT etc.
    child.stdout?.on("data", (d: Buffer) => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let msg: { id?: number; result?: { rateLimits?: CodexRateLimits }; error?: { message?: string } };
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg && msg.id === RL_ID) {
          if (msg.error) return finish(new Error(msg.error.message || "codex rate-limit read failed"));
          const rl = msg.result?.rateLimits;
          if (!rl) return finish(new Error("codex response missing rateLimits"));
          return finish(null, parseRateLimits(rl));
        }
      }
    });

    const send = (o: unknown) => child.stdin?.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: CLIENT_INFO } });
    send({ jsonrpc: "2.0", method: "initialized" });
    send({ jsonrpc: "2.0", id: RL_ID, method: "account/rateLimits/read", params: {} });
  });
}

/** A cached, single-flight usage provider so every browser tab shares one real spawn (mirrors
 *  createClaudeUsageProvider). `fetchUsage` is injectable for tests. */
export function createCodexUsageProvider(deps: {
  fetchUsage?: () => Promise<CodexUsage>;
  now?: () => number;
  ttlMs?: number;
} = {}) {
  const fetchUsage = deps.fetchUsage ?? (() => fetchCodexUsage());
  const now = deps.now ?? (() => Date.now());
  const okTtl = deps.ttlMs ?? 55_000;
  const errTtl = Math.min(okTtl, 10_000); // recover quickly once the user logs in / installs

  let cache: { at: number; result: CodexUsageResult } | null = null;
  let pending: Promise<CodexUsageResult> | null = null;

  async function compute(): Promise<CodexUsageResult> {
    try {
      const usage = await fetchUsage();
      return { available: true, fetchedAt: new Date(now()).toISOString(), ...usage };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/ENOENT|not found/i.test(msg)) {
        return { available: false, reason: "Codex CLI isn't installed on this machine. Install `@openai/codex` and run `codex` to sign in." };
      }
      return { available: false, reason: "Couldn't read Codex usage — sign in by running `codex` in a terminal." };
    }
  }

  async function get(force = false): Promise<CodexUsageResult> {
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

export const codexUsage = createCodexUsageProvider();
