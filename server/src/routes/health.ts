import type { FastifyInstance } from "fastify";

const startedAt = Date.now();

export async function healthRoutes(app: FastifyInstance) {
  app.get("/api/health", async () => ({
    ok: true,
    version: "0.1.0",
    uptimeMs: Date.now() - startedAt,
  }));
}
