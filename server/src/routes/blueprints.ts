import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import type { Blueprint } from "../types.js";

// Blueprints persist the Prompt Builder's node-canvas map. The graph is OPAQUE to the server: we
// stringify it for storage and parse it back so the HTTP API speaks JSON objects, but never
// interpret node internals (the web canvas owns that shape). The list omits the graph to stay light.
const summary = (b: Blueprint) => ({ id: b.id, name: b.name, createdAt: b.createdAt, updatedAt: b.updatedAt });

// Validate only the envelope (nodes + edges arrays); stay permissive about everything inside so the
// server isn't coupled to React Flow's evolving node/edge schema.
const graphSchema = z.object({ nodes: z.array(z.any()), edges: z.array(z.any()) }).passthrough();
// The saved AI-assistant transcript for this prompt session — same opaque round-trip as the graph.
const chatSchema = z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }));

function withGraph(b: Blueprint) {
  let graph: unknown, chat: unknown;
  try { graph = JSON.parse(b.graph); } catch { graph = { nodes: [], edges: [] }; }
  try { chat = b.chat ? JSON.parse(b.chat) : []; } catch { chat = []; }
  return { ...summary(b), graph, chat };
}

export async function blueprintRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/blueprints", async () => ({ blueprints: ctx.store.listBlueprints().map(summary) }));

  app.get("/api/blueprints/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    const bp = ctx.store.getBlueprint(id);
    if (!bp) return reply.code(404).send({ error: "not found" });
    return { blueprint: withGraph(bp) };
  });

  app.post("/api/blueprints", async (req, reply) => {
    const b = z.object({ name: z.string().min(1), graph: graphSchema, chat: chatSchema.optional() }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "name and a {nodes,edges} graph are required" });
    const bp = ctx.store.createBlueprint({
      name: b.data.name,
      graph: JSON.stringify(b.data.graph),
      chat: b.data.chat ? JSON.stringify(b.data.chat) : null,
    });
    return { blueprint: withGraph(bp) };
  });

  app.put("/api/blueprints/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getBlueprint(id)) return reply.code(404).send({ error: "not found" });
    const b = z.object({ name: z.string().min(1).optional(), graph: graphSchema.optional(), chat: chatSchema.optional() }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    ctx.store.updateBlueprint(id, {
      ...(b.data.name !== undefined ? { name: b.data.name } : {}),
      ...(b.data.graph !== undefined ? { graph: JSON.stringify(b.data.graph) } : {}),
      ...(b.data.chat !== undefined ? { chat: JSON.stringify(b.data.chat) } : {}),
    });
    return { blueprint: withGraph(ctx.store.getBlueprint(id)!) };
  });

  app.delete("/api/blueprints/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getBlueprint(id)) return reply.code(404).send({ error: "not found" });
    ctx.store.deleteBlueprint(id);
    return { ok: true };
  });
}
