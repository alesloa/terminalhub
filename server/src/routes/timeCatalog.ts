import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";

// Timesheet catalog: the clients / projects / task-types that populate the panel's dropdowns and are
// managed in its Settings tab. Separate from time.ts (entries) so each file stays one responsibility.
// Entries store names, not ids, so editing/deleting here never rewrites history — see db/schema.sql.
export async function timeCatalogRoutes(app: FastifyInstance, ctx: AppContext) {
  const catPatch = z.object({ name: z.string().optional(), archived: z.boolean().optional(), position: z.number().optional() });

  // ── Clients ──────────────────────────────────────────────────────────────────────────────────
  app.get("/api/time/clients", async () => ({ clients: ctx.store.listTimeClients() }));
  app.post("/api/time/clients", async (req, reply) => {
    const b = z.object({ name: z.string().min(1) }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    return { client: ctx.store.createTimeClient(b.data.name) };
  });
  app.patch("/api/time/clients/:id", async (req, reply) => {
    const b = catPatch.safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const client = ctx.store.updateTimeClient((req.params as any).id, b.data);
    if (!client) return reply.code(404).send({ error: "not found" });
    return { client };
  });
  app.delete("/api/time/clients/:id", async (req) => {
    ctx.store.deleteTimeClient((req.params as any).id);
    return { ok: true };
  });

  // ── Projects (scoped to a client) ──────────────────────────────────────────────────────────────
  app.get("/api/time/projects", async (req) => {
    const clientId = (req.query as { clientId?: string }).clientId;
    return { projects: ctx.store.listTimeProjects(clientId) };
  });
  app.post("/api/time/projects", async (req, reply) => {
    const b = z.object({ clientId: z.string().min(1), name: z.string().min(1) }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    return { project: ctx.store.createTimeProject(b.data.clientId, b.data.name) };
  });
  app.patch("/api/time/projects/:id", async (req, reply) => {
    const b = catPatch.safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const project = ctx.store.updateTimeProject((req.params as any).id, b.data);
    if (!project) return reply.code(404).send({ error: "not found" });
    return { project };
  });
  app.delete("/api/time/projects/:id", async (req) => {
    ctx.store.deleteTimeProject((req.params as any).id);
    return { ok: true };
  });

  // ── Task types ─────────────────────────────────────────────────────────────────────────────────
  app.get("/api/time/tasks", async () => ({ tasks: ctx.store.listTimeTasks() }));
  app.post("/api/time/tasks", async (req, reply) => {
    const b = z.object({ name: z.string().min(1) }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    return { task: ctx.store.createTimeTask(b.data.name) };
  });
  app.patch("/api/time/tasks/:id", async (req, reply) => {
    const b = catPatch.safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const task = ctx.store.updateTimeTask((req.params as any).id, b.data);
    if (!task) return reply.code(404).send({ error: "not found" });
    return { task };
  });
  app.delete("/api/time/tasks/:id", async (req) => {
    ctx.store.deleteTimeTask((req.params as any).id);
    return { ok: true };
  });
}
