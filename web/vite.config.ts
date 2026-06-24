import { defineConfig, loadEnv, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Dev-only mirror of the backend's preview rewrite (server/src/preview/rewrite.ts). When terminalhub is
// served by THIS Vite dev server and viewed remotely, a previewed app's absolute-path sub-resources
// (/@vite/client, /src/*, /assets/*, fetched from the origin root) would otherwise be served as
// TERMINALHUB's own modules — mounting terminalhub inside the preview iframe. Recover the owning port from
// the Referer and re-prefix to /api/preview/<port>/… BEFORE Vite's internal middlewares, so the /api
// proxy below forwards them to the backend's preview proxy. (Prod has no Vite layer; the backend's
// rewriteUrl does this there.) Runs before internal middlewares because it's added in the
// configureServer body, not its returned post-hook.
const previewSubresourceRewrite: PluginOption = {
  name: "terminalhub:preview-subresource-rewrite",
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const ref = req.headers.referer;
      const url = req.url;
      if (ref && url && !url.startsWith("/api/")) {
        const m = /\/api\/preview\/(\d{1,5})(?:\/|$)/.exec(ref);
        if (m) req.url = `/api/preview/${m[1]}${url}`;
      }
      next();
    });
  },
};

// Read the repo-root .env (same file the server loads) so the dev-server host
// allowlist isn't hardcoded. `""` prefix = read all keys, not just VITE_*.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "");
  const backendPort = env.PORT ?? "8189";
  const raw = (env.TERMINALHUB_ALLOWED_HOSTS ?? "").trim();
  // `*` / `true` disables the check (any host); otherwise a comma list of hosts. `.trycloudflare.com` is
  // always allowed so the one-click Quick Tunnel's random `*.trycloudflare.com` host isn't 403'd — only a
  // tunnel YOU started can route such a host to this machine, so allowing that domain is safe and scoped.
  const allowedHosts =
    raw === "*" || raw === "true"
      ? true
      : [
          ...raw
            .split(",")
            .map((h) => h.trim())
            .filter(Boolean),
          ".trycloudflare.com",
        ];

  return {
    plugins: [react(), previewSubresourceRewrite],
    server: {
      host: true,
      port: 5173,
      // Tunnel targets 5173. If it's taken, fail loudly instead of drifting to
      // 5174 and silently serving the wrong app through the tunnel.
      strictPort: true,
      allowedHosts,
      // The repo lives on a separate /Volumes APFS volume, where macOS fsevents (and thus Vite's
      // default file watcher) intermittently MISS saves — edits silently fail to hot-reload and the
      // dev server keeps serving stale modules. Poll instead so every save on this volume is caught.
      watch: { usePolling: true, interval: 120 },
      proxy: {
        "/api": { target: `http://127.0.0.1:${backendPort}`, xfwd: true },
        "/ws":  { target: `ws://127.0.0.1:${backendPort}`,  ws: true, xfwd: true },
      },
    },
    build: { outDir: "dist" },
  };
});
