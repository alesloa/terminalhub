import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import path from "node:path";
import type { AppContext } from "../context.js";
import { homeDir, claudeProjectDir } from "../claude/paths.js";
import { deleteEntries, replaceRangeWithSummary } from "../claude/writeback.js";
import { detectSessionForPid } from "../claude/terminalDetect.js";
import { terminalsRunningSession } from "../claude/terminalLink.js";
import { parseSessionEntries, extractTextContent, getFirstUserMessage } from "../claude/jsonl.js";
import { getCustomNames } from "../claude/names.js";
import { claudeTerminalTitle } from "../claude/terminalTitle.js";
import { sessionName } from "../tmux/names.js";
import { AiError } from "../ai/complete.js";
import type { AgentType } from "../claude/types.js";

/**
 * Build the text fed to the summarizer from the entries inside [first..last] inclusive. Mirrors
 * the extension's buildConversationText: user/assistant turns are labeled, everything else is
 * skipped (the summary route only needs the human-readable conversation).
 */
async function buildConversationText(
  jsonlPath: string, agent: AgentType, first: number, last: number,
): Promise<string> {
  const entries = await parseSessionEntries(jsonlPath, agent);
  const lines: string[] = [];
  for (const entry of entries) {
    if (entry.lineIndex < first || entry.lineIndex > last) continue;
    if (entry.entryType !== "User" && entry.entryType !== "Assistant") continue;
    const message = entry.parsed.message as Record<string, unknown> | undefined;
    const payload = entry.parsed.payload as Record<string, unknown> | undefined;
    const text = extractTextContent(message?.content ?? payload?.content);
    if (text) lines.push(`[${entry.entryType}]: ${text}`);
  }
  return lines.join("\n");
}

// A jsonlPath always comes from a session we listed, but guard anyway so an exposed
// deployment can't be coaxed into reading arbitrary files: it must sit under ~/.claude or
// ~/.codex. Returns the resolved path, or null if it escapes those roots.
function safeSessionPath(jsonlPath: string): string | null {
  const resolved = path.resolve(jsonlPath);
  const claudeRoot = path.join(homeDir(), ".claude") + path.sep;
  const codexRoot = path.join(homeDir(), ".codex") + path.sep;
  if (!resolved.endsWith(".jsonl")) return null;
  return resolved.startsWith(claudeRoot) || resolved.startsWith(codexRoot) ? resolved : null;
}

const agentSchema = z.enum(["claude", "codex"]);
// sessionIds are CLI-generated UUIDs; reject anything carrying a path separator so a mutation
// route can never be coaxed into touching a file outside the session dir.
const sessionIdSchema = z.string().min(1).refine((s) => !s.includes("/") && !s.includes("\\") && !s.includes("\0"), "invalid sessionId");

// A missing session is the only real 404; anything else (e.g. "session has no messages", a write
// failure) is a genuine error and must surface its message rather than masquerade as not-found.
function forkFail(reply: FastifyReply, err: unknown) {
  const msg = err instanceof Error ? err.message : "fork failed";
  return reply.code(msg === "session not found" ? 404 : 500).send({ error: msg });
}

