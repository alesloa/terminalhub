import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { healthRoutes } from "./routes/health.js";
import { fsRoutes } from "./routes/fs.js";
import { driveRoutes } from "./routes/drive.js";
import { searchRoutes } from "./routes/search.js";
import { spaceRoutes } from "./routes/spaces.js";
import { spacePresetRoutes } from "./routes/spacePresets.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { folderRoutes } from "./routes/folders.js";
import { terminalRoutes } from "./routes/terminals.js";
import { settingsRoutes } from "./routes/settings.js";
import { wallpaperRoutes } from "./routes/wallpapers.js";
import { agentRoutes } from "./routes/agents.js";
import { attentionRoutes } from "./routes/attention.js";
import { workingRoutes } from "./routes/working.js";
import { systemRoutes } from "./routes/system.js";
import { previewRoutes } from "./routes/preview.js";
import { mediaRoutes } from "./routes/media.js";
import { previewRewriteUrl } from "./preview/rewrite.js";
import { gitRoutes } from "./routes/git.js";
import { cloneJobRoutes } from "./routes/cloneJobs.js";
import { aiRoutes } from "./routes/ai.js";
import { claudeRoutes } from "./routes/claude.js";
import { guiRoutes } from "./routes/gui.js";
import { claudeUsageRoutes } from "./routes/claudeUsage.js";
import { codexUsageRoutes } from "./routes/codexUsage.js";
import { skillsRoutes } from "./routes/skills.js";
import { bookmarkRoutes } from "./routes/bookmarks.js";
import { favoritesRoutes } from "./routes/favorites.js";
import { blueprintRoutes } from "./routes/blueprints.js";
import { notesRoutes } from "./routes/notes.js";
import { noteGroupsRoutes } from "./routes/noteGroups.js";
import { linksRoutes } from "./routes/links.js";
import { stickyNotesRoutes } from "./routes/stickyNotes.js";
import { spaceWidgetsRoutes } from "./routes/spaceWidgets.js";
import { boardRoutes } from "./routes/board.js";
import { timeRoutes } from "./routes/time.js";
import { timeCatalogRoutes } from "./routes/timeCatalog.js";
import { tvRoutes } from "./routes/tv.js";
import { copilotRoutes } from "./routes/copilot.js";
import { sttRoutes } from "./routes/stt.js";
import { notifyRoutes } from "./routes/notify.js";
import { secretRoutes } from "./routes/secret.js";
import { reminderRoutes } from "./routes/reminders.js";
import { notificationRoutes } from "./routes/notifications.js";
import { pushoverRoutes } from "./routes/pushover.js";
import { voicesRoutes } from "./routes/voices.js";
import { lspRoutes } from "./routes/lsp.js";
import { accessKeyRoutes } from "./routes/accessKeys.js";
import { tunnelRoutes } from "./routes/tunnel.js";
import { terminalGateway } from "./ws/terminalGateway.js";
import { guiGateway } from "./ws/guiGateway.js";
import { lspGateway } from "./ws/lspGateway.js";
import { claudeActivityGateway } from "./ws/claudeActivityGateway.js";
import { notificationGateway } from "./ws/notificationGateway.js";
import { copilotGateway } from "./ws/copilotGateway.js";
import { fileWatchGateway } from "./ws/fileWatchGateway.js";
import { presenceGateway } from "./ws/presenceGateway.js";
import type { Config } from "./config.js";
import type { AppContext } from "./context.js";
import { isLoopback, isForwardedRequest } from "./auth/guard.js";
import { resolvePrincipal, type Principal } from "./auth/access.js";
import { isDocumentPath, shouldServeBlank } from "./auth/stealth.js";

