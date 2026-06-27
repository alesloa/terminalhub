import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { homedir } from "node:os";
import { isAbsolute, resolve as resolvePath } from "node:path";
import type { AppContext } from "../context.js";
import { sessionName } from "../tmux/names.js";
import { runKickoff } from "../tmux/kickoff.js";
import { statPath } from "../fs/browser.js";
import { seedWorkspaceEffective } from "../spaces/seedSpace.js";
import { resolveTerminalSession } from "../claude/terminalLink.js";

const DEFAULT_COLS = 200, DEFAULT_ROWS = 50;
const MB = 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * MB; // pasted screenshot cap (decoded)

export async function terminalRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/workspaces/:id/terminals", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getWorkspace(id)) return reply.code(404).send({ error: "not found" });
    const sessions = new Set(await ctx.tmux.listSessions());
    return { terminals: ctx.store.listTerminals(id).map(t => ({ ...t, alive: sessions.has(t.tmuxSession) })) };
  });

  app.post("/api/workspaces/:id/terminals", async (req, reply) => {
    const wsId = (req.params as any).id as string;
    const ws = ctx.store.getWorkspace(wsId);
    if (!ws) return reply.code(404).send({ error: "workspace not found" });
    const b = z.object({
      title: z.string().optional(), color: z.string().nullable().optional(),
      launchCommandOverride: z.string().nullable().optional(),
      // A line to type into the agent once it's up (e.g. `/loop …` / `/goal …` to start a Claude
      // loop). Sent via send-keys after the CLI is detected running — see runKickoff.
      kickoff: z.string().max(2000).nullable().optional(),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });

    const count = ctx.store.listTerminals(wsId).length;
    // create the row first (generates the terminal id), then derive + persist the session name
    const term = ctx.store.createTerminal({
      workspaceId: wsId,
      title: b.data.title ?? `Terminal ${count + 1}`,
      color: b.data.color ?? null,
      tmuxSession: "pending",
      launchCommandOverride: b.data.launchCommandOverride ?? null,
    });
    const session = sessionName(wsId, term.id);
    ctx.store.setTerminalSession(term.id, session);

    // Seed this workspace's folder from its effective (space ⊕ workspace) wizard config BEFORE the
    // agent launches, so the CLI reads the freshly-installed skills/commands/.mcp.json/.env/rules on
    // startup. Idempotent + best-effort (never throws), so a re-launch in a seeded folder is a no-op.
    await seedWorkspaceEffective(ctx.store, ws);

    await ctx.tmux.newSession(session, ws.folder, DEFAULT_COLS, DEFAULT_ROWS);
    // Bell-only attention: newSession already armed the bell (monitor-bell). Silence is NOT armed —
    // it flagged every idle agent and flooded notifications, so a quiet pane no longer earns attention.
    const launch = b.data.launchCommandOverride ?? ws.launchCommand;
    if (launch && launch.trim()) await ctx.tmux.sendKeys(session, launch.trim());

    // Loop kickoff: once the agent is actually running, type the loop/goal command into it. Fire and
    // forget — runKickoff polls + waits in the background so the create response returns immediately.
    const kickoff = b.data.kickoff?.trim();
    if (kickoff) void runKickoff(ctx.tmux, session, kickoff);

    return { terminal: { ...ctx.store.getTerminal(term.id)! } };
  });

  // Clipboard image paste. The browser holds the image but the agent runs on the host, so the
  // bytes are POSTed here (base64 in JSON, like /stt), written under the workspace folder, and the
  // resulting relative path is handed back for the client to drop at the cursor. Token-gated by the
  // shared preHandler, so the remote/tunnel case is covered.
  app.post("/api/workspaces/:id/terminals/:tid/clip-image", { bodyLimit: 20 * MB }, async (req, reply) => {
    const { id: wsId, tid } = req.params as { id: string; tid: string };
    const ws = ctx.store.getWorkspace(wsId);
    if (!ws) return reply.code(404).send({ error: "workspace not found" });
    const term = ctx.store.getTerminal(tid);
    if (!term || term.workspaceId !== wsId) return reply.code(404).send({ error: "terminal not found" });

    const b = z.object({ imageBase64: z.string().min(1), mimeType: z.string().min(1) }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const mime = b.data.mimeType.toLowerCase();
    if (!mime.startsWith("image/")) return reply.code(400).send({ error: "not an image" });
    const ext = mime.slice("image/".length).replace(/\+.*$/, ""); // image/svg+xml -> svg

    const bytes = Buffer.from(b.data.imageBase64, "base64");
    if (bytes.length === 0) return reply.code(400).send({ error: "empty image" });
    if (bytes.length > MAX_IMAGE_BYTES) return reply.code(413).send({ error: "image too large" });

    const saved = ctx.clip.saveImage(ws.folder, tid, bytes, ext);
    // Insert the absolute path so it resolves no matter the agent's current cwd (and no `@` prefix).
    return { path: saved.relPath, insert: saved.absPath };
  });

  // Resolve a path token clicked in a terminal (Cmd/Ctrl-click) to an absolute path + its kind, so
  // the browser can open the file in the editor, reveal a folder, or report a miss. Relative tokens
  // resolve against the pane's LIVE cwd (honours `cd`), falling back to the workspace folder; `~`
  // expands to the server user's home. Same fs reach as /api/fs/file — gated by the shared auth
  // preHandler, so the exposed/tunnel case still needs a token.
  app.get("/api/workspaces/:id/terminals/:tid/resolve-path", async (req, reply) => {
    const { id: wsId, tid } = req.params as { id: string; tid: string };
    const ws = ctx.store.getWorkspace(wsId);
    if (!ws) return reply.code(404).send({ error: "workspace not found" });
    const term = ctx.store.getTerminal(tid);
    if (!term || term.workspaceId !== wsId) return reply.code(404).send({ error: "terminal not found" });
    const q = z.object({ text: z.string().min(1) }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "text required" });

    let cwd = ws.folder;
    try { const p = await ctx.tmux.paneCwd(term.tmuxSession); if (p) cwd = p; } catch { /* fall back to ws.folder */ }

    let text = q.data.text.trim();
    if (text === "~") text = homedir();
    else if (text.startsWith("~/")) text = resolvePath(homedir(), text.slice(2));
    const path = isAbsolute(text) ? resolvePath(text) : resolvePath(cwd, text);
    return { path, type: await statPath(path) };
  });

  app.patch("/api/terminals/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    const before = ctx.store.getTerminal(id);
    if (!before) return reply.code(404).send({ error: "not found" });
    // `auto:true` = an auto-titler update (leaves the tab unlocked); omitted/false = a user rename
    // that pins the name (titleAuto → false) so the auto-titler won't overwrite it.
    const b = z.object({ title: z.string().optional(), color: z.string().nullable().optional(), icon: z.string().nullable().optional(), auto: z.boolean().optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    ctx.store.updateTerminal(id, b.data);

    // Mirror a USER rename onto the coding-agent session running in this terminal, so the Sessions
    // panel stays in sync (the reverse mirror lives in POST /api/claude/rename). Skip auto-titler
    // updates (auto:true) — those are DERIVED from the session, so writing back would be a no-op loop.
    const title = b.data.title?.trim();
    if (title && !b.data.auto && title !== before.title) {
      const ws = ctx.store.getWorkspace(before.workspaceId);
      if (ws) {
        try {
          const link = await resolveTerminalSession(before, ws.folder, (n) => ctx.tmux.panePid(n));
          if (link) await ctx.claude.rename(link.agent, link.sessionId, ws.folder, title);
        } catch { /* no linked session (e.g. fresh codex) or rename failed — tab rename still stands */ }
      }
    }
    return { terminal: ctx.store.getTerminal(id) };
  });

  // Reorder a terminal within its workspace's list (drag-reorder in the Terminals panel). `index` is
  // the target slot in the rendered order; the store splices it there and renumbers positions.
  app.post("/api/terminals/:id/move", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getTerminal(id)) return reply.code(404).send({ error: "not found" });
    const b = z.object({ index: z.number().int().min(0) }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    ctx.store.moveTerminal(id, b.data.index);
    return { terminal: ctx.store.getTerminal(id)! };
  });

  // Full scrollback of a terminal's tmux pane as plain text — backs the buffer viewer and the
  // one-tap copy-all. `lines` optionally caps to the last N history lines; omitted = the whole
  // buffer. Read-only and a point-in-time snapshot; a vanished session yields "". Gated by the
  // shared auth preHandler, so the exposed/tunnel case still needs a token.
  app.get("/api/terminals/:id/scrollback", async (req, reply) => {
    const id = (req.params as any).id as string;
    const t = ctx.store.getTerminal(id);
    if (!t) return reply.code(404).send({ error: "not found" });
    const q = z.object({ lines: z.coerce.number().int().positive().max(100000).optional() }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "invalid query" });
    let text = "";
    try { text = await ctx.tmux.captureScrollback(t.tmuxSession, q.data.lines); } catch { /* session gone → empty */ }
    return { text };
  });

  // A colored "thumbnail" of a terminal's CURRENT screen (capture-pane -e -p), for the Stage
  // Manager dock. Point-in-time, read-only; ANSI preserved so the client can render colors. Works
  // even when no PTY is attached (capture is server-side), so off-canvas rooms still preview. A
  // vanished session yields "". Gated by the shared auth preHandler (exposed/tunnel needs a token).
  app.get("/api/terminals/:id/preview", async (req, reply) => {
    const id = (req.params as any).id as string;
    const t = ctx.store.getTerminal(id);
    if (!t) return reply.code(404).send({ error: "not found" });
    let content = "";
    try { content = await ctx.tmux.capturePreview(t.tmuxSession); } catch { /* session gone → empty */ }
    return { content };
  });

  // Wipe a terminal's tmux scrollback history (clear-history). The live screen is left intact; only
  // the off-screen history is dropped. Irreversible — the client confirms first. A vanished session
  // is a no-op. Gated by the shared auth preHandler, so the exposed/tunnel case still needs a token.
  app.post("/api/terminals/:id/clear-history", async (req, reply) => {
    const id = (req.params as any).id as string;
    const t = ctx.store.getTerminal(id);
    if (!t) return reply.code(404).send({ error: "not found" });
    try { await ctx.tmux.clearHistory(t.tmuxSession); } catch { /* session gone — nothing to clear */ }
    return { ok: true };
  });

  app.delete("/api/terminals/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    const t = ctx.store.getTerminal(id);
    if (!t) return reply.code(404).send({ error: "not found" });
    try { await ctx.tmux.killSession(t.tmuxSession); } catch { /* already gone */ }
    const ws = ctx.store.getWorkspace(t.workspaceId);
    if (ws) ctx.clip.clearTerminal(ws.folder, id); // drop this terminal's pasted images
    ctx.store.deleteTerminal(id);
    return { ok: true };
  });
}
