import type { FastifyInstance } from "fastify";
import { detectLanguageServers } from "../lsp/registry.js";

/** Language-server detection for the editor. The web side reads this to (a) decide whether to open an
 *  LSP socket for a file's language and (b) toast "install <server>" when the file's server is missing. */
export async function lspRoutes(app: FastifyInstance) {
  app.get("/api/lsp/servers", async () => ({ servers: detectLanguageServers() }));
}
