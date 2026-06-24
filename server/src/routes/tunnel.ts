import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import type { Principal } from "../auth/access.js";

// Owner-only control of the public Cloudflare Quick Tunnel. Starting/stopping a tunnel exposes the host
// to the internet, so — like the access-link routes — a teammate's `{kind:"key"}` principal is refused.
// The browser sends the port it's actually served from (5173 in dev, 8189 in prod) so the tunnel targets
// the layer that serves the SPA + proxies /api + /ws.
export async function tunnelRoutes(app: FastifyInstance, ctx: AppContext) {
  app.addHook("preHandler", async (req, reply) => {
    const principal = (req as { principal?: Principal }).principal;
    if (principal?.kind !== "main") return reply.code(403).send({ error: "forbidden" });
  });

  app.get("/api/tunnel", async () => ctx.tunnel.status());

  app.post("/api/tunnel", async (req, reply) => {
    const b = z.object({ port: z.number().int().min(1).max(65535) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    return ctx.tunnel.start(b.data.port);
  });

  app.delete("/api/tunnel", async () => ctx.tunnel.stop());
}
