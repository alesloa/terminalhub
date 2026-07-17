import { execFileSync } from "node:child_process";
import type { FastifyInstance } from "fastify";
import * as pty from "node-pty";
import type { AppContext } from "../context.js";
import { authorizeWs } from "./wsAuth.js";
import { attachHeartbeat } from "./heartbeat.js";
import { isLockedViewer } from "../auth/access.js";
import { tmuxStatusStyle } from "../tmux/controller.js";
import { cleanShellEnv } from "../tmux/cleanEnv.js";
import type { Config } from "../config.js";

// On Windows, ConPTY's native startProcess can't resolve short executable names through WinGet
// symlinks in PATH — it needs the full path. Resolve once at startup; no-op on Linux/Mac.
function resolveTmuxBin(): string {
  if (process.platform !== "win32") return "tmux";
  try {
    const out = execFileSync("where", ["tmux"], { encoding: "utf8" });
    return out.trim().split(/\r?\n/)[0] ?? "tmux";
  } catch { return "tmux"; }
}
const TMUX_BIN = resolveTmuxBin();

// Server→client WS liveness. A client that vanishes ungracefully (browser force-quit, laptop sleep,
// Cloudflare-tunnel/network drop mid-stream) never sends a TCP FIN, so socket 'close' never fires and
// the attach PTY's master fd leaks until the OS pty cap (~511 on macOS). The heartbeat pings each
// interval and terminate()s a peer that stops ponging, which fires 'close' → cleanup → PTY freed. 30s
// is the independent server-driven direction; the client separately app-level-pings every 25s.
const HEARTBEAT_MS = 30_000;
// If the tmux attach client ignores SIGHUP, force it so node-pty releases the master fd. Kills only the
// attach client — the tmux session and the agent inside it survive (the whole durability point).
const KILL_GRACE_MS = 2_000;