export async function claudeRoutes(app: FastifyInstance, ctx: AppContext) {
  // All Claude + Codex sessions for a project folder, split by agent, plus the per-session UI
  // prefs (pins/colors) from Terminal Hub's own DB keyed by sessionId.
  app.get("/api/claude/sessions", async (req, reply) => {
    const q = z.object({ path: z.string().min(1) }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "path required" });
    const { claude, codex } = await ctx.claude.listSessions(q.data.path);
    return { claude, codex, prefs: ctx.store.getClaudePrefs() };
  });

  // Paginated user/assistant messages for the transcript detail view.
  app.get("/api/claude/messages", async (req, reply) => {
    const q = z.object({
      jsonlPath: z.string().min(1),
      agent: agentSchema,
      limit: z.coerce.number().int().min(1).max(500).optional(),
      offset: z.coerce.number().int().min(0).optional(),
    }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "invalid query" });
    const safe = safeSessionPath(q.data.jsonlPath);
    if (!safe) return reply.code(400).send({ error: "path outside session roots" });
    return ctx.claude.messages(safe, q.data.agent, q.data.limit ?? 50, q.data.offset ?? 0);
  });

  // Every line of a transcript (for the entry editor). rawLine is dropped to keep the payload
  // small; the server keeps the full parse cached for write-back.
  app.get("/api/claude/entries", async (req, reply) => {
    const q = z.object({ jsonlPath: z.string().min(1), agent: agentSchema }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "invalid query" });
    const safe = safeSessionPath(q.data.jsonlPath);
    if (!safe) return reply.code(400).send({ error: "path outside session roots" });
    const entries = await ctx.claude.entries(safe, q.data.agent);
    return {
      entries: entries.map((e) => ({
        lineIndex: e.lineIndex,
        entryType: e.entryType,
        preview: e.preview,
        timestamp: e.timestamp,
        checkable: e.entryType !== "Other",
      })),
    };
  });

  // Token + cost accounting for one transcript.
  app.get("/api/claude/usage", async (req, reply) => {
    const q = z.object({ jsonlPath: z.string().min(1), agent: agentSchema }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "invalid query" });
    const safe = safeSessionPath(q.data.jsonlPath);
    if (!safe) return reply.code(400).send({ error: "path outside session roots" });
    return ctx.claude.usage(safe);
  });

  // Set per-session UI prefs (pin + color) in Terminal Hub's DB. Only the provided fields change.
  app.post("/api/claude/prefs", async (req, reply) => {
    const b = z.object({
      sessionId: sessionIdSchema,
      pinned: z.boolean().optional(),
      color: z.string().nullable().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const patch: { pinned?: boolean; color?: string | null } = {};
    if (b.data.pinned !== undefined) patch.pinned = b.data.pinned;
    if (b.data.color !== undefined) patch.color = b.data.color;
    ctx.store.setClaudePref(b.data.sessionId, patch);
    return { ok: true };
  });

  // Rename a session (writes session-names.json beside the transcript).
  app.post("/api/claude/rename", async (req, reply) => {
    const b = z.object({
      agent: agentSchema,
      sessionId: sessionIdSchema,
      projectPath: z.string().min(1),
      name: z.string().min(1),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    await ctx.claude.rename(b.data.agent, b.data.sessionId, b.data.projectPath, b.data.name);

    // Mirror the rename onto any terminal currently running this session (the reverse mirror lives in
    // PATCH /api/terminals/:id), so the Terminals panel + tab stay in sync. `auto:true` keeps the
    // terminal's pin state untouched — this is a session-derived name, same as the auto-titler.
    try {
      const link = { agent: b.data.agent, sessionId: b.data.sessionId };
      const candidates = ctx.store.listAllTerminals()
        .filter((t) => ctx.store.getWorkspace(t.workspaceId)?.folder === b.data.projectPath);
      const running = await terminalsRunningSession(link, candidates, b.data.projectPath, (n) => ctx.tmux.panePid(n));
      for (const t of running) ctx.store.updateTerminal(t.id, { title: b.data.name, auto: true });
    } catch { /* detection failed — the session rename itself still stands */ }
    return { ok: true };
  });

  // Cascade-delete a session, its forks, and its Terminal Hub prefs.
  app.post("/api/claude/delete", async (req, reply) => {
    const b = z.object({
      agent: agentSchema,
      sessionId: sessionIdSchema,
      projectPath: z.string().min(1),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const deleted = await ctx.claude.delete(b.data.agent, b.data.sessionId, b.data.projectPath);
    for (const id of deleted) ctx.store.deleteClaudePref(id);
    return { ok: true, deleted };
  });

  // Clone a session into a new UUID.
  app.post("/api/claude/fork", async (req, reply) => {
    const b = z.object({
      agent: agentSchema,
      sessionId: sessionIdSchema,
      projectPath: z.string().min(1),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    try {
      const newSessionId = await ctx.claude.fork(b.data.agent, b.data.sessionId, b.data.projectPath);
      return { newSessionId };
    } catch (err) {
      return forkFail(reply, err);
    }
  });

  // Fork a session truncated at a given line index, repairing the self-referenced sessionId.
  app.post("/api/claude/fork-from-line", async (req, reply) => {
    const b = z.object({
      agent: agentSchema,
      sessionId: sessionIdSchema,
      projectPath: z.string().min(1),
      lineIndex: z.number().int().min(0),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    try {
      const newSessionId = await ctx.claude.forkFromLine(b.data.agent, b.data.sessionId, b.data.projectPath, b.data.lineIndex);
      return { newSessionId };
    } catch (err) {
      return forkFail(reply, err);
    }
  });

  // Cross-CLI fork: clone a session into the OTHER CLI, translating the transcript format.
  app.post("/api/claude/fork-cross", async (req, reply) => {
    const b = z.object({
      agent: agentSchema,
      sessionId: sessionIdSchema,
      projectPath: z.string().min(1),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    try {
      return await ctx.claude.forkCross(b.data.agent, b.data.sessionId, b.data.projectPath);
    } catch (err) {
      return forkFail(reply, err);
    }
  });

  // Delete inclusive line ranges from a transcript, repairing the conversation chain.
  app.post("/api/claude/entries/delete", async (req, reply) => {
    const b = z.object({
      jsonlPath: z.string().min(1),
      agent: agentSchema,
      ranges: z.array(z.tuple([z.number().int().min(0), z.number().int().min(0)])).min(1),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const safe = safeSessionPath(b.data.jsonlPath);
    if (!safe) return reply.code(400).send({ error: "path outside session roots" });
    const { removed } = await deleteEntries(safe, b.data.agent, b.data.ranges);
    return { ok: true, removed };
  });

  // Replace an inclusive line range with a single AI-generated summary entry.
  app.post("/api/claude/entries/summarize", async (req, reply) => {
    const b = z.object({
      jsonlPath: z.string().min(1),
      agent: agentSchema,
      startLine: z.number().int().min(0),
      endLine: z.number().int().min(0),
      providerId: z.string().min(1).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const safe = safeSessionPath(b.data.jsonlPath);
    if (!safe) return reply.code(400).send({ error: "path outside session roots" });

    const first = Math.min(b.data.startLine, b.data.endLine);
    const last = Math.max(b.data.startLine, b.data.endLine);
    const conversation = await buildConversationText(safe, b.data.agent, first, last);
    const prompt =
      "Summarize this conversation concisely. Preserve key decisions, context, and action items. Use bullet points.\n\n---\n" +
      conversation + "\n---";

    let summary: string;
    try {
      summary = await ctx.ai.generate(prompt, b.data.providerId);
    } catch (err: any) {
      if (err instanceof AiError) return reply.code(400).send({ error: err.message });
      return reply.code(500).send({ error: err?.message ?? "summarization failed" });
    }

    await replaceRangeWithSummary(safe, b.data.agent, b.data.startLine, b.data.endLine, summary);
    return { ok: true };
  });

  // Auto-title source for a terminal running a Claude session: detect the session in the pane and
  // build a clean tab name from its first prompt (or custom session name) — the SAME source the
  // session browser uses, so it survives a long/wrapped first prompt the on-screen capture can't
  // read. Claude only (only `claude` writes the ~/.claude/sessions PID files); other agents get
  // null here and fall back to the in-pane capture. Polled by the client until it returns a title.
  app.get("/api/terminals/:id/agent-title", async (req, reply) => {
    const { id } = req.params as { id: string };
    const term = ctx.store.getTerminal(id);
    if (!term) return reply.code(404).send({ error: "terminal not found" });
    const ws = ctx.store.getWorkspace(term.workspaceId);
    if (!ws) return reply.code(404).send({ error: "workspace not found" });
    const tmuxSession = term.tmuxSession || sessionName(term.workspaceId, term.id);
    const panePid = await ctx.tmux.panePid(tmuxSession);
    const sessionId = await detectSessionForPid(panePid, undefined, ws.folder);
    if (!sessionId) return { title: null };
    const projectDir = claudeProjectDir(ws.folder);
    const customName = (await getCustomNames(projectDir))[sessionId];
    let firstPrompt: string | undefined;
    try { firstPrompt = await getFirstUserMessage(path.join(projectDir, `${sessionId}.jsonl`), "claude"); }
    catch { /* transcript not written / readable yet — leave undefined */ }
    return { title: claudeTerminalTitle(firstPrompt, customName) };
  });

  // Fork-from-terminal: detect the Claude session running inside a terminal's shell (detection is
  // Claude-only — only `claude` writes ~/.claude/sessions PID files) and clone it. The detect→fork
  // sequence + the claude-only assumption live here, server-side, beside the other fork variants.
  app.post("/api/claude/fork-from-terminal", async (req, reply) => {
    const b = z.object({ terminalId: z.string().min(1) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const term = ctx.store.getTerminal(b.data.terminalId);
    if (!term) return reply.code(404).send({ error: "terminal not found" });
    const ws = ctx.store.getWorkspace(term.workspaceId);
    if (!ws) return reply.code(404).send({ error: "workspace not found" });
    // Prefer the stored tmux session name; fall back to deriving it from the ids.
    const tmuxSession = term.tmuxSession || sessionName(term.workspaceId, term.id);
    const panePid = await ctx.tmux.panePid(tmuxSession);
    const sessionId = (await detectSessionForPid(panePid, undefined, ws.folder)) ?? null;
    if (!sessionId) return { sessionId: null, newSessionId: null };
    try {
      const newSessionId = await ctx.claude.fork("claude", sessionId, ws.folder);
      return { sessionId, newSessionId };
    } catch (err) {
      return forkFail(reply, err);
    }
  });
}
