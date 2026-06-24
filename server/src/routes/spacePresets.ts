import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { normalizeSpaceConfig } from "../spaces/types.js";

// Space presets: reusable named templates (a saved COPY of a SpaceConfig). The config arrives as a
// loose object and is normalized into a valid SpaceConfig before storage.
const spaceConfig = z.record(z.string(), z.unknown());

export async function spacePresetRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/space-presets", async () => ({ presets: ctx.store.listSpacePresets() }));

  app.post("/api/space-presets", async (req, reply) => {
    const b = z.object({
      name: z.string().min(1),
      icon: z.string().nullable().optional(),
      config: spaceConfig,
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const preset = ctx.store.createSpacePreset({
      name: b.data.name, icon: b.data.icon ?? null, config: normalizeSpaceConfig(b.data.config),
    });
    return { preset };
  });

  app.patch("/api/space-presets/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getSpacePreset(id)) return reply.code(404).send({ error: "not found" });
    const b = z.object({
      name: z.string().min(1).optional(),
      icon: z.string().nullable().optional(),
      config: spaceConfig.optional(),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const { config, ...rest } = b.data;
    const preset = ctx.store.updateSpacePreset(id, config ? { ...rest, config: normalizeSpaceConfig(config) } : rest);
    return { preset };
  });

  app.delete("/api/space-presets/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getSpacePreset(id)) return reply.code(404).send({ error: "not found" });
    ctx.store.deleteSpacePreset(id);
    return { ok: true };
  });
}
