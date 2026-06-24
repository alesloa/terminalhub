import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";

// Canvas sticky notes: quick throwaway post-its pinned to a space's canvas. Small, so the list
// returns full rows (no get-by-id). x/y/w/h are viewport-pixel geometry; `pinned` floats the note
// above an open workspace room. Mirrors the notes routes; geometry is required on create.
export async function stickyNotesRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/sticky-notes", async () => ({ stickyNotes: ctx.store.listStickyNotes() }));

  app.post("/api/sticky-notes", async (req, reply) => {
    const b = z.object({
      spaceId: z.string().nullish(),
      content: z.string().default(""),
      color: z.string().nullish(),
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const note = ctx.store.createStickyNote({
      spaceId: b.data.spaceId ?? null,
      content: b.data.content,
      color: b.data.color ?? null,
      x: b.data.x, y: b.data.y, w: b.data.w, h: b.data.h,
    });
    return { stickyNote: note };
  });

  app.patch("/api/sticky-notes/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getStickyNote(id)) return reply.code(404).send({ error: "not found" });
    const b = z.object({
      spaceId: z.string().nullable().optional(),
      content: z.string().optional(),
      color: z.string().nullable().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      w: z.number().optional(),
      h: z.number().optional(),
      pinned: z.boolean().optional(),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const p = b.data;
    ctx.store.updateStickyNote(id, {
      ...(p.spaceId !== undefined ? { spaceId: p.spaceId } : {}),
      ...(p.content !== undefined ? { content: p.content } : {}),
      ...(p.color !== undefined ? { color: p.color } : {}),
      ...(p.x !== undefined ? { x: p.x } : {}),
      ...(p.y !== undefined ? { y: p.y } : {}),
      ...(p.w !== undefined ? { w: p.w } : {}),
      ...(p.h !== undefined ? { h: p.h } : {}),
      ...(p.pinned !== undefined ? { pinned: p.pinned } : {}),
    });
    return { stickyNote: ctx.store.getStickyNote(id)! };
  });

  app.delete("/api/sticky-notes/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getStickyNote(id)) return reply.code(404).send({ error: "not found" });
    ctx.store.deleteStickyNote(id);
    return { ok: true };
  });
}
