import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";

// Scratchpad notes: plain-text notes the user jots in the Notes panel. Notes are small, so the list
// returns full content (no separate get-by-id, unlike blueprints' heavy graph). Newest-edited first.
export async function notesRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/notes", async () => ({ notes: ctx.store.listNotes() }));

  app.post("/api/notes", async (req, reply) => {
    const b = z.object({
      title: z.string().default(""),
      content: z.string().default(""),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const note = ctx.store.createNote({ title: b.data.title, content: b.data.content });
    return { note };
  });

  app.patch("/api/notes/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getNote(id)) return reply.code(404).send({ error: "not found" });
    const b = z.object({
      title: z.string().optional(),
      content: z.string().optional(),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    ctx.store.updateNote(id, {
      ...(b.data.title !== undefined ? { title: b.data.title } : {}),
      ...(b.data.content !== undefined ? { content: b.data.content } : {}),
    });
    return { note: ctx.store.getNote(id)! };
  });

  app.delete("/api/notes/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getNote(id)) return reply.code(404).send({ error: "not found" });
    ctx.store.deleteNote(id);
    return { ok: true };
  });
}
