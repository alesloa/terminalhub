import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { switchToGui, switchToTmux, SwitchBlocked, type SwitchDeps } from "../gui/switch.js";
import { parseGuiConfig } from "../gui/config.js";

// REST surface for GUI mode. The conversation itself rides the WebSocket (ws/guiGateway.ts); these
// endpoints move a terminal between surfaces, report which one it's on, and carry the composer's
// model / reasoning / permission picks.

const modeSchema = z.object({ mode: z.enum(["tmux", "gui"]) });

// Every field optional: the composer patches one pill at a time. An absent key keeps the terminal's
// current value; an explicit null on `model` clears it back to the CLI's own default.
const configSchema = z.object({
  model: z.string().min(1).max(200).nullable().optional(),
  effort: z.enum(["low", "medium", "high", "xhigh", "max", "ultracode", "ultrathink"]).nullable().optional(),
  permissionMode: z.enum(["approval-required", "auto-accept-edits", "auto", "full-access"]).optional(),
  fastMode: z.boolean().optional(),
});

export async function guiRoutes(app: FastifyInstance, ctx: AppContext) {
  const deps = (): SwitchDeps => ({
    tmux: ctx.tmux,
    stopGui: (terminalId) => ctx.gui.stop(terminalId),
    setMode: (terminalId, mode) => ctx.store.setTerminalMode(terminalId, mode),
    setAgentSession: (terminalId, sessionId) => ctx.store.setTerminalAgentSession(terminalId, sessionId),
  });

  app.get("/api/terminals/:id/gui", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const term = ctx.store.getTerminal(id);
    if (!term) return reply.code(404).send({ error: "terminal not found" });
    const session = ctx.gui.get(id);
    return {
      mode: term.mode,
      sessionId: term.agentSessionId,
      running: Boolean(session) && session?.state() !== "stopped",
      state: session?.state() ?? "idle",
      // A live session is the authority on what the agent is actually running under; the row is only
      // the fallback for a chat that hasn't started yet.
      config: session?.config() ?? term.guiConfig,
    };
  });

  app.get("/api/terminals/:id/gui/models", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!ctx.store.getTerminal(id)) return reply.code(404).send({ error: "terminal not found" });
    return { models: await ctx.gui.models(id) };
  });

  app.get("/api/terminals/:id/gui/commands", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!ctx.store.getTerminal(id)) return reply.code(404).send({ error: "terminal not found" });
    return { commands: await ctx.gui.commands(id) };
  });

  app.patch("/api/terminals/:id/gui/config", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const term = ctx.store.getTerminal(id);
    if (!term) return reply.code(404).send({ error: "terminal not found" });
    const b = configSchema.safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid gui config" });

    const p = b.data;
    const merged = parseGuiConfig({
      model: p.model !== undefined ? p.model : term.guiConfig.model,
      effort: p.effort !== undefined ? p.effort : term.guiConfig.effort,
      permissionMode: p.permissionMode ?? term.guiConfig.permissionMode,
      fastMode: p.fastMode ?? term.guiConfig.fastMode,
    });

    // Apply BEFORE persisting, and persist whatever the session reports back: a switch the CLI
    // rejects returns the old config, so the row can never claim a setting the agent isn't running.
    const session = ctx.gui.get(id);
    const config = session ? await session.setConfig(merged) : merged;
    ctx.store.setTerminalGuiConfig(id, config);
    // Sticky: the next new chat opens on this choice instead of resetting to the defaults.
    ctx.store.setGuiDefaults(config);
    return { config };
  });

  app.post("/api/terminals/:id/mode", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const term = ctx.store.getTerminal(id);
    if (!term) return reply.code(404).send({ error: "terminal not found" });
    const b = modeSchema.safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "mode must be 'tmux' or 'gui'" });
    if (b.data.mode === term.mode) return { terminal: ctx.store.getTerminal(id) };

    const ws = ctx.store.getWorkspace(term.workspaceId);
    if (!ws) return reply.code(404).send({ error: "workspace not found" });

    try {
      if (b.data.mode === "gui") await switchToGui(term, ws.folder, deps());
      else await switchToTmux(term, term.launchCommandOverride ?? ws.launchCommand, deps());
    } catch (err) {
      // A blocked switch is the user's problem to resolve (interrupt the agent), not a server fault —
      // 409 so the client can show the reason inline instead of a generic failure toast.
      if (err instanceof SwitchBlocked) return reply.code(409).send({ error: err.message });
      return reply.code(500).send({ error: err instanceof Error ? err.message : "switch failed" });
    }
    return { terminal: ctx.store.getTerminal(id) };
  });
}
