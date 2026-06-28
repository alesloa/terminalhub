import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";

// Note groups: Mac-Notes-style collections for the Notes scratchpad, shown in the panel's left rail.
// A note with groupId = NULL is ungrouped. Deleting a group re-homes its notes to NULL (the notes
// survive — same non-destructive behavior as deleting a link folder). Mirrors the link-folders routes.
export async function noteGroupsRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/note-groups", async () => ({ groups: ctx.store.listNoteGroups() }));

  app.post("/api/note-groups", async (req, reply) => {
    const b = z.object({ name: z.string().default("") }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    return { group: ctx.store.createNoteGroup({ name: b.data.name }) };
  });

  app.patch("/api/note-groups/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getNoteGroup(id)) return reply.code(404).send({ error: "not found" });
    const b = z.object({
      name: z.string().optional(),
      color: z.string().nullable().optional(),
      sort: z.number().optional(),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const p = b.data;
    const group = ctx.store.updateNoteGroup(id, {
      ...(p.name !== undefined ? { name: p.name } : {}),
      ...(p.color !== undefined ? { color: p.color } : {}),
      ...(p.sort !== undefined ? { sort: p.sort } : {}),
    });
    return { group: group! };
  });

  app.delete("/api/note-groups/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getNoteGroup(id)) return reply.code(404).send({ error: "not found" });
    ctx.store.deleteNoteGroup(id);
    return { ok: true };
  });
}
