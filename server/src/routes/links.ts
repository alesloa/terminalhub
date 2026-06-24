import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";

// Web links ("important websites") and their folders — the top-bar Links dropdown. One GET returns
// both lists; the UI groups links under folders client-side. Reorder/move (drag or up/down) goes
// through the bulk `PUT .../order` endpoints, which assign each item its new folder + sort position.
export async function linksRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/links", async () => ({ links: ctx.store.listLinks(), folders: ctx.store.listLinkFolders() }));

  app.post("/api/links", async (req, reply) => {
    const b = z.object({
      title: z.string().default(""),
      url: z.string().default(""),
      description: z.string().default(""),
      folderId: z.string().nullable().default(null),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const link = ctx.store.createLink(b.data);
    return { link };
  });

  app.patch("/api/links/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getLink(id)) return reply.code(404).send({ error: "not found" });
    const b = z.object({
      title: z.string().optional(),
      url: z.string().optional(),
      description: z.string().optional(),
      folderId: z.string().nullable().optional(),
      color: z.string().nullable().optional(),
      sort: z.number().optional(),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const link = ctx.store.updateLink(id, b.data);
    return { link };
  });

  app.delete("/api/links/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getLink(id)) return reply.code(404).send({ error: "not found" });
    ctx.store.deleteLink(id);
    return { ok: true };
  });

  // Bulk reorder / re-home after a drag or move. Each item carries its new folderId + sort.
  app.put("/api/links/order", async (req, reply) => {
    const b = z.object({
      items: z.array(z.object({ id: z.string(), folderId: z.string().nullable(), sort: z.number() })),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    ctx.store.reorderLinks(b.data.items);
    return { ok: true };
  });

  app.post("/api/link-folders", async (req, reply) => {
    const b = z.object({ name: z.string().default("") }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const folder = ctx.store.createLinkFolder(b.data);
    return { folder };
  });

  app.patch("/api/link-folders/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getLinkFolder(id)) return reply.code(404).send({ error: "not found" });
    const b = z.object({ name: z.string().optional(), color: z.string().nullable().optional(), sort: z.number().optional() }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const folder = ctx.store.updateLinkFolder(id, b.data);
    return { folder };
  });

  app.delete("/api/link-folders/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getLinkFolder(id)) return reply.code(404).send({ error: "not found" });
    ctx.store.deleteLinkFolder(id);
    return { ok: true };
  });

  app.put("/api/link-folders/order", async (req, reply) => {
    const b = z.object({ items: z.array(z.object({ id: z.string(), sort: z.number() })) }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    ctx.store.reorderLinkFolders(b.data.items);
    return { ok: true };
  });
}
