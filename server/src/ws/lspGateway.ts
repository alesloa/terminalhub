import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { authorizeWs } from "./wsAuth.js";
import type { Config } from "../config.js";
import { serverForLanguageId } from "../lsp/registry.js";
import { createLspManager, type LspSocket } from "../lsp/manager.js";

// Custom WS close codes (4000–4999 are application-private). The client uses these to stop retrying
// a permanently-unusable language (no point reconnecting if the server isn't installed).
const CLOSE_NO_SERVER = 4404; // no known/installed language server for this language id

export async function lspGateway(app: FastifyInstance, ctx: AppContext, config: Config) {
  const manager = createLspManager();
  app.addHook("onClose", async () => manager.shutdownAll());

  app.get("/ws/lsp/:workspaceId/:languageId", { websocket: true }, (socket, req) => {
    // auth on the upgrade request — same shape as the terminal gateway (header or ?token=)
    const url = new URL(req.url, "http://localhost");
    if (!authorizeWs(ctx, config, socket, req, url.searchParams.get("token"))) return;

    const { workspaceId, languageId } = req.params as { workspaceId: string; languageId: string };
    const workspace = ctx.store.getWorkspace(workspaceId);
    if (!workspace) { socket.close(1011, "workspace not found"); return; }

    // Resolve + verify the server is actually installed. The browser normally checks
    // /api/lsp/servers first and toasts, so this is a backstop — close with a distinct code so the
    // client's transport doesn't reconnect-loop against a missing binary.
    const server = serverForLanguageId(languageId);
    if (!server || !server.installed) { socket.close(CLOSE_NO_SERVER, "language server unavailable"); return; }

    manager.connect(socket as unknown as LspSocket, { folder: workspace.folder, server });
  });
}
