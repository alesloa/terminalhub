import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { loadDotenv } from "./env.js";
import { createContext } from "./context.js";
import { reconcile } from "./reconcile.js";

// Load the repo-root .env before reading config, so TERMINALHUB_TOKEN et al. can live
// in a file instead of the shell. Resolves two levels up from this module — works
// the same in dev (server/src/index.ts) and prod (server/dist/index.js).
loadDotenv(resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env"));

const config = loadConfig();
mkdirSync(dirname(config.dbPath), { recursive: true });
const ctx = createContext(config.dbPath, config.google);
const app = await buildApp(config, ctx);
await app.listen({ port: config.port, host: config.host });

const r = await reconcile(ctx);
app.log.info(`reconcile: ${r.alive} live terminals, ${r.dead} dead`);

// Scrub hub/PM2 leakage (PORT, NODE_ENV, TERMINALHUB_*, pm_*) from the tmux server's GLOBAL
// environment if it was captured before this boot. New terminals then start with a clean shell;
// already-open panes keep their env until recreated (tmux can't edit a live shell).
const scrubbed = await ctx.tmux.scrubGlobalEnv();
if (scrubbed.length) app.log.info(`tmux: scrubbed leaked global env (${scrubbed.join(", ")})`);

// Reminder scheduler: fire anything that came due while the server was down (tagged "(missed)"),
// then poll for due reminders on an interval. Started after listen so a fire can reach connected
// dashboards. Survives restarts via the reminders table — no per-event timers.
await ctx.scheduler.catchUp();
ctx.scheduler.start();

// Copilot loops: run any job that came due while the server was down (one catch-up tick), then poll
// for due jobs on an interval. Survives restarts via the copilot_jobs table — no per-job timers.
await ctx.copilotScheduler.tick(Date.now());
ctx.copilotScheduler.start();

// Attention watcher: turn newly-rung tmux bells into persisted, cross-browser agent notifications.
// The first tick seeds (records bells already ringing without toasting them), then poll on an interval.
await ctx.attentionWatcher.tick();
ctx.attentionWatcher.start();

// Attention is bell-only. Arm bell monitoring on sessions that predate this boot (bell default is on,
// but a user's tmux config may have disabled it), and DISARM silence monitoring (set to 0) so sessions
// armed by an older build stop flagging — a quiet pane must no longer earn attention.
for (const s of await ctx.tmux.listSessions()) {
  try {
    await ctx.tmux.setMonitorBell(s);
    await ctx.tmux.setMonitorSilence(s, 0);
  } catch { /* session vanished mid-boot */ }
}

// Wipe any pasted-clipboard images left over from a previous run — they're single-use, and
// per-terminal cleanup can't fire if the server was killed. Keeps the dir from ever growing.
for (const ws of ctx.store.listWorkspaces()) {
  try { ctx.clip.clearWorkspace(ws.folder); } catch { /* folder gone/unwritable */ }
}

// Expire temp access links on their own: every minute, delete any whose expiresAt has passed, so a
// link with a time limit "deletes itself" even if the manager is never opened. (getValid/list also
// sweep on read; this covers a server left idle with no traffic.)
setInterval(() => { try { ctx.store.sweepAccessKeys(); } catch { /* sweep is best-effort */ } }, 60_000).unref();

// NOTE: we deliberately do NOT stop the tunnel on shutdown. cloudflared runs detached with its pid+url
// persisted, so a tsx-watch reload (or terminal Ctrl-C) leaves it running and the next boot re-adopts it
// — the public URL stays valid across restarts. The tunnel dies only when the owner clicks Stop
// (DELETE /api/tunnel) or the box reboots.
