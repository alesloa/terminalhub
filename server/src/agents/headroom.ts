import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isOnPath } from "./registry.js";

// Headroom (https://github.com/chopratejas/headroom) is a local context-compression proxy. When the
// `headroom` CLI is present, we offer a "Claude (Headroom)" launcher that runs Claude through it via
// `headroom wrap claude` — wrap starts (or reuses) the loopback proxy and points Claude at it, so the
// launcher self-heals the proxy's running state. This module reports whether that launcher is usable.

export interface HeadroomStatus {
  installed: boolean;   // `headroom` resolves on $PATH (or the pipx default bin dir)
  running: boolean;     // the proxy answers a health check on the loopback port
  port: number;         // loopback port probed
  command: string;      // launch command for a Headroom-wrapped Claude terminal
  installHint: string;  // one-liner to install the CLI
  repoUrl: string;      // where to read more / install docs
}

const DEFAULT_PORT = 8787;
// `--model "opus[1m]"` pins Claude Code's 1M-token context window. Through a custom ANTHROPIC_BASE_URL
// (the headroom proxy) Claude Code does NOT apply the subscription-based 1M auto-upgrade for Opus, so it
// would otherwise fall back to the 200k window and auto-compact early. The `[1m]` suffix is a client-side
// flag (stripped before the API call); the quotes stop zsh globbing the brackets when tmux send-keys runs it.
const LAUNCH_COMMAND = 'headroom wrap claude --model "opus[1m]"';
const INSTALL_HINT = 'pipx install "headroom-ai[all]"';
const REPO_URL = "https://github.com/chopratejas/headroom";

export interface HeadroomProbeOpts {
  pathEnv?: string;
  exists?: (p: string) => boolean;
  port?: number;
  probe?: (port: number) => Promise<boolean>;
  stats?: (port: number) => Promise<unknown>; // injectable /stats fetch (tests)
}

// Live compression savings, parsed from the proxy's /stats. `available:false` carries a human reason
// (CLI absent, proxy down, or no traffic yet) so the widget renders a clean state instead of zeros.
export type HeadroomSavings =
  | {
      available: true;
      tokensSaved: number;       // total tokens the proxy stripped before forwarding
      tokensBefore: number;      // total tokens that entered the proxy
      tokensAfter: number;       // tokensBefore − tokensSaved (what actually hit the model)
      tokenSavingsPct: number;   // tokensSaved / tokensBefore, as a %
      usdSaved: number;          // dollar value of the compression (model list price)
      usdSavingsPct: number;     // % off the would-be bill
      cacheSavedUsd: number;     // separate prompt-cache savings the proxy attributes
      avgCompressionPct: number; // mean shrink across compressed requests
      bestCompressionPct: number;// single best-compressed request
      requestsCompressed: number;
      apiRequests: number;
      primaryModel: string | null;
      at: number;                // server clock when /stats was read
    }
  | { available: false; reason: string };

function canExec(p: string): boolean {
  try { accessSync(p, constants.X_OK); return true; } catch { return false; }
}

/** Installed if `headroom` is on $PATH, or sits at the pipx default bin (covers a server whose PATH
 *  predates `pipx ensurepath`). */
export function headroomInstalled(opts: { pathEnv?: string; exists?: (p: string) => boolean } = {}): boolean {
  if (isOnPath("headroom", opts)) return true;
  const exists = opts.exists ?? canExec;
  return exists(join(homedir(), ".local", "bin", "headroom"));
}

/** True if the Headroom proxy answers a health check on the loopback port. */
export async function probeHeadroomProxy(port: number, timeoutMs = 500): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: ctrl.signal });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

export async function headroomStatus(opts: HeadroomProbeOpts = {}): Promise<HeadroomStatus> {
  const port = opts.port ?? (Number(process.env.HEADROOM_PORT) || DEFAULT_PORT);
  const installed = headroomInstalled({ pathEnv: opts.pathEnv, exists: opts.exists });
  const probe = opts.probe ?? probeHeadroomProxy;
  // Only probe the network when the CLI exists — a missing CLI is definitively "not running".
  const running = installed ? await probe(port) : false;
  return { installed, running, port, command: LAUNCH_COMMAND, installHint: INSTALL_HINT, repoUrl: REPO_URL };
}

/** GET the proxy's /stats JSON (with a short timeout). Throws if the proxy is down or errors. */
async function fetchHeadroomStats(port: number, timeoutMs = 1500): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/stats`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`stats ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Coerce an unknown to a plain object for safe nested reads; non-objects → {}. */
function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
/** Finite number or 0 — the /stats fields are numbers but we never trust a remote shape blindly. */
function asNum(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Parse live compression savings from the proxy. Returns an unavailable state (with a reason) when
 *  the CLI is missing, the proxy is down, or no traffic has flowed through it yet. */
export async function headroomSavings(opts: HeadroomProbeOpts = {}): Promise<HeadroomSavings> {
  const port = opts.port ?? (Number(process.env.HEADROOM_PORT) || DEFAULT_PORT);
  const installed = headroomInstalled({ pathEnv: opts.pathEnv, exists: opts.exists });
  if (!installed) return { available: false, reason: "headroom CLI not installed" };

  const getStats = opts.stats ?? fetchHeadroomStats;
  let raw: unknown;
  try {
    raw = await getStats(port);
  } catch {
    return { available: false, reason: "headroom proxy not running" };
  }

  const stats = asObj(raw);
  const summary = asObj(stats.summary);
  const compression = asObj(summary.compression);
  const cost = asObj(summary.cost);
  const breakdown = asObj(cost.breakdown);
  const totals = asObj(asObj(stats.agent_usage).totals);

  const tokensSaved = asNum(compression.total_tokens_removed);
  const tokensBefore = asNum(compression.total_tokens_before_with_cli_filtering);
  // No traffic yet → nothing meaningful to chart; let the widget show a clean "warming up" state.
  if (tokensBefore <= 0) return { available: false, reason: "no traffic through the proxy yet" };

  return {
    available: true,
    tokensSaved,
    tokensBefore,
    tokensAfter: Math.max(0, tokensBefore - tokensSaved),
    tokenSavingsPct: asNum(totals.savings_percent),
    usdSaved: asNum(cost.total_saved_usd),
    usdSavingsPct: asNum(cost.savings_pct),
    cacheSavedUsd: asNum(breakdown.cache_savings_usd),
    avgCompressionPct: asNum(compression.avg_compression_pct),
    bestCompressionPct: asNum(compression.best_compression_pct),
    requestsCompressed: asNum(compression.requests_compressed),
    apiRequests: asNum(summary.api_requests),
    primaryModel: typeof summary.primary_model === "string" ? summary.primary_model : null,
    at: Date.now(),
  };
}
