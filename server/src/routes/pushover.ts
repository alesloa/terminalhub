import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";

// Pushover validation + quota. The keys themselves live in settings (write-only, see routes/settings)
// — these endpoints let the Settings UI verify them and show monthly usage without leaking them.
export async function pushoverRoutes(app: FastifyInstance, ctx: AppContext) {
  // Validate the configured token/user against Pushover. Used by the Settings "Test" button — it
  // confirms the keys without sending a real push.
  app.post("/api/pushover/test", async () => {
    const r = await ctx.pushover.validate();
    return { ok: r.ok, errors: r.errors };
  });

  // Monthly message usage, for the notification center's quota readout. Polls Pushover's limits
  // endpoint (no message burned). `configured:false` when no keys are set — never faked.
  app.get("/api/pushover/quota", async () => {
    if (!ctx.pushover.isConfigured()) return { configured: false, quota: null };
    return { configured: true, quota: await ctx.pushover.quota() };
  });
}
