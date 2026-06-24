import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { authorizeWs } from "./wsAuth.js";
import type { Config } from "../config.js";

// One-way push channel: every open dashboard connects here and receives notification frames
// (new notification / removed / changed) from the ctx.notify bus. The notifications themselves are
// persisted (the notifications table) — these frames are the live sync layer on top: toasts, and
// keeping every open browser's notification center consistent. Auth on the upgrade mirrors the other
// gateways — loopback relaxed, exposed needs the token (so a tunnel visitor can't spam your toasts).
export async function notificationGateway(app: FastifyInstance, ctx: AppContext, config: Config) {
  app.get("/ws/notifications", { websocket: true }, (socket, req) => {
    const url = new URL(req.url, "http://localhost");
    if (!authorizeWs(ctx, config, socket, req, url.searchParams.get("token"))) return;

    const unsubscribe = ctx.notify.subscribe((frame) => {
      if (socket.readyState !== socket.OPEN) return;
      try { socket.send(JSON.stringify(frame)); } catch { /* dropped frame */ }
    });
    socket.on("close", unsubscribe);
  });
}
