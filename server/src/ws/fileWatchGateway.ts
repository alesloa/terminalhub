import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { authorizeWs } from "./wsAuth.js";
import type { Config } from "../config.js";
import { watchFile } from "../fs/watchFile.js";

// Live disk-change stream for the File Browser's editor. The browser opens one socket per open host
// file; whenever that file's bytes change on disk (an agent writes to it, an external edit, a save
// from elsewhere) the server pushes a `changed` frame and the editor refetches + reloads its buffer.
// Host-only — Drive files have no filesystem to watch. No new exposure: it watches a path the client
// can already read through /api/fs/file, behind the same auth guard.
export async function fileWatchGateway(app: FastifyInstance, ctx: AppContext, config: Config) {
  app.get("/ws/fs-watch", { websocket: true }, (socket, req) => {
    // auth on the upgrade request — identical pattern to terminalGateway
    const url = new URL(req.url, "http://localhost");
    if (!authorizeWs(ctx, config, socket, req, url.searchParams.get("token"))) return;

    const filePath = url.searchParams.get("path");
    if (!filePath) { socket.close(1011, "path required"); return; }

    const stop = watchFile(filePath, (change) => {
      if (socket.readyState !== socket.OPEN) return;
      socket.send(JSON.stringify(
        change.exists
          ? { type: "changed", path: filePath, mtimeMs: change.mtimeMs, size: change.size }
          : { type: "removed", path: filePath },
      ));
    });

    socket.on("message", (raw: Buffer) => {
      // Keepalive only: client pings every ~25s so idle proxies/tunnels don't reap the socket.
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "ping" && socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: "pong" }));
      } catch { /* ignore malformed frames */ }
    });

    socket.on("close", () => stop());
  });
}
