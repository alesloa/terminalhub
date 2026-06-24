import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";

const MB = 1024 * 1024;
const MAX_IMAGE_BYTES = 12 * MB; // decoded cap per uploaded wallpaper

// User-uploaded canvas wallpapers. The image bytes are stored as a data URL in the DB (like
// custom-agent icons) so they serve back through the authed API and work as a CSS background even
// over a tunnel — built-in wallpapers ship as static assets and aren't handled here.
export async function wallpaperRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/wallpapers", async () => ({ wallpapers: ctx.store.listWallpapers() }));

  app.get("/api/wallpapers/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    const wp = ctx.store.getWallpaper(id);
    if (!wp) return reply.code(404).send({ error: "not found" });
    return { wallpaper: wp };
  });

  // bodyLimit lifted past the decoded cap to leave room for base64's ~33% inflation + the JSON envelope.
  app.post("/api/wallpapers", { bodyLimit: 20 * MB }, async (req, reply) => {
    const b = z.object({
      name: z.string().min(1).max(120),
      mimeType: z.string().regex(/^image\//, "must be an image"),
      dataBase64: z.string().min(1),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    if (Buffer.byteLength(b.data.dataBase64, "base64") > MAX_IMAGE_BYTES) return reply.code(413).send({ error: "image too large" });
    const wallpaper = ctx.store.createWallpaper({ name: b.data.name, dataUrl: `data:${b.data.mimeType};base64,${b.data.dataBase64}` });
    return { wallpaper };
  });

  app.delete("/api/wallpapers/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getWallpaper(id)) return reply.code(404).send({ error: "not found" });
    ctx.store.deleteWallpaper(id);
    return { ok: true };
  });
}
