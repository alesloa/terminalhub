import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { searchFiles, replaceInFiles } from "../fs/search.js";

/** Find-in-files for the Explorer's Search tab. No ctx: pure filesystem, like fsRoutes. The global
 *  auth preHandler still gates these under /api when the server is exposed. */
export async function searchRoutes(app: FastifyInstance) {
  app.post("/api/search", async (req, reply) => {
    const b = z.object({
      root: z.string().min(1),
      query: z.string(),
      caseSensitive: z.boolean().optional(),
      wholeWord: z.boolean().optional(),
      regexp: z.boolean().optional(),
      include: z.string().optional(),
      exclude: z.string().optional(),
      excludeBuild: z.boolean().optional(),
      excludeSystem: z.boolean().optional(),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const { root, query, ...opts } = b.data;
    try {
      return await searchFiles(root, query, opts);
    } catch (err: any) {
      return reply.code(400).send({ error: "search failed", code: err.code });
    }
  });

  app.post("/api/search/replace", async (req, reply) => {
    const b = z.object({
      query: z.string().min(1),
      replace: z.string(),
      caseSensitive: z.boolean().optional(),
      wholeWord: z.boolean().optional(),
      regexp: z.boolean().optional(),
      targets: z.array(z.object({
        path: z.string().min(1),
        matches: z.array(z.object({ line: z.number().int(), col: z.number().int() })).optional(),
      })).min(1),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const { query, replace, targets, ...opts } = b.data;
    try {
      return await replaceInFiles(query, replace, opts, targets);
    } catch (err: any) {
      return reply.code(400).send({ error: "replace failed", code: err.code });
    }
  });
}
