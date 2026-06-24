import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";

// Canvas widgets: typed cards dropped onto a space's canvas (Claude meter, world clock, etc.). Like
// sticky notes but selected by `kind`; `config` is opaque per-instance JSON. x/y/w/h are canvas
// geometry, required on create. Mirrors the sticky-notes routes.
const KIND = z.enum(["claude-meter", "codex-meter", "world-clock", "agent-activity", "today", "headroom-savings"]);

export async function spaceWidgetsRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/space-widgets", async () => ({ spaceWidgets: ctx.store.listSpaceWidgets() }));

  app.post("/api/space-widgets", async (req, reply) => {
    const b = z.object({
      spaceId: z.string().nullish(),
      kind: KIND,
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
      config: z.record(z.unknown()).nullish(),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const widget = ctx.store.createSpaceWidget({
      spaceId: b.data.spaceId ?? null,
      kind: b.data.kind,
      x: b.data.x, y: b.data.y, w: b.data.w, h: b.data.h,
      config: b.data.config ?? null,
    });
    return { spaceWidget: widget };
  });

  app.patch("/api/space-widgets/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getSpaceWidget(id)) return reply.code(404).send({ error: "not found" });
    const b = z.object({
      spaceId: z.string().nullable().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      w: z.number().optional(),
      h: z.number().optional(),
      config: z.record(z.unknown()).nullable().optional(),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const p = b.data;
    ctx.store.updateSpaceWidget(id, {
      ...(p.spaceId !== undefined ? { spaceId: p.spaceId } : {}),
      ...(p.x !== undefined ? { x: p.x } : {}),
      ...(p.y !== undefined ? { y: p.y } : {}),
      ...(p.w !== undefined ? { w: p.w } : {}),
      ...(p.h !== undefined ? { h: p.h } : {}),
      ...(p.config !== undefined ? { config: p.config } : {}),
    });
    return { spaceWidget: ctx.store.getSpaceWidget(id)! };
  });

  app.delete("/api/space-widgets/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getSpaceWidget(id)) return reply.code(404).send({ error: "not found" });
    ctx.store.deleteSpaceWidget(id);
    return { ok: true };
  });
}
