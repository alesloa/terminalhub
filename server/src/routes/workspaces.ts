import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { seedWorkspaceEffective, seedWorkspaceById } from "../spaces/seedSpace.js";
import { normalizeSpaceConfig } from "../spaces/types.js";
import { readInstalled, installItem } from "../spaces/installed.js";

const spaceConfig = z.record(z.string(), z.unknown());

export async function workspaceRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/workspaces", async () => {
    const sessions = new Set(await ctx.tmux.listSessions());
    const out = ctx.store.listWorkspaces().map(ws => ({
      ...ws,
      terminals: ctx.store.listTerminals(ws.id).map(t => ({ ...t, alive: sessions.has(t.tmuxSession) })),
    }));
    return { workspaces: out };
  });

  app.post("/api/workspaces", async (req, reply) => {
    const b = z.object({
      name: z.string().min(1), folder: z.string().min(1),
      launchCommand: z.string().optional(), color: z.string().nullable().optional(),
      spaceId: z.string().optional(),
      config: spaceConfig.nullable().optional(),
      x: z.number().optional(), y: z.number().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const ws = ctx.store.createWorkspace({
      name: b.data.name, folder: b.data.folder,
      launchCommand: b.data.launchCommand ?? ctx.store.getSettings().defaultLaunchCommand,
      color: b.data.color ?? null,
      spaceId: b.data.spaceId, // omitted → store defaults to the Home space
      config: b.data.config == null ? null : normalizeSpaceConfig(b.data.config),
      x: b.data.x, y: b.data.y,
    });
    // Prep the folder from the effective (space ⊕ workspace) wizard config now, so it's ready before
    // any terminal launches (also re-applied per-terminal in terminals.ts). Idempotent + best-effort.
    await seedWorkspaceEffective(ctx.store, ws);
    return { workspace: ws };
  });

  app.patch("/api/workspaces/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    const b = z.object({
      name: z.string().optional(), folder: z.string().optional(),
      launchCommand: z.string().optional(),
      color: z.string().nullable().optional(), cardColor: z.string().nullable().optional(),
      layout: z.string().nullable().optional(),
      spaceId: z.string().optional(),
      folderId: z.string().nullable().optional(),
      config: spaceConfig.nullable().optional(),
      x: z.number().optional(), y: z.number().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    if (!ctx.store.getWorkspace(id)) return reply.code(404).send({ error: "not found" });
    const patch: Record<string, unknown> = { ...b.data };
    // `config` arrives as a loose object — normalize to a real SpaceConfig (null clears it).
    if ("config" in b.data) patch.config = b.data.config == null ? null : normalizeSpaceConfig(b.data.config);
    // The Desktop catch-all is pinned to Home — never let it be moved to another space.
    if (id === ctx.store.getDesktopWorkspaceId()) delete patch.spaceId;
    ctx.store.updateWorkspace(id, patch);
    return { workspace: ctx.store.getWorkspace(id) };
  });

  // Apply this workspace's effective (space ⊕ own) config to its folder now — the per-workspace
  // "seed/apply". Idempotent + never-clobber; the agent picks it up on the next terminal launch.
  app.post("/api/workspaces/:id/seed", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getWorkspace(id)) return reply.code(404).send({ error: "not found" });
    const result = await seedWorkspaceById(ctx.store, id);
    return { result };
  });

  // Ground truth for the per-workspace setup modal: what skills/commands/MCP servers are ACTUALLY on
  // disk in this workspace's folder right now (read from the seeder's own target paths), independent
  // of the stored config. Drives the modal's "Installed" section.
  app.get("/api/workspaces/:id/installed", async (req, reply) => {
    const id = (req.params as any).id as string;
    const ws = ctx.store.getWorkspace(id);
    if (!ws) return reply.code(404).send({ error: "not found" });
    return { installed: await readInstalled(ws.folder) };
  });

  // Install ONE global item into this workspace's folder now (idempotent + never-clobber). Returns the
  // freshly re-read installed set so the client only promotes the item to "Installed" once disk
  // confirms it landed.
  app.post("/api/workspaces/:id/install", async (req, reply) => {
    const id = (req.params as any).id as string;
    const ws = ctx.store.getWorkspace(id);
    if (!ws) return reply.code(404).send({ error: "not found" });
    const b = z.object({
      kind: z.enum(["skill", "command", "mcp"]),
      name: z.string().min(1),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const result = await installItem(ws.folder, b.data.kind, b.data.name);
    return { installed: await readInstalled(ws.folder), result };
  });

  app.delete("/api/workspaces/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getWorkspace(id)) return reply.code(404).send({ error: "not found" });
    const desktopId = ctx.store.getDesktopWorkspaceId();
    if (id === desktopId) return reply.code(400).send({ error: "cannot remove the Desktop workspace" });
    // Non-destructive: rehome this workspace's terminals onto the Desktop catch-all (re-points the
    // rows only; tmux sessions keep running), then drop the now terminal-free workspace row.
    if (desktopId) ctx.store.reassignTerminals(id, desktopId);
    ctx.store.deleteWorkspace(id);
    return { ok: true };
  });
}
