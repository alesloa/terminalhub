import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node";

// The minimal slice of @fastify/websocket's socket the manager touches. Typed narrowly so tests can
// pass a plain fake. `on` covers both "message" (Buffer payload) and "close".
export interface LspSocket {
  readyState: number;
  OPEN: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: string, cb: (...args: any[]) => void): void;
}

export interface LspManagerOptions {
  spawn?: typeof nodeSpawn;
  maxChildren?: number; // backstop against a flood of editor tabs spawning servers without bound
}

export interface LspConnectParams {
  folder: string; // workspace folder → child cwd, so the server resolves the project root
  server: { bin: string; args: string[] };
}

/** Manages LSP child processes. Each browser WebSocket gets its own dedicated child — the browser
 *  caches one LSPClient per (workspace, languageId), so it's a clean 1 WS ↔ 1 child mapping with no
 *  multiplexing. The manager is a transparent JSON-RPC pipe: raw JSON on the socket, Content-Length
 *  framing on the child's stdio (via vscode-jsonrpc). Same lifecycle shape as the terminal gateway —
 *  the child dies with its socket. */
export function createLspManager(opts: LspManagerOptions = {}) {
  const spawn = opts.spawn ?? nodeSpawn;
  const maxChildren = opts.maxChildren ?? 24;
  const children = new Set<ChildProcess>();

  function connect(socket: LspSocket, params: LspConnectParams): boolean {
    if (children.size >= maxChildren) {
      socket.close(1013, "too many language servers"); // 1013 = try again later
      return false;
    }

    const child = spawn(params.server.bin, params.server.args, {
      cwd: params.folder,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    children.add(child);

    const reader = new StreamMessageReader(child.stdout!);
    const writer = new StreamMessageWriter(child.stdin!);

    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      children.delete(child);
      try { reader.dispose(); } catch { /* already torn down */ }
      try { writer.dispose(); } catch { /* already torn down */ }
      try { child.kill(); } catch { /* already gone */ }
    };

    // child → browser: framed JSON-RPC out → raw JSON string on the socket.
    reader.listen((msg) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
    });
    reader.onError(() => { /* surfaced via child 'error'/'exit'; nothing extra to do */ });

    // browser → child: raw JSON string in → Content-Length-framed on stdin. Drop unparseable frames.
    socket.on("message", (raw: Buffer) => {
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      void writer.write(msg).catch(() => { /* broken pipe → cleanup runs on exit */ });
    });

    child.on("exit", () => {
      if (socket.readyState === socket.OPEN) socket.close();
      cleanup();
    });
    child.on("error", () => {
      if (socket.readyState === socket.OPEN) socket.close(1011, "language server failed to start");
      cleanup();
    });
    socket.on("close", cleanup);

    return true;
  }

  /** Kill every live child — called on server shutdown. */
  function shutdownAll() {
    for (const child of children) { try { child.kill(); } catch { /* already gone */ } }
    children.clear();
  }

  return {
    connect,
    shutdownAll,
    get count() { return children.size; },
  };
}

export type LspManager = ReturnType<typeof createLspManager>;
