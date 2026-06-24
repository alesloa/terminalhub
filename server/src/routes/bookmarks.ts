import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";

export async function bookmarkRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/workspaces/:id/bookmarks", async (req, reply) => {
    const ws = ctx.store.getWorkspace((req.params as any).id);
    if (!ws) return reply.code(404).send({ error: "workspace not found" });
    return { bookmarks: ctx.store.listBookmarks(ws.folder) };
  });

  app.post("/api/workspaces/:id/bookmarks", async (req, reply) => {
    const ws = ctx.store.getWorkspace((req.params as any).id);
    if (!ws) return reply.code(404).send({ error: "workspace not found" });
    const b = z.object({
      filePath: z.string().min(1),
      line: z.number().int().positive(),
      label: z.string().nullable().optional(),
      preview: z.string().nullable().optional(),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const bookmark = ctx.store.createBookmark({
      folder: ws.folder,
      filePath: b.data.filePath,
      line: b.data.line,
      label: b.data.label ?? null,
      preview: b.data.preview ?? null,
    });
    return { bookmark };
  });

  app.patch("/api/bookmarks/:bookmarkId", async (req, reply) => {
    const id = (req.params as any).bookmarkId as string;
    if (!ctx.store.getBookmark(id)) return reply.code(404).send({ error: "not found" });
    const b = z.object({
      label: z.string().nullable().optional(),
      line: z.number().int().positive().optional(),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    if ("label" in b.data) ctx.store.updateBookmark(id, { label: b.data.label ?? null });
    if (b.data.line !== undefined) ctx.store.updateBookmarkLine(id, b.data.line);
    return { bookmark: ctx.store.getBookmark(id) };
  });

  app.delete("/api/bookmarks/:bookmarkId", async (req, reply) => {
    const id = (req.params as any).bookmarkId as string;
    if (!ctx.store.getBookmark(id)) return reply.code(404).send({ error: "not found" });
    ctx.store.deleteBookmark(id);
    return { ok: true };
  });

  // Clear one file (?filePath=…) or, with no query, every bookmark in the workspace.
  app.delete("/api/workspaces/:id/bookmarks", async (req, reply) => {
    const ws = ctx.store.getWorkspace((req.params as any).id);
    if (!ws) return reply.code(404).send({ error: "workspace not found" });
    const filePath = (req.query as any)?.filePath as string | undefined;
    if (filePath) ctx.store.clearFileBookmarks(ws.folder, filePath);
    else ctx.store.clearFolderBookmarks(ws.folder);
    return { ok: true };
  });
}
