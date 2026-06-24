import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { codexUsage } from "../codex/meter.js";
import { decorateUsage } from "../meters/decorate.js";

// The Codex usage meter widget. Returns the current rate-limit utilization (5h + weekly) read from the
// host's Codex CLI app-server, decorated with the same forward-looking pacing payload as the Claude
// meter (server/src/meters), or { available:false } when Codex isn't installed/logged in here. The raw
// poll is cached + single-flight server-side (createCodexUsageProvider) so many tabs share one spawn;
// the pace is computed per request off the persisted daily baseline (ctx.store). Mirrors claudeUsage.ts.
export async function codexUsageRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/codex-usage", async (req) => {
    const force = (req.query as Record<string, string | undefined>)?.force === "1";
    return decorateUsage("codex", await codexUsage.get(force), ctx.store);
  });
}
