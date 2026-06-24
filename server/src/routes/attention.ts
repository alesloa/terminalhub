import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { computeAttention } from "../attention/attention.js";

export async function attentionRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/attention", async () => ({ attention: await computeAttention(ctx) }));

  // The browser pings this when an OPEN terminal's agent rings the bell while its pane isn't focused
  // (the attached-PTY case the bell-flag watcher can't see). Fires the same "needs attention" toast you
  // get when the room is closed. Deduped per-terminal server-side, so several open browsers = one toast.
  app.post("/api/terminals/:id/attention", async (req) => {
    // Optional message — an OSC-notify sequence (OSC 9 / 777) carries the agent's own text; a plain
    // bell or the silence timer sends none and falls back to the default "needs attention" toast.
    const body = (req.body ?? {}) as { message?: unknown };
    const message = typeof body.message === "string" ? body.message : undefined;
    const fired = ctx.attentionFirer.fire((req.params as any).id as string, message);
    return { ok: true, fired };
  });
}
