import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { cleanShellEnv } from "../tmux/cleanEnv.js";

// A JSON-RPC client for `codex app-server` — the headless surface of the real Codex CLI.
//
// This is the Codex equivalent of what @anthropic-ai/claude-agent-sdk does for Claude: it spawns the
// installed binary and talks a documented protocol to it over stdio, so the GUI chat drives the
// user's own Codex (their auth, their ~/.codex config, their MCP servers) rather than an API of our
// own. There is no published Node SDK for it, so the transport lives here.
//
// Wire format, verified against codex-cli 0.147.0 and mirrored from t3code's transport:
//   • one JSON value per line, newline-delimited — NOT LSP Content-Length framing;
//   • NO `jsonrpc: "2.0"` member. Requests are `{id, method, params?}`, notifications `{method,
//     params?}`, responses `{id, result}` or `{id, error}`. Adding the version member is rejected.
//   • the server also sends requests TO us (approvals, questions), which we answer by id.

/** A request the server asks US, waiting on a reply. `respond` is called exactly once. */
export type ServerRequestHandler = (params: unknown) => Promise<unknown>;

export interface CodexAppServer {
  /** Call a method and wait for its result. Rejects on a JSON-RPC error or on process exit. */
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
  /** Fire-and-forget. */
  notify(method: string, params?: unknown): void;
  /** Answer a server→client request of this method. One handler per method; last registration wins. */
  onRequest(method: string, handler: ServerRequestHandler): void;
  /** Every server→client notification, in arrival order. */
  onNotification(fn: (method: string, params: unknown) => void): void;
  /** Resolves when the child exits, with the exit code (null when killed by a signal). */
  readonly exited: Promise<number | null>;
  /** True until the child exits or `close()` is called. */
  alive(): boolean;
  close(): Promise<void>;
}

export interface CodexAppServerOptions {
  /** The Codex binary. Defaults to `codex` on PATH. */
  command?: string;
  /** Extra argv AFTER `app-server` — e.g. `["-c", "model=gpt-5.6-terra"]`. */
  args?: readonly string[];
  cwd: string;
  /** Overrides merged over the cleaned shell environment. */
  env?: Record<string, string>;
  /** Diagnostic sink for the child's stderr. Codex logs warnings there; it is never protocol. */
  onStderr?: (chunk: string) => void;
}

/** Shape of a JSON-RPC error member. */
interface WireError { code?: number; message?: string; data?: unknown }

export class CodexAppServerError extends Error {
  readonly code: number | undefined;
  readonly data: unknown;
  constructor(method: string, error: WireError) {
    super(error.message ? `${method}: ${error.message}` : `${method} failed`);
    this.name = "CodexAppServerError";
    this.code = error.code;
    this.data = error.data;
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  method: string;
}

export function startCodexAppServer(opts: CodexAppServerOptions): CodexAppServer {
  const child: ChildProcessWithoutNullStreams = spawn(
    opts.command ?? "codex",
    ["app-server", ...(opts.args ?? [])],
    {
      cwd: opts.cwd,
      // Same denylist the tmux panes use: the hub's PORT/NODE_ENV/token must never reach the agent.
      env: { ...(cleanShellEnv() as Record<string, string>), ...(opts.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  const pending = new Map<number, Pending>();
  const requestHandlers = new Map<string, ServerRequestHandler>();
  const notificationSubscribers = new Set<(method: string, params: unknown) => void>();
  let nextId = 1;
  let closed = false;

  let settleExit: (code: number | null) => void;
  const exited = new Promise<number | null>((resolve) => { settleExit = resolve; });

  const write = (message: Record<string, unknown>) => {
    if (closed || !child.stdin.writable) return;
    try { child.stdin.write(`${JSON.stringify(message)}\n`); } catch { /* the child went away */ }
  };

  /** Fail every in-flight request. Called once, when the transport is gone for good. */
  const rejectAll = (reason: string) => {
    const err = new Error(reason);
    for (const [, p] of pending) p.reject(err);
    pending.clear();
  };

  const handleResponse = (msg: Record<string, unknown>) => {
    const id = msg.id as number;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (msg.error) p.reject(new CodexAppServerError(p.method, msg.error as WireError));
    else p.resolve(msg.result);
  };

  const handleServerRequest = (msg: Record<string, unknown>) => {
    const id = msg.id as number | string;
    const method = String(msg.method);
    const handler = requestHandlers.get(method);
    if (!handler) {
      // -32601 is JSON-RPC's "method not found". Codex tolerates a refusal — several server requests
      // are optional capabilities — but it will hang forever on silence, so always answer.
      write({ id, error: { code: -32601, message: `unhandled: ${method}` } });
      return;
    }
    void handler(msg.params)
      .then((result) => { write({ id, result: result ?? {} }); })
      .catch((err: unknown) => {
        write({ id, error: { code: -32603, message: err instanceof Error ? err.message : "handler failed" } });
      });
  };

  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let msg: Record<string, unknown>;
      // A line we can't parse is not fatal: the protocol is a stream, and one bad frame must not
      // take the conversation down with it.
      try { msg = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
      if (typeof msg !== "object" || msg === null) continue;
      if (msg.id !== undefined && msg.method === undefined) { handleResponse(msg); continue; }
      if (msg.id !== undefined && msg.method !== undefined) { handleServerRequest(msg); continue; }
      if (typeof msg.method === "string") {
        for (const fn of notificationSubscribers) {
          try { fn(msg.method, msg.params); } catch { /* a bad subscriber must not stop the stream */ }
        }
      }
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { opts.onStderr?.(chunk); });

  child.on("error", (err) => {
    closed = true;
    rejectAll(`codex app-server could not start: ${err.message}`);
    settleExit(null);
  });
  child.on("exit", (code) => {
    closed = true;
    rejectAll(code === null ? "codex app-server was killed" : `codex app-server exited (${code})`);
    settleExit(code);
  });

  return {
    request<T>(method: string, params?: unknown): Promise<T> {
      if (closed) return Promise.reject(new Error("codex app-server is not running"));
      const id = nextId++;
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject, method });
        write(params === undefined ? { id, method } : { id, method, params });
      });
    },

    notify(method, params) {
      write(params === undefined ? { method } : { method, params });
    },

    onRequest(method, handler) { requestHandlers.set(method, handler); },

    onNotification(fn) { notificationSubscribers.add(fn); },

    exited,
    alive: () => !closed,

    async close() {
      if (closed) return;
      closed = true;
      rejectAll("codex app-server stopped");
      // Closing stdin is the graceful exit: the server drains and shuts down on EOF. The kill is the
      // backstop for a build that ignores it.
      try { child.stdin.end(); } catch { /* already gone */ }
      const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } }, 2000);
      await exited.finally(() => { clearTimeout(timer); });
    },
  };
}
