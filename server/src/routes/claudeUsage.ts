import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { claudeUsage } from "../claude/meter.js";
import { decorateUsage } from "../meters/decorate.js";

// The Claude usage meter widget. Returns the current rate-limit utilization (5h + 7d) read from the
// host's Claude Code token, decorated with the forward-looking pacing payload (today's budget, week
// posture — see server/src/meters), or { available:false } when Claude Code isn't logged in here.
// The raw poll is cached + single-flight server-side (createClaudeUsageProvider) so many tabs share
// one poll; the pace is computed per request off the persisted daily baseline (ctx.store).
export async function claudeUsageRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/claude-usage", async (req) => {
    const force = (req.query as Record<string, string | undefined>)?.force === "1";
    return decorateUsage("claude", await claudeUsage.get(force), ctx.store);
  });
}
