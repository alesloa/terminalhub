import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { canvasBackground } from "./settings.js";
import { normalizeSpaceConfig } from "../spaces/types.js";
import { listSpaceCatalog } from "../spaces/catalog.js";
import { seedSpace } from "../spaces/seedSpace.js";

// A space's wizard config arrives as a loose object; normalizeSpaceConfig coerces it into a valid
// SpaceConfig (dropping anything malformed), so the route only needs to gate "object or null".
const spaceConfig = z.record(z.string(), z.unknown());

export async function spaceRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/spaces", async () => ({
    spaces: ctx.store.listSpaces(),
    homeSpaceId: ctx.store.getHomeSpaceId() ?? null,
    desktopWorkspaceId: ctx.store.getDesktopWorkspaceId() ?? null,
  }));

  app.post("/api/spaces", async (req, reply) => {
    const b = z.object({
      name: z.string().min(1),
      icon: z.string().nullable().optional(),
      color: z.string().nullable().optional(),
      config: spaceConfig.nullable().optional(),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const space = ctx.store.createSpace({
      name: b.data.name, icon: b.data.icon ?? null, color: b.data.color ?? null,
      config: b.data.config ? normalizeSpaceConfig(b.data.config) : null,
    });
    return { space };
  });

  app.patch("/api/spaces/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getSpace(id)) return reply.code(404).send({ error: "not found" });
    const b = z.object({
      name: z.string().min(1).optional(),
      icon: z.string().nullable().optional(),
      color: z.string().nullable().optional(),
      background: canvasBackground.nullable().optional(), // object = set override; null = inherit global
      config: spaceConfig.nullable().optional(),          // object = set wizard config; null = clear it
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const { config, ...rest } = b.data;
    const patch = "config" in b.data ? { ...rest, config: config ? normalizeSpaceConfig(config) : null } : rest;
    ctx.store.updateSpace(id, patch);
    return { space: ctx.store.getSpace(id) };
  });

  // The wizard's pickable lists: the user's GLOBAL skills / slash commands / MCP servers. Empty
  // arrays when nothing is configured globally (the UI shows an empty state — never fake cards).
  app.get("/api/space-catalog", async () => listSpaceCatalog());

  // Re-apply a space's config to every workspace already in it (the "apply now" after create/edit).
  // Returns what landed per workspace so the UI can show a "relaunch terminals to apply" notice.
  app.post("/api/spaces/:id/seed", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getSpace(id)) return reply.code(404).send({ error: "not found" });
    return { results: await seedSpace(ctx.store, id) };
  });

  app.post("/api/spaces/:id/move", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getSpace(id)) return reply.code(404).send({ error: "not found" });
    const b = z.object({ index: z.number().int().min(0) }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    ctx.store.moveSpace(id, b.data.index);
    return { ok: true };
  });

  // Never deletes workspaces: deleteSpace reassigns them to the adjacent space. Refused (400) on the
  // Home space or the last remaining space.
  app.delete("/api/spaces/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getSpace(id)) return reply.code(404).send({ error: "not found" });
    if (!ctx.store.deleteSpace(id)) return reply.code(400).send({ error: "cannot delete the home or last space" });
    return { ok: true };
  });
}
