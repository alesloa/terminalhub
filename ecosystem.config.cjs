// PM2 process config for Terminalhub.
// CommonJS (.cjs) because the repo is ESM ("type":"module") and PM2 loads config with require().
// Runs the same entry as `npm start`: scripts/start.mjs boots server/dist/index.js.
// PORT defaults to 5173 inside start.mjs; HOST defaults to 127.0.0.1 (loopback). Override via env below.
const path = require("node:path");

module.exports = {
  apps: [
    {
      name: "terminalhub",
      script: "scripts/start.mjs",
      cwd: __dirname, // so the default DB path (data/terminalhub.db) resolves to the repo root
      interpreter: "node",
      exec_mode: "fork", // single instance: tmux/node-pty/sqlite + WS state are not cluster-safe
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        // Use the existing dev database (server/data/terminalhub.db) — the one that holds all
        // workspaces/terminals/settings. `npm run dev` runs from the server/ cwd, so its default
        // "data/terminalhub.db" lives there. Absolute path so it's the same DB regardless of cwd.
        TERMINALHUB_DB: path.join(__dirname, "server", "data", "terminalhub.db"),
      },
    },
  ],
};