export async function terminalGateway(app: FastifyInstance, ctx: AppContext, config: Config) {
  // Every live attach PTY, so a server shutdown reaps them all (mirrors lsp/manager.ts). Function-scoped
  // — one Set per registered app — so tests don't bleed children across instances.
  const liveChildren = new Set<pty.IPty>();
  app.addHook("onClose", async () => {
    for (const child of liveChildren) { try { child.kill(); } catch { /* already gone */ } }
    liveChildren.clear();
  });

  app.get("/ws/terminal/:id", { websocket: true }, (socket, req) => {
    // auth on the upgrade request (loopback/token = owner; valid access-key secret = teammate)
    const url = new URL(req.url, "http://localhost");
    const principal = authorizeWs(ctx, config, socket, req, url.searchParams.get("token"));
    if (!principal) return;
    // A locked teammate (share link with "lock" on) is a passive spectator: they still ATTACH and watch
    // the live output, but every frame that would mutate the shared tmux session — typing, PTY resize,
    // scrollback/copy-mode, search — is dropped here on the server, the hard boundary the client can't bypass.
    const locked = isLockedViewer(principal);

    const id = (req.params as any).id as string;
    const term = ctx.store.getTerminal(id);
    if (!term) { socket.close(1011, "terminal not found"); return; }

    const cols = Number(url.searchParams.get("cols") ?? 200);
    const rows = Number(url.searchParams.get("rows") ?? 50);

    // Apply session options before spawning the PTY. execFileSync keeps these out of the ConPTY
    // spawn so they don't interfere with the interactive attach. Swallow errors — the session may
    // not exist yet (a new terminal's session is created just before this WebSocket connects).
    // cleanShellEnv() keeps the hub/PM2 environment (PORT, NODE_ENV, TERMINALHUB_*, pm_*) out of any
    // tmux server these commands might start, so it can't poison the global env new panes inherit.
    const tmuxEnv = cleanShellEnv();
    try {
      execFileSync(TMUX_BIN, ["set-option", "-t", term.tmuxSession, "mouse", "off"], { env: tmuxEnv });
      // Recolor the status bar to the user's chosen status-text color (Settings → Appearance). Read
      // per attach so every opened terminal reflects the current setting, even sessions created before
      // it changed (newSession sets the default; this is the authoritative enforcement on open).
      execFileSync(TMUX_BIN, ["set-option", "-t", term.tmuxSession, "status-style", tmuxStatusStyle(ctx.store.getSettings().tmuxStatusFg)], { env: tmuxEnv });
    } catch { /* session may not exist yet */ }
    // "new-session -A -s" attaches to the named session if it exists, or creates a fresh shell
    // if it was lost — and critically, on Windows/psmux it correctly renders the existing pane
    // content to ConPTY. The plain "attach-session -t" command connects but never redraws the
    // screen in psmux 3.3.6, leaving every browser terminal permanently blank. env is the cleaned
    // shell env (NOT raw process.env) so a session CREATED here starts without the hub/PM2 leak.
    const child = pty.spawn(TMUX_BIN, [
      "new-session", "-A", "-s", term.tmuxSession,
    ], {
      name: "xterm-256color",
      cols, rows,
      env: { ...tmuxEnv, TERM: "xterm-256color", COLORTERM: "truecolor" },
    });
    liveChildren.add(child);
    const stopHeartbeat = attachHeartbeat(socket, HEARTBEAT_MS);

    // Reap the attach PTY exactly once, whether the trigger is the socket closing (normal close or a
    // heartbeat-forced terminate) or the tmux client exiting on its own. Killing the client detaches
    // only — the tmux session/agent keep running. child.kill() sends SIGHUP; node-pty releases the
    // master fd when the client dies and its read stream hits EOF, so the SIGKILL backstop guarantees
    // the fd is freed even if SIGHUP is ignored (that fd is the "pty node" that was leaking).
    let childExited = false;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      stopHeartbeat();
      liveChildren.delete(child);
      if (childExited) return;
      try { child.kill(); } catch { /* already gone */ }
      const forceKill = setTimeout(() => {
        if (!childExited) { try { child.kill("SIGKILL"); } catch { /* already gone */ } }
      }, KILL_GRACE_MS);
      if (typeof forceKill.unref === "function") forceKill.unref();
    };

    child.onData((data) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: "output", data }));
    });
    child.onExit(() => {
      childExited = true;
      if (socket.readyState === socket.OPEN) { socket.send(JSON.stringify({ type: "exit" })); socket.close(); }
      cleanup();
    });

    // Scroll state. Scrolling up parks the pane in tmux copy-mode (ctx.tmux.scroll), which captures
    // keystrokes for copy navigation instead of passing them to the program — so typing would do
    // nothing and the caret stays stranded up in the scrollback. Mirror a native terminal: the first
    // input after a scroll exits copy-mode, snapping back to the live view, then sends the key. The
    // cancel is an async tmux command while child.write is synchronous, so serialize PTY writes
    // behind any in-flight cancel — otherwise fast typing races ahead into the still-modal pane and
    // either gets eaten or lands out of order.
    let inScrollback = false;
    let cancelling: Promise<void> | null = null;
    const writeInput = (data: string) => {
      if (inScrollback) {
        inScrollback = false;
        const done = ctx.tmux.cancelCopyMode(term.tmuxSession).catch(() => {});
        cancelling = done;
        void done.finally(() => { if (cancelling === done) cancelling = null; });
      }
      if (cancelling) void cancelling.then(() => child.write(data));
      else child.write(data);
    };

    socket.on("message", (raw: Buffer) => {
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      // Keepalive is always allowed (so a locked viewer's socket isn't reaped); everything below it
      // mutates the shared session, so a locked viewer is dropped before it reaches tmux.
      if (msg.type === "ping") { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: "pong" })); return; }
      if (locked) return;
      if (msg.type === "input") writeInput(msg.data);
      else if (msg.type === "resize") child.resize(Math.max(1, msg.cols | 0), Math.max(1, msg.rows | 0));
      // Wheel scrollback: mouse mode is off (for native selection), so the browser sends wheel
      // ticks here and we drive tmux copy-mode instead. Clamp so a misbehaving client can't ask for
      // an absurd repeat count. Fire-and-forget — scroll() swallows the benign "already at bottom".
      else if (msg.type === "scroll") {
        const lines = Math.max(-100000, Math.min(100000, msg.lines | 0));
        if (lines > 0) inScrollback = true; // scrolling up enters copy-mode; next keypress exits it
        ctx.tmux.scroll(term.tmuxSession, lines).catch(() => {});
      }
      // Find in scrollback: drive tmux's own copy-mode search so it scans the FULL history (not just
      // the visible grid the browser holds) and highlights the match in the live pane. Entering
      // copy-mode parks the pane like a scroll does, so flag inScrollback — the next keypress then
      // snaps back to the live view (the find bar's close sends an empty input to do exactly that).
      else if (msg.type === "search") {
        const query = typeof msg.query === "string" ? msg.query.slice(0, 1000) : "";
        if (query) {
          inScrollback = true;
          ctx.tmux.search(term.tmuxSession, query, msg.direction === "down" ? "down" : "up").catch(() => {});
        }
      }
    });

    socket.on("close", cleanup);
  });
}