export async function buildApp(config: Config, ctx: AppContext): Promise<FastifyInstance> {
  // logger on for errors + the boot reconcile line, but `disableRequestLogging` silences the
  // per-request "incoming request"/"request completed" pair — otherwise the frontend's ~1s polls
  // (system/stats, attention, git/status, fs/list) flood the dev terminal. 500s still log via the
  // default error handler, so real failures stay visible.
  const app = Fastify({
    logger: true,
    disableRequestLogging: true,
    // Re-route a framed preview app's absolute-path sub-resources (/assets/…, fetched from the origin
    // root) back to their /api/preview/<port> upstream, recovered from the Referer. Runs before
    // routing; pure + defensive (returns the URL unchanged for everything else). See preview/rewrite.ts.
    rewriteUrl: (req) => previewRewriteUrl(req.url ?? "/", req.headers.referer),
  });

  await app.register(websocket);

  // Every /api/* request carries the resolved caller after the preHandler: { kind:"main" } for the
  // owner (loopback or the configured token) or { kind:"key", keyId } for a teammate on a temp link.
  // null on requests that skip the gate (health/preview/static). Read by the owner-only access-key routes.
  app.decorateRequest("principal", null);

  // Stealth curtain: on an exposed host with TERMINALHUB_REVEAL set, drop a blank page for any
  // navigation that lacks the reveal flag. Runs before everything else and only touches HTML
  // document requests — assets stay hash-named/undiscoverable, /api stays token-gated below.
  app.addHook("onRequest", async (req, reply) => {
    if (!config.reveal) return;
    if (req.method !== "GET" && req.method !== "HEAD") return;
    const [path, query = ""] = req.url.split("?");
    if (!isDocumentPath(path)) return;
    const exposed = Boolean(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"]) || !isLoopback(req.ip);
    if (shouldServeBlank({ reveal: config.reveal, exposed, queryString: query })) {
      return reply.code(200).type("text/html").send("");
    }
  });

  app.addHook("preHandler", async (req, reply) => {
    if (req.url.startsWith("/api/health")) return;
    // The localhost-preview proxy does its own cookie-aware auth (an <iframe> can't send a Bearer
    // header) — let it through here so the cookie path isn't pre-empted by the Bearer-only check.
    if (req.url.startsWith("/api/preview/")) return;
    // The media stream feeds a <video src>, which can't send a Bearer header (same constraint as the
    // preview <iframe>) — let it through so its own cookie/query/bearer-aware auth runs in the route.
    if (req.url.startsWith("/api/media/")) return;
    if (!req.url.startsWith("/api/")) return; // static assets handled elsewhere
    const principal = resolvePrincipal(ctx, config, {
      remoteAddr: req.ip,
      header: req.headers["authorization"],
      forwarded: isForwardedRequest(req.headers as Record<string, string | string[] | undefined>),
    });
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    (req as { principal?: Principal }).principal = principal;
  });

  await app.register(healthRoutes);
  await app.register(fsRoutes);
  await app.register(async (a) => driveRoutes(a, ctx, config));
  await app.register(searchRoutes);
  await app.register(async (a) => spaceRoutes(a, ctx));
  await app.register(async (a) => spacePresetRoutes(a, ctx));
  await app.register(async (a) => workspaceRoutes(a, ctx));
  await app.register(async (a) => folderRoutes(a, ctx));
  await app.register(async (a) => terminalRoutes(a, ctx));
  await app.register(async (a) => settingsRoutes(a, ctx));
  await app.register(async (a) => wallpaperRoutes(a, ctx));
  await app.register(async (a) => agentRoutes(a, ctx));
  await app.register(async (a) => attentionRoutes(a, ctx));
  await app.register(async (a) => workingRoutes(a, ctx));
  await app.register(systemRoutes);
  await app.register(async (a) => previewRoutes(a, config));
  await app.register(async (a) => mediaRoutes(a, config));
  await app.register(async (a) => gitRoutes(a, ctx));
  await app.register(async (a) => cloneJobRoutes(a, ctx));
  await app.register(async (a) => aiRoutes(a, ctx));
  await app.register(async (a) => claudeRoutes(a, ctx));
  await app.register(async (a) => guiRoutes(a, ctx));
  await app.register(async (a) => claudeUsageRoutes(a, ctx));
  await app.register(async (a) => codexUsageRoutes(a, ctx));
  await app.register(async (a) => skillsRoutes(a, ctx));
  await app.register(async (a) => bookmarkRoutes(a, ctx));
  await app.register(async (a) => favoritesRoutes(a, ctx));
  await app.register(async (a) => blueprintRoutes(a, ctx));
  await app.register(async (a) => notesRoutes(a, ctx));
  await app.register(async (a) => noteGroupsRoutes(a, ctx));
  await app.register(async (a) => linksRoutes(a, ctx));
  await app.register(async (a) => stickyNotesRoutes(a, ctx));
  await app.register(async (a) => spaceWidgetsRoutes(a, ctx));
  await app.register(async (a) => boardRoutes(a, ctx));
  await app.register(async (a) => timeRoutes(a, ctx));
  await app.register(async (a) => timeCatalogRoutes(a, ctx));
  await app.register(async (a) => tvRoutes(a, ctx));
  await app.register(async (a) => copilotRoutes(a, ctx));
  await app.register(async (a) => sttRoutes(a, ctx));
  await app.register(async (a) => notifyRoutes(a, ctx));
  await app.register(async (a) => secretRoutes(a, config));
  await app.register(async (a) => reminderRoutes(a, ctx));
  await app.register(async (a) => notificationRoutes(a, ctx));
  await app.register(async (a) => pushoverRoutes(a, ctx));
  await app.register(async (a) => voicesRoutes(a, ctx));
  await app.register(lspRoutes);
  await app.register(async (a) => accessKeyRoutes(a, ctx));
  await app.register(async (a) => tunnelRoutes(a, ctx));
  await app.register(async (a) => terminalGateway(a, ctx, config));
  await app.register(async (a) => guiGateway(a, ctx, config));
  await app.register(async (a) => lspGateway(a, ctx, config));
  await app.register(async (a) => claudeActivityGateway(a, ctx, config));
  await app.register(async (a) => notificationGateway(a, ctx, config));
  await app.register(async (a) => copilotGateway(a, ctx, config));
  await app.register(async (a) => fileWatchGateway(a, ctx, config));
  await app.register(async (a) => presenceGateway(a, ctx, config));

  // Serve the built SPA in production (skipped in dev where Vite serves the frontend).
  // Resolve relative to this compiled file (server/dist/app.js → ../../web/dist), NOT
  // process.cwd() — launching `npm start` from inside server/ otherwise 404s the whole SPA.
  const webDist = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "dist");
  if (existsSync(join(webDist, "index.html"))) {
    // wildcard:true (default) serves assets from disk per-request — correct MIME
    // types, and new build hashes work without restarting the server.
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api") || req.url.startsWith("/ws")) return reply.code(404).send({ error: "not found" });
      return reply.sendFile("index.html"); // SPA fallback
    });
  }

  return app;
}
