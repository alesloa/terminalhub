import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import type { Config } from "../config.js";
import { authorizeWs } from "./wsAuth.js";
import { attachHeartbeat } from "./heartbeat.js";
import { isLockedViewer } from "../auth/access.js";
import { loadHistory } from "../gui/history.js";
import type { GuiClientFrame, GuiServerFrame } from "../gui/types.js";

// The browser side of a GUI-mode terminal. Mirrors terminalGateway's contract — same auth, same
// heartbeat, same locked-viewer rule — but streams normalised chat events instead of PTY bytes.
//
// Crucially, closing this socket does NOT stop the agent. The session lives in ctx.gui and keeps
// working; a reconnecting client replays history and re-subscribes. That's the GUI equivalent of
// tmux durability.

const HEARTBEAT_MS = 30_000;

export async function guiGateway(app: FastifyInstance, ctx: AppContext, config: Config) {
  app.get("/ws/gui/:id", { websocket: true }, async (socket, req) => {
    const url = new URL(req.url, "http://localhost");
    const principal = authorizeWs(ctx, config, socket, req, url.searchParams.get("token"));
    if (!principal) return;
    // A locked share-link viewer watches the conversation but cannot drive it — the same hard
    // server-side boundary the tmux gateway enforces on input.
    const locked = isLockedViewer(principal);

    const id = (req.params as { id: string }).id;
    const term = ctx.store.getTerminal(id);
    if (!term) { socket.close(1011, "terminal not found"); return; }
    const ws = ctx.store.getWorkspace(term.workspaceId);
    if (!ws) { socket.close(1011, "workspace not found"); return; }

    const send = (frame: GuiServerFrame) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame));
    };

    const stopHeartbeat = attachHeartbeat(socket, HEARTBEAT_MS);

    // A running session is the authority on the composer's picks (it may have been restarted under a
    // new config); the stored row covers a chat nobody has opened yet.
    const running = ctx.gui.get(term.id);
    const guiConfig = running?.config() ?? term.guiConfig;

    // Everything said before this socket existed. A live session's own transcript wins: switching
    // terminal tabs unmounts the panel and drops the socket, and Claude's on-disk JSONL lags the
    // stream (and doesn't exist at all before the first turn is written), so reading from disk while
    // a session is running is how a reconnect used to come back blank.
    const live = running?.messages() ?? [];
    const history = live.length
      ? live
      : term.agentSessionId ? await loadHistory(term.agentSessionId, ws.folder) : [];
    send({ type: "history", messages: history, sessionId: term.agentSessionId, config: guiConfig });

    const session = ctx.gui.ensure({
      terminalId: term.id,
      cwd: ws.folder,
      resumeSessionId: term.agentSessionId,
      config: guiConfig,
      onSessionId: (sessionId) => ctx.store.setTerminalAgentSession(term.id, sessionId),
      // Bound to the session, not to this socket: a chat that finishes after you closed the tab is
      // exactly the case the notification exists for. attentionFirer is the same entry point a
      // pane's bell reaches, so the toast, OS notification and spoken line are identical.
      onAttention: () => { ctx.attentionFirer.fire(term.id); },
    });

    const unsubscribe = session.subscribe((event) => send({ type: "event", event }));
    // Late joiners need the current state immediately — without this the composer would look idle
    // while a turn is actually running.
    send({ type: "event", event: { type: "state", state: session.state() } });
    // …and the requests still blocking the agent. These were emitted once, live, to whoever was
    // watching then; without a replay a client that arrives afterwards sees "waiting" with no
    // question or approval on screen, and the agent hangs on a prompt nobody can answer.
    for (const event of session.pending()) send({ type: "event", event });
    // The meter is pushed after each turn; a client that connects between turns needs the current
    // reading or it would sit blank until the next one finishes.
    void session.contextUsage().then((usage) => { if (usage) send({ type: "event", event: { type: "context", usage } }); });

    socket.on("message", (raw: Buffer) => {
      let frame: GuiClientFrame;
      try { frame = JSON.parse(raw.toString()) as GuiClientFrame; } catch { return; }
      if (frame.type === "ping") { send({ type: "pong" }); return; }
      if (locked) return;

      switch (frame.type) {
        case "prompt": session.prompt(String(frame.text ?? ""), frame.images); break;
        case "interrupt": void session.interrupt(); break;
        case "approve": session.resolveApproval(String(frame.id), frame.decision); break;
        case "answer": session.resolveQuestion(String(frame.id), frame.answers ?? {}); break;
        case "rewind":
          // The refusal is the interesting half: a rewind computed against a transcript that has
          // moved on would cut the conversation somewhere the user didn't point at, so it fails
          // loudly into the chat's error strip rather than silently doing something else.
          void session
            .rewind({
              userTurnsAfter: Number(frame.userTurnsAfter),
              text: String(frame.text ?? ""),
              ...(typeof frame.newText === "string" ? { newText: frame.newText } : {}),
              restoreFiles: frame.restoreFiles === true,
            })
            .then((result) => { if (!result.ok) send({ type: "event", event: { type: "error", message: result.error } }); });
          break;
        case "rewind.preview":
          // Read-only: the chat asks this the moment "undo file changes" is ticked, so the number of
          // files about to be reverted — and deleted — is on screen before anything is pressed.
          void session
            .previewRewind({ userTurnsAfter: Number(frame.userTurnsAfter), text: String(frame.text ?? "") })
            .then((preview) => { send({ type: "event", event: { type: "rewind.preview", preview } }); })
            .catch(() => {});
          break;
        default: break;
      }
    });

    socket.on("close", () => {
      stopHeartbeat();
      unsubscribe();
    });
  });

  // The agent children are ours; a shutdown must not orphan them.
  app.addHook("onClose", async () => { await ctx.gui.stopAll(); });
}
