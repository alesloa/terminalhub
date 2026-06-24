import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { resolveCopilotProvider, streamTurn } from "../copilot/service.js";
import { skillCards, getSkill, isSkillEnabled, collectTools } from "../copilot/skills/registry.js";
import { createRegistry } from "../copilot/registry.js";
import { readGlobalMcpServers } from "../spaces/catalog.js";
import type { CopilotMcpServer } from "../types.js";

// In-app Copilot. M1 surface: the singleton settings + the master enable toggle. Conversations,
// skills, accounts and jobs land in later milestones. Settings persist as a JSON blob under the
// `copilot` settings key (store.getCopilotSettings / setCopilotSettings) — no secrets here, so the
// whole object is safe to return as-is (the secrets-never-returned rule kicks in with email accounts).
const settingsPatch = z.object({
  enabled: z.boolean().optional(),
  defaultEngine: z.string().nullable().optional(),
  reportChannels: z.array(z.enum(["toast", "voice", "pushover"])).optional(),
  confirmDangerous: z.boolean().optional(),
  orbEnabled: z.boolean().optional(),
  orbPosition: z.enum(["bottom-right", "bottom-left", "top-right", "top-left"]).optional(),
}).strict();

export async function copilotRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/copilot/settings", async () => ({ settings: ctx.store.getCopilotSettings() }));

  app.patch("/api/copilot/settings", async (req, reply) => {
    const b = settingsPatch.safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const next = { ...ctx.store.getCopilotSettings(), ...b.data };
    ctx.store.setCopilotSettings(next);
    return { settings: ctx.store.getCopilotSettings() };
  });

  // ── Conversations ──
  app.get("/api/copilot/conversations", async () => ({ conversations: ctx.store.listCopilotConversations() }));

  app.post("/api/copilot/conversations", async (req) => {
    const b = z.object({ title: z.string().max(200).optional() }).safeParse(req.body ?? {});
    const conversation = ctx.store.createCopilotConversation(b.success ? b.data.title ?? "" : "");
    return { conversation };
  });

  app.get("/api/copilot/conversations/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    const conversation = ctx.store.getCopilotConversation(id);
    if (!conversation) return reply.code(404).send({ error: "not found" });
    const messages = ctx.store.listCopilotMessages(id).map((m) => ({ id: m.id, role: m.role, content: parseBlocks(m.content), createdAt: m.createdAt }));
    return { conversation, messages };
  });

  app.delete("/api/copilot/conversations/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getCopilotConversation(id)) return reply.code(404).send({ error: "not found" });
    ctx.store.deleteCopilotConversation(id);
    return { ok: true };
  });

  // Non-streaming message fallback (the live UI uses /ws/copilot; this is the no-socket path and is
  // handy for agents/tests). Dangerous tools are auto-denied here — confirmation needs the socket.
  app.post("/api/copilot/conversations/:id/messages", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getCopilotConversation(id)) return reply.code(404).send({ error: "not found" });
    const b = z.object({ text: z.string().min(1).max(8000) }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "a non-empty message is required" });
    const resolved = resolveCopilotProvider(ctx);
    if ("error" in resolved) return reply.code(400).send({ error: resolved.error });

    const tools: { name: string; ok: boolean; summary: string }[] = [];
    const { finalText } = await streamTurn({
      app: ctx, provider: resolved.provider, conversationId: id, userText: b.data.text, actor: "user",
      confirm: async () => false,
      onEvent: (e) => { if (e.type === "tool_result") tools.push({ name: "", ok: e.ok, summary: e.summary }); },
    });
    return { reply: finalText, tools };
  });

  // ── Skills ──
  app.get("/api/copilot/skills", async () => ({ skills: skillCards(ctx) }));

  app.patch("/api/copilot/skills/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    const skill = getSkill(id);
    if (!skill) return reply.code(404).send({ error: "unknown skill" });
    const b = z.object({
      enabled: z.boolean().optional(),
      settings: z.record(z.unknown()).optional(),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    // The built-in core skill can't be disabled; ignore an `enabled` flip for it (settings still apply).
    const patch: { enabled?: boolean; settings?: Record<string, unknown> } = {};
    if (b.data.enabled !== undefined && !skill.builtin) patch.enabled = b.data.enabled;
    if (b.data.settings !== undefined) patch.settings = b.data.settings;
    if (patch.enabled !== undefined || patch.settings !== undefined) ctx.store.setCopilotSkillState(id, patch);
    return { skill: { id: skill.id, name: skill.name, description: skill.description, icon: skill.icon, builtin: skill.builtin, accountsProvider: skill.accountsProvider, examples: skill.examples, enabled: isSkillEnabled(ctx, skill) } };
  });

  // ── Skill accounts (e.g. email mailboxes) ──
  // The `secret` (IMAP app-password / token) is write-only: accepted on create/update, NEVER returned.
  const accountBody = z.object({
    label: z.string().min(1).max(80),
    provider: z.enum(["gmail", "icloud", "outlook", "yahoo", "imap"]),
    config: z.record(z.unknown()).default({}),
    secret: z.string().max(2000).default(""),
  });

  const requireAccountSkill = (id: string) => { const s = getSkill(id); return s && s.accountsProvider ? s : null; };

  app.get("/api/copilot/skills/:id/accounts", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!requireAccountSkill(id)) return reply.code(404).send({ error: "skill has no accounts" });
    return { accounts: ctx.store.listSkillAccounts(id) };
  });

  app.post("/api/copilot/skills/:id/accounts", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!requireAccountSkill(id)) return reply.code(404).send({ error: "skill has no accounts" });
    const b = accountBody.safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const account = ctx.store.createSkillAccount({ skillId: id, label: b.data.label, provider: b.data.provider, config: b.data.config, secret: b.data.secret });
    return { account };
  });

  app.patch("/api/copilot/skills/:id/accounts/:aid", async (req, reply) => {
    const aid = (req.params as any).aid as string;
    if (!ctx.store.getSkillAccountSecret(aid)) return reply.code(404).send({ error: "not found" });
    const b = z.object({
      label: z.string().min(1).max(80).optional(),
      config: z.record(z.unknown()).optional(),
      secret: z.string().max(2000).optional(),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const account = ctx.store.updateSkillAccount(aid, b.data);
    return { account };
  });

  app.delete("/api/copilot/skills/:id/accounts/:aid", async (req, reply) => {
    const aid = (req.params as any).aid as string;
    if (!ctx.store.getSkillAccountSecret(aid)) return reply.code(404).send({ error: "not found" });
    ctx.store.deleteSkillAccount(aid);
    return { ok: true };
  });

  // ── Scheduled loops (jobs) ──
  // A loop runs ONE tool unattended on an interval; the scheduler reports per reportMode. The looped
  // tool must exist and must NOT be dangerous (the scheduler never types into a terminal on its own).
  const jobCreate = z.object({
    title: z.string().max(120).optional(),
    tool: z.string().min(1),
    args: z.record(z.unknown()).default({}),
    intervalSec: z.number().int().min(60),
    reportMode: z.enum(["always", "on-change", "on-find"]).default("on-change"),
  });
  const schedulableError = (tool: string): string | null => {
    const def = createRegistry(collectTools(ctx)).get(tool);
    if (!def) return `No tool named "${tool}".`;
    if (def.dangerous) return `"${tool}" is dangerous and can't be auto-run on a loop.`;
    return null;
  };

  // Tools the UI can offer for a loop: the currently-enabled, NON-dangerous tools (a loop runs
  // unattended, so dangerous tools never appear). Reflects enabled skills, so e.g. email_check only
  // shows when the email skill is on.
  app.get("/api/copilot/tools", async () => ({
    tools: collectTools(ctx).filter((t) => !t.dangerous).map((t) => ({ name: t.name, description: t.description, skillId: t.skillId })),
  }));

  app.get("/api/copilot/jobs", async () => ({ jobs: ctx.store.listCopilotJobs() }));

  app.post("/api/copilot/jobs", async (req, reply) => {
    const b = jobCreate.safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const err = schedulableError(b.data.tool);
    if (err) return reply.code(400).send({ error: err });
    const job = ctx.store.createCopilotJob({ title: b.data.title ?? "", tool: b.data.tool, args: b.data.args, intervalSec: b.data.intervalSec, reportMode: b.data.reportMode });
    return { job };
  });

  app.patch("/api/copilot/jobs/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getCopilotJob(id)) return reply.code(404).send({ error: "not found" });
    const b = z.object({
      title: z.string().max(120).optional(),
      args: z.record(z.unknown()).optional(),
      intervalSec: z.number().int().min(60).optional(),
      reportMode: z.enum(["always", "on-change", "on-find"]).optional(),
      enabled: z.boolean().optional(),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const job = ctx.store.updateCopilotJob(id, b.data);
    return { job };
  });

  app.delete("/api/copilot/jobs/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getCopilotJob(id)) return reply.code(404).send({ error: "not found" });
    ctx.store.deleteCopilotJob(id);
    return { ok: true };
  });

  // ── MCP tool servers ──
  // Connect to a server, list its tools, and cache them so the agent gains those tools. `env` may hold
  // secrets, so it's write-only (accepted here, never returned — routes expose only the key names).
  const mcpBody = z.object({
    label: z.string().min(1).max(80),
    transport: z.enum(["stdio", "http"]).default("stdio"),
    command: z.array(z.string()).default([]),
    url: z.string().url().nullish(),
    env: z.record(z.string()).default({}),
  }).refine((v) => (v.transport === "stdio" ? v.command.length > 0 : !!v.url), { message: "stdio needs a command; http needs a url" });

  // Connect + (re)discover a server's tools, persisting the result + status. Returns the fresh row.
  async function discover(id: string): Promise<CopilotMcpServer | undefined> {
    const cfg = ctx.store.getMcpServerConfig(id);
    if (!cfg) return undefined;
    try {
      const tools = await ctx.mcp.listTools(cfg);
      ctx.store.setMcpServerTools(id, tools, "ok", null);
    } catch (e) {
      ctx.store.setMcpServerTools(id, ctx.store.getMcpServer(id)?.tools ?? [], "error", e instanceof Error ? e.message : String(e));
    }
    return ctx.store.getMcpServer(id);
  }

  app.get("/api/copilot/mcp", async () => ({ servers: ctx.store.listMcpServers() }));

  // The user's global MCP servers from ~/.claude.json, offered for one-click import (values withheld).
  app.get("/api/copilot/mcp/importable", async () => {
    const raw = readGlobalMcpServers();
    const servers = Object.entries(raw).map(([name, d]) => {
      const transport: "stdio" | "http" = d.command ? "stdio" : "http";
      return {
        name,
        transport,
        command: d.command ? [d.command, ...(d.args ?? [])] : [],
        url: d.url ?? null,
        envKeys: Object.keys(d.env ?? {}),
      };
    });
    return { servers };
  });

  app.post("/api/copilot/mcp", async (req, reply) => {
    const b = mcpBody.safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: b.error.issues[0]?.message ?? "invalid body" });
    const created = ctx.store.createMcpServer({ label: b.data.label, transport: b.data.transport, command: b.data.command, url: b.data.url ?? null, env: b.data.env });
    const server = (await discover(created.id)) ?? created;
    return { server };
  });

  app.patch("/api/copilot/mcp/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getMcpServer(id)) return reply.code(404).send({ error: "not found" });
    const b = z.object({
      label: z.string().min(1).max(80).optional(),
      command: z.array(z.string()).optional(),
      url: z.string().url().nullish(),
      env: z.record(z.string()).optional(),
      enabled: z.boolean().optional(),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const server = ctx.store.updateMcpServer(id, b.data);
    return { server };
  });

  app.post("/api/copilot/mcp/:id/refresh", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getMcpServer(id)) return reply.code(404).send({ error: "not found" });
    const server = await discover(id);
    return { server };
  });

  app.delete("/api/copilot/mcp/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getMcpServer(id)) return reply.code(404).send({ error: "not found" });
    ctx.store.deleteMcpServer(id);
    return { ok: true };
  });
}

function parseBlocks(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return []; }
}
