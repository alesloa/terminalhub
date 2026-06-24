import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { detectBuiltins } from "../agents/registry.js";
import { headroomStatus, headroomSavings } from "../agents/headroom.js";

const MAX_ICON_BYTES = 256 * 1024; // 256 KiB cap on an uploaded icon data URL

export async function agentRoutes(app: FastifyInstance, ctx: AppContext) {
  // Built-in registry (with $PATH detection) + the user's saved custom agents.
  app.get("/api/agents", async () => ({
    builtin: detectBuiltins(),
    custom: ctx.store.listCustomAgents(),
  }));

  // Status for the special "Claude (Headroom)" launcher: whether the headroom CLI is installed and
  // whether its compression proxy is currently answering. Kept off /api/agents so the network probe
  // never delays the main picker list.
  app.get("/api/agents/headroom", async () => headroomStatus());

  // Live compression savings for the "Headroom Savings" widget — tokens + dollars the proxy saved.
  // Reads the proxy's /stats each call (short timeout); the widget polls this on an interval.
  app.get("/api/agents/headroom/savings", async () => headroomSavings());

  app.post("/api/agents", async (req, reply) => {
    const b = z.object({
      name: z.string().trim().min(1).max(80),
      command: z.string().trim().min(1).max(500),
      icon: z.string().max(MAX_ICON_BYTES).nullable().optional(),
      // Section to file the agent under. "Detected agents" is reserved for $PATH-detected built-ins,
      // so it's coerced to "Other"; blank → "Other".
      category: z.string().trim().max(60).optional(),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const category = b.data.category && b.data.category.toLowerCase() !== "detected agents" ? b.data.category : "Other";
    const agent = ctx.store.createCustomAgent({
      name: b.data.name, command: b.data.command, icon: b.data.icon ?? null, category,
    });
    return { agent };
  });

  app.delete("/api/agents/:id", async (req) => {
    ctx.store.deleteCustomAgent((req.params as any).id as string);
    return { ok: true };
  });
}
