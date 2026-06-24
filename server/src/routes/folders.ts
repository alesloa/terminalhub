import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";

// Canvas folders: iPhone-style groups of workspace cards on a space's canvas. A folder holds the
// group's name + canvas position; its members carry workspaces.folderId (patched via the workspaces
// route). `POST` can seed members in one shot — the drag-to-group / multi-select-group gesture.
// `DELETE` dissolves the folder (members return to the canvas). Mirrors the sticky-notes routes.
export async function folderRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/folders", async () => ({ folders: ctx.store.listFolders() }));

  app.post("/api/folders", async (req, reply) => {
    const b = z.object({
      spaceId: z.string().nullish(),
      name: z.string().default(""),
      x: z.number(),
      y: z.number(),
      memberIds: z.array(z.string()).optional(),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const folder = ctx.store.createFolder({
      spaceId: b.data.spaceId ?? null,
      name: b.data.name,
      x: b.data.x, y: b.data.y,
      memberIds: b.data.memberIds,
    });
    return { folder };
  });

  app.patch("/api/folders/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getFolder(id)) return reply.code(404).send({ error: "not found" });
    const b = z.object({
      spaceId: z.string().nullable().optional(),
      name: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const p = b.data;
    ctx.store.updateFolder(id, {
      ...(p.spaceId !== undefined ? { spaceId: p.spaceId } : {}),
      ...(p.name !== undefined ? { name: p.name } : {}),
      ...(p.x !== undefined ? { x: p.x } : {}),
      ...(p.y !== undefined ? { y: p.y } : {}),
    });
    return { folder: ctx.store.getFolder(id)! };
  });

  app.delete("/api/folders/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getFolder(id)) return reply.code(404).send({ error: "not found" });
    ctx.store.deleteFolder(id);
    return { ok: true };
  });
}
