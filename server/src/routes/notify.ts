import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { parseSession } from "../tmux/names.js";
import { notifyCategory } from "../notify/bus.js";

// POST /api/notify — how a coding agent (Claude/Codex) running inside a room talks back to the
// dashboard. On loopback this needs no token (auth/guard relaxes localhost), so the agent just
// curls it. The body is broadcast over /ws/notifications to every open dashboard, which beeps,
// speaks it, and shows a clickable toast. Passing `session` (the tmux session the agent runs in,
// tr_<ws>_<tm>) makes the toast deep-link back to that terminal.
export async function notifyRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post("/api/notify", async (req, reply) => {
    const b = z.object({
      text: z.string().min(1).max(2000),
      title: z.string().max(120).optional(),
      level: z.enum(["info", "success", "warn", "error"]).optional(),
      voice: z.string().max(120).optional(),
      speak: z.boolean().optional(),
      session: z.string().max(200).optional(),
      workspaceId: z.string().max(64).optional(),
      terminalId: z.string().max(64).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const d = b.data;

    // Prefer explicit ids; otherwise derive them from the tmux session name so a click can focus
    // the sending terminal. A non-Terminal Hub session name just yields no target (toast still shows).
    let workspaceId = d.workspaceId;
    let terminalId = d.terminalId;
    if (d.session && (!workspaceId || !terminalId)) {
      const parsed = parseSession(d.session);
      if (parsed) {
        workspaceId ??= parsed.workspaceId;
        terminalId ??= parsed.terminalId;
      }
    }

    const level = d.level ?? "info";
    // Fire as a *pending* toast: it only lands in the notification center if you ignore it for the
    // grace window. Handle the toast (click / ✕) and it never reaches the center — see notify/pending.
    const id = ctx.pending.fire({
      text: d.text,
      title: d.title,
      level,
      category: notifyCategory(level, "notify"),
      source: "notify",
      voice: d.voice,
      speak: d.speak ?? true, // agents notify so you'll *hear* it — speaking is the default
      workspaceId,
      terminalId,
    });
    return { ok: true, id };
  });
}
