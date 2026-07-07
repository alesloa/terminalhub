import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { createCloneJobs, CloneStartError } from "../git/cloneJobs.js";
import { seedWorkspaceEffective } from "../spaces/seedSpace.js";
import { cloneName } from "./git.js";

// Async clone jobs — the non-blocking "New workspace → Clone repo" flow. Start returns immediately;
// the browser polls the list and renders an in-flight card; DELETE cancels (killing the clone and
// removing the partial folder). On success the job itself creates the workspace row, so the clone
// lands as a real card even if every browser has navigated away.
export async function cloneJobRoutes(app: FastifyInstance, ctx: AppContext) {
  const jobs = createCloneJobs({
    authEnv: (cwd, account) => ctx.github.authEnv(cwd, account),
    onDone: async (job) => {
      const ws = ctx.store.createWorkspace({
        name: job.name, folder: job.path,
        launchCommand: ctx.store.getSettings().defaultLaunchCommand,
        color: null,
        ...(job.ws.spaceId ? { spaceId: job.ws.spaceId } : {}), // omitted → store defaults to Home
        x: job.ws.x, y: job.ws.y,
      });
      // Same post-create prep as POST /api/workspaces (idempotent + best-effort).
      await seedWorkspaceEffective(ctx.store, ws);
    },
  });

  // Mirrors the guards of the sync /api/git/clone + /api/git/github/clone bodies; exactly one of
  // url/repo picks the source. spaceId/x/y say where the finished card should land.
  const startBody = z.object({
    url: z.string().min(1).regex(/^[^-]/, "url cannot start with '-'").optional(),
    repo: z.string().regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/, "must be owner/repo").optional(),
    account: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/).optional(),
    host: z.string().regex(/^[A-Za-z0-9.-]+$/).optional(),
    parent: z.string().min(1),
    name: cloneName,
    spaceId: z.string().nullable().optional(),
    x: z.number(),
    y: z.number(),
  }).refine(b => !!b.url !== !!b.repo, "exactly one of url or repo required");

  app.post("/api/git/clone/jobs", async (req, reply) => {
    const b = startBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "url or repo, parent and a valid name required" });
    const account = b.data.account ? { login: b.data.account, host: b.data.host ?? "github.com" } : undefined;
    try {
      const job = await jobs.start({
        name: b.data.name, parent: b.data.parent,
        url: b.data.url, repo: b.data.repo, account,
        ws: { spaceId: b.data.spaceId ?? null, x: b.data.x, y: b.data.y },
      });
      return { job };
    } catch (err: any) {
      if (err instanceof CloneStartError) return reply.code(400).send({ error: err.message });
      return reply.code(500).send({ error: err?.message ?? "clone failed to start" });
    }
  });

  app.get("/api/git/clone/jobs", async () => ({ jobs: jobs.list() }));

  app.delete("/api/git/clone/jobs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await jobs.cancel(id))) return reply.code(404).send({ error: "no such clone job" });
    return { ok: true };
  });
}
