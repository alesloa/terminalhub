import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { detectBuiltins } from "../agents/registry.js";
import { headroomStatus, headroomSavings } from "../agents/headroom.js";
import { commandPresets } from "../agents/presets.js";

const MAX_ICON_BYTES = 256 * 1024; // 256 KiB cap on an uploaded icon data URL

export async function agentRoutes(app: FastifyInstance, ctx: AppContext) {
  // Built-in registry (with $PATH detection) + the user's saved commands: the shared ones, plus the
  // asking workspace's own when `workspaceId` is given.
  app.get("/api/agents", async (req) => {
    const workspaceId = (req.query as { workspaceId?: string } | undefined)?.workspaceId;
    return {
      builtin: detectBuiltins(),
      custom: ctx.store.listCustomAgents(workspaceId ?? null),
    };
  });

  // Ready-made launch commands for a workspace: the scripts its own package.json defines (run through
  // the package manager its lockfile names), plus the usual suspects it doesn't define.
  app.get("/api/agents/presets", async (req, reply) => {
    const q = z.object({ workspaceId: z.string().min(1) }).safeParse(req.query ?? {});
    if (!q.success) return reply.code(400).send({ error: "workspaceId required" });
    const ws = ctx.store.getWorkspace(q.data.workspaceId);
    if (!ws) return reply.code(404).send({ error: "workspace not found" });
    return { presets: await commandPresets(ws.folder) };
  });

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
      // Which workspace owns it. Absent/null = shared by every workspace, which is what every command
      // saved before scoping existed was.
      workspaceId: z.string().min(1).nullable().optional(),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const category = b.data.category && b.data.category.toLowerCase() !== "detected agents" ? b.data.category : "Other";
    const workspaceId = b.data.workspaceId ?? null;
    if (workspaceId && !ctx.store.getWorkspace(workspaceId)) return reply.code(404).send({ error: "workspace not found" });
    const agent = ctx.store.createCustomAgent({
      name: b.data.name, command: b.data.command, icon: b.data.icon ?? null, category, workspaceId,
    });
    return { agent };
  });

  app.delete("/api/agents/:id", async (req) => {
    ctx.store.deleteCustomAgent((req.params as any).id as string);
    return { ok: true };
  });
}
