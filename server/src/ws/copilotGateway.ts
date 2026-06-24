import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import type { Config } from "../config.js";
import { authorizeWs } from "./wsAuth.js";
import { resolveCopilotProvider, streamTurn } from "../copilot/service.js";

// Live Copilot chat channel. The browser opens one socket per open Copilot window and drives a
// conversation over it. Auth on the upgrade mirrors the other gateways (loopback relaxed, exposed
// needs the token). Protocol:
//   client→server: {type:'send', conversationId, text} | {type:'confirm', callId, approved}
//   server→client: the agent's CopilotEvent frames (token / tool_call / tool_result /
//                  confirm_request / assistant_message / final / error) plus a final {type:'done'}.
const CONFIRM_TIMEOUT_MS = 120_000;

export async function copilotGateway(app: FastifyInstance, ctx: AppContext, config: Config) {
  app.get("/ws/copilot", { websocket: true }, (socket, req) => {
    const url = new URL(req.url, "http://localhost");
    if (!authorizeWs(ctx, config, socket, req, url.searchParams.get("token"))) return;

    const send = (frame: unknown) => {
      if (socket.readyState !== socket.OPEN) return;
      try { socket.send(JSON.stringify(frame)); } catch { /* dropped frame */ }
    };
    const pendingConfirms = new Map<string, (ok: boolean) => void>();
    let busy = false;

    socket.on("message", async (raw: Buffer) => {
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg?.type === "confirm" && typeof msg.callId === "string") {
        pendingConfirms.get(msg.callId)?.(msg.approved === true);
        pendingConfirms.delete(msg.callId);
        return;
      }

      if (msg?.type === "send") {
        if (busy) { send({ type: "error", message: "Still working on the previous message." }); return; }
        const conversationId = typeof msg.conversationId === "string" ? msg.conversationId : "";
        const text = typeof msg.text === "string" ? msg.text : "";
        if (!conversationId || !ctx.store.getCopilotConversation(conversationId)) { send({ type: "error", message: "Unknown conversation." }); send({ type: "done" }); return; }
        if (!text.trim()) { send({ type: "error", message: "Empty message." }); send({ type: "done" }); return; }
        const resolved = resolveCopilotProvider(ctx);
        if ("error" in resolved) { send({ type: "error", message: resolved.error }); send({ type: "done" }); return; }

        busy = true;
        try {
          await streamTurn({
            app: ctx, provider: resolved.provider, conversationId, userText: text, actor: "user",
            onEvent: (e) => send(e),
            confirm: (call) => new Promise<boolean>((resolve) => {
              pendingConfirms.set(call.id, resolve);
              setTimeout(() => { if (pendingConfirms.delete(call.id)) resolve(false); }, CONFIRM_TIMEOUT_MS);
            }),
          });
        } catch (e) {
          send({ type: "error", message: e instanceof Error ? e.message : String(e) });
        } finally {
          busy = false;
          send({ type: "done" });
        }
      }
    });

    socket.on("close", () => { for (const r of pendingConfirms.values()) r(false); pendingConfirms.clear(); });
  });
}
