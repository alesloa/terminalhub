import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";

export async function favoritesRoutes(app: FastifyInstance, ctx: AppContext) {
  // The whole tree as flat arrays; the web client assembles the hierarchy from parentId/groupId.
  app.get("/api/favorites", async () => ({
    groups: ctx.store.listFavoriteGroups(),
    favorites: ctx.store.listFavorites(),
  }));

  app.post("/api/favorites/groups", async (req, reply) => {
    const b = z.object({
      name: z.string().min(1),
      parentId: z.string().nullable().optional(),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const group = ctx.store.createFavoriteGroup({ name: b.data.name, parentId: b.data.parentId ?? null });
    return { group };
  });

  app.patch("/api/favorites/groups/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getFavoriteGroup(id)) return reply.code(404).send({ error: "not found" });
    const b = z.object({ name: z.string().min(1) }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    ctx.store.renameFavoriteGroup(id, b.data.name);
    return { group: ctx.store.getFavoriteGroup(id) };
  });

  // ?reassignTo=root → loose to root; ?reassignTo=<groupId> → into that group; omitted → cascade-delete.
  app.delete("/api/favorites/groups/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getFavoriteGroup(id)) return reply.code(404).send({ error: "not found" });
    const raw = (req.query as any)?.reassignTo as string | undefined;
    if (raw === undefined) ctx.store.deleteFavoriteGroup(id);
    else ctx.store.deleteFavoriteGroup(id, raw === "root" ? null : raw);
    return { ok: true };
  });

  app.post("/api/favorites", async (req, reply) => {
    const b = z.object({
      folder: z.string().min(1),
      label: z.string().nullable().optional(),
      groupId: z.string().nullable().optional(),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const groupId = b.data.groupId ?? null;
    const created = ctx.store.createFavorite({ folder: b.data.folder, label: b.data.label ?? null, groupId });
    // Idempotent: adding a folder already in this bucket returns the existing favorite.
    const favorite = created ?? ctx.store.listFavorites().find(f => f.groupId === groupId && f.folder === b.data.folder);
    return { favorite };
  });

  app.patch("/api/favorites/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getFavorite(id)) return reply.code(404).send({ error: "not found" });
    const b = z.object({ label: z.string().nullable().optional() }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    if ("label" in b.data) ctx.store.renameFavorite(id, b.data.label ?? null);
    return { favorite: ctx.store.getFavorite(id) };
  });

  app.delete("/api/favorites/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getFavorite(id)) return reply.code(404).send({ error: "not found" });
    ctx.store.deleteFavorite(id);
    return { ok: true };
  });

  // Single endpoint for every drag result: reparent + insert at an index. For a group, a
  // cyclic target (into itself or a descendant) is rejected 400.
  app.post("/api/favorites/move", async (req, reply) => {
    const b = z.object({
      kind: z.enum(["favorite", "group"]),
      id: z.string().min(1),
      targetParentId: z.string().nullable(),
      index: z.number().int().min(0),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    if (b.data.kind === "favorite") {
      if (!ctx.store.getFavorite(b.data.id)) return reply.code(404).send({ error: "not found" });
      ctx.store.moveFavorite(b.data.id, b.data.targetParentId, b.data.index);
      return { ok: true };
    }
    if (!ctx.store.getFavoriteGroup(b.data.id)) return reply.code(404).send({ error: "not found" });
    const ok = ctx.store.moveFavoriteGroup(b.data.id, b.data.targetParentId, b.data.index);
    if (!ok) return reply.code(400).send({ error: "invalid move" });
    return { ok: true };
  });
}
