import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { UnsafePathError } from "../skills/paths.js";

const scopeSchema = z.enum(["workspace", "global"]);

// A path-guard rejection is a bad request (400); anything else from the controller (git clone
// failed, registry down) is a 500 carrying the real message so the panel can show it.
function fail(reply: FastifyReply, err: unknown) {
  if (err instanceof UnsafePathError) return reply.code(400).send({ error: err.message });
  return reply.code(500).send({ error: err instanceof Error ? err.message : "skills error" });
}

// Workspace scope always needs the folder; reuse the check on every workspace-scoped route.
function needsWorkspace(scope: "workspace" | "global", workspace: string | undefined, reply: FastifyReply): boolean {
  if (scope === "workspace" && !workspace) {
    reply.code(400).send({ error: "workspace required for workspace scope" });
    return true;
  }
  return false;
}

export async function skillsRoutes(app: FastifyInstance, ctx: AppContext) {
  // Installed skills (active + disabled) for a scope, enriched with provenance.
  app.get("/api/skills", async (req, reply) => {
    const q = z.object({ scope: scopeSchema, workspace: z.string().optional() }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "scope required" });
    if (needsWorkspace(q.data.scope, q.data.workspace, reply)) return;
    try {
      return { skills: await ctx.skills.list(q.data.scope, q.data.workspace) };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // Raw SKILL.md for the viewer modal.
  app.get("/api/skills/content", async (req, reply) => {
    const q = z.object({ path: z.string().min(1), workspace: z.string().optional() }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "path required" });
    try {
      return { content: await ctx.skills.read(q.data.path, q.data.workspace) };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // Phase 1 of install: clone/open a source and list the skills inside it.
  app.post("/api/skills/scan", async (req, reply) => {
    const b = z.object({ source: z.string().min(1) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "source required" });
    try {
      return await ctx.skills.scan(b.data.source);
    } catch (e) {
      return fail(reply, e);
    }
  });

  // Phase 2: copy the picked skills into a scope.
  app.post("/api/skills/install", async (req, reply) => {
    const b = z.object({
      tmpId: z.string().min(1),
      names: z.array(z.string()).min(1),
      scope: scopeSchema,
      workspace: z.string().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid install body" });
    if (needsWorkspace(b.data.scope, b.data.workspace, reply)) return;
    try {
      return { skills: await ctx.skills.install(b.data.tmpId, b.data.names, b.data.scope, b.data.workspace) };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post("/api/skills/remove", async (req, reply) => {
    const b = z.object({ path: z.string().min(1), workspace: z.string().optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path required" });
    try {
      await ctx.skills.remove(b.data.path, b.data.workspace);
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post("/api/skills/enabled", async (req, reply) => {
    const b = z.object({
      path: z.string().min(1), enabled: z.boolean(), workspace: z.string().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    try {
      const res = await ctx.skills.setEnabled(b.data.path, b.data.enabled, b.data.workspace);
      return { path: res.installPath };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post("/api/skills/check-updates", async (req, reply) => {
    const b = z.object({ scope: scopeSchema, workspace: z.string().optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "scope required" });
    if (needsWorkspace(b.data.scope, b.data.workspace, reply)) return;
    try {
      return { updates: await ctx.skills.checkUpdates(b.data.scope, b.data.workspace) };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post("/api/skills/update", async (req, reply) => {
    const b = z.object({ path: z.string().min(1), workspace: z.string().optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path required" });
    try {
      return { skill: await ctx.skills.update(b.data.path, b.data.workspace) };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.get("/api/skills/search", async (req, reply) => {
    const q = z.object({ q: z.string().min(1) }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "query required" });
    try {
      return { results: await ctx.skills.search(q.data.q) };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // Catalog: a local index of skills discovered across configured sources, browsable + filterable.
  app.get("/api/skills/catalog", async (req, reply) => {
    const q = z.object({ filter: z.string().optional() }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "invalid query" });
    try {
      return { entries: ctx.skills.listCatalog(q.data.filter), sources: ctx.skills.catalogSources() };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post("/api/skills/catalog/source", async (req, reply) => {
    const b = z.object({ source: z.string().min(1), official: z.boolean().optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "source required" });
    try {
      return { sources: await ctx.skills.addCatalogSource(b.data.source, b.data.official) };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post("/api/skills/catalog/source/official", async (req, reply) => {
    const b = z.object({ source: z.string().min(1), official: z.boolean() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "source and official required" });
    try {
      return { sources: await ctx.skills.setCatalogSourceOfficial(b.data.source, b.data.official) };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post("/api/skills/catalog/source/remove", async (req, reply) => {
    const b = z.object({ source: z.string().min(1) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "source required" });
    try {
      return { sources: await ctx.skills.removeCatalogSource(b.data.source) };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post("/api/skills/catalog/reindex", async (_req, reply) => {
    try {
      return { sources: await ctx.skills.reindexCatalog() };
    } catch (e) {
      return fail(reply, e);
    }
  });
}
