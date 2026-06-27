import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";

// Timesheet entries (Harvest-style tracker). Server-backed so a terminal agent can start/stop a job
// on loopback with one curl — no setup step, since start auto-adds unknown client/project/task names
// to the catalog (see store.startTimeEntry):
//   curl -sX POST localhost:8189/api/time/start -H 'content-type: application/json' \
//     -d '{"client":"National Disability Alliance","project":"NDA Brain","task":"Programming"}'
//   curl -sX POST localhost:8189/api/time/stop  -H 'content-type: application/json' -d '{"id":"te_..."}'
//   # stop fallbacks: {"client":"…"} stops every running timer for that client; {} stops the latest.
// Duration is derived client-side from startedAt/stoppedAt (stoppedAt null = running) — never stored.

// Default range when the client omits from/to: local midnight today → next local midnight.
function todayRange(): { from: number; to: number } {
  const d = new Date();
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return { from, to: from + 86_400_000 };
}

export async function timeRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/time/entries", async (req) => {
    const q = req.query as { from?: string; to?: string };
    const def = todayRange();
    const from = q.from !== undefined ? Number(q.from) : def.from;
    const to = q.to !== undefined ? Number(q.to) : def.to;
    return { entries: ctx.store.listTimeEntries(from, to) };
  });

  app.post("/api/time/start", async (req, reply) => {
    const b = z.object({
      client: z.string().min(1),
      project: z.string().optional(),
      task: z.string().optional(),
      notes: z.string().optional(),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    return { entry: ctx.store.startTimeEntry(b.data) };
  });

  app.post("/api/time/stop", async (req, reply) => {
    const b = z.object({ id: z.string().optional(), client: z.string().optional() }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    if (b.data.id && !ctx.store.getTimeEntry(b.data.id)) return reply.code(404).send({ error: "not found" });
    const entries = ctx.store.stopTimeEntry({ id: b.data.id, client: b.data.client, now: Date.now() });
    return { entries, entry: entries[0] ?? null };
  });

  // Manual add (forgotten time): caller supplies startedAt (+ optional stoppedAt).
  app.post("/api/time/entries", async (req, reply) => {
    const b = z.object({
      client: z.string().min(1),
      project: z.string().optional(),
      task: z.string().optional(),
      notes: z.string().optional(),
      startedAt: z.number(),
      stoppedAt: z.number().nullable().optional(),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    return { entry: ctx.store.createTimeEntry(b.data) };
  });

  app.patch("/api/time/entries/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getTimeEntry(id)) return reply.code(404).send({ error: "not found" });
    const b = z.object({
      client: z.string().optional(),
      project: z.string().optional(),
      task: z.string().optional(),
      notes: z.string().optional(),
      startedAt: z.number().optional(),
      stoppedAt: z.number().nullable().optional(), // null re-opens a stopped entry
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const patch: Record<string, unknown> = {};
    for (const k of ["client", "project", "task", "notes", "startedAt", "stoppedAt"] as const) {
      if (b.data[k] !== undefined) patch[k] = b.data[k];
    }
    return { entry: ctx.store.updateTimeEntry(id, patch as any) };
  });

  app.delete("/api/time/entries/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getTimeEntry(id)) return reply.code(404).send({ error: "not found" });
    ctx.store.deleteTimeEntry(id);
    return { ok: true };
  });
}
