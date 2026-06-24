import type { FastifyInstance } from "fastify";
import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import type { AppContext } from "../context.js";
import { authorizeWs } from "./wsAuth.js";
import type { Config } from "../config.js";
import { getRunningSessions } from "../claude/running.js";
import { computeSessionState, scanMarkerFiles, MARKER_DIR } from "../claude/activity.js";
import { claudeProjectDir, claudeSessionsDir } from "../claude/paths.js";

// Real-time per-session activity stream for the web session manager. Mirrors the extension's
// state machine: a running session is `active` (processing) or `waiting` (amber, a permission
// prompt marker is present) or — once it stops processing without the user acknowledging —
// `finished` (the slow green blink), otherwise `idle`. Recomputed on a 1s poll and on (debounced)
// fs.watch events, and pushed only when the state map actually changes.
//
// Only RUNNING sessions can have a non-idle state, and a running session is Claude-only (only
// `claude` writes ~/.claude/sessions PID files) with a deterministic transcript path. So instead
// of building the full, expensive session list every tick (recursive Codex scan + sidecar JSON
// reads), we read just the PID map + markers and tail the handful of live transcripts. The map we
// send is partial — the client treats any missing id as idle — so stopped sessions drop out.

const POLL_INTERVAL_MS = 1_000;
const WATCH_DEBOUNCE_MS = 200;

type ActivityState = "active" | "waiting" | "finished" | "idle";

export async function claudeActivityGateway(app: FastifyInstance, ctx: AppContext, config: Config) {
  app.get("/ws/claude-activity", { websocket: true }, (socket, req) => {
    // auth on the upgrade request — identical pattern to terminalGateway
    const url = new URL(req.url, "http://localhost");
    if (!authorizeWs(ctx, config, socket, req, url.searchParams.get("token"))) return;

    const projectPath = url.searchParams.get("path");
    if (!projectPath) { socket.close(1011, "path required"); return; }

    // Per-session memory of whether it was ever active in this connection, so we can show the
    // "finished" blink (was active → now idle, unacknowledged). Mirrors the extension's
    // wasActive/acknowledged frontend bookkeeping, kept server-side here.
    const wasActive = new Set<string>();
    const acknowledged = new Set<string>();
    let lastSerialized = "";
    const watchers: FSWatcher[] = [];
    let timer: ReturnType<typeof setInterval> | undefined;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let computing = false;

    async function buildStates(): Promise<Record<string, ActivityState>> {
      const [running, waiting] = await Promise.all([getRunningSessions(), scanMarkerFiles()]);

      // Only this project's live sessions matter; their transcript path is deterministic.
      const ids = [...running].filter(([, cwd]) => cwd === projectPath).map(([id]) => id);
      const live = new Set(ids);
      // Drop blink bookkeeping for sessions that are no longer running here.
      for (const id of [...wasActive]) if (!live.has(id)) { wasActive.delete(id); acknowledged.delete(id); }

      // Tail the live transcripts in parallel (a running session is Claude-only).
      const computed = await Promise.all(ids.map(async (id) => {
        if (waiting.has(id)) return [id, "waiting"] as const;
        const jsonlPath = path.join(claudeProjectDir(projectPath!), `${id}.jsonl`);
        return [id, await computeSessionState(jsonlPath)] as const;
      }));

      const states: Record<string, ActivityState> = {};
      for (const [id, state] of computed) {
        if (state === "waiting" || state === "active") {
          wasActive.add(id);
          acknowledged.delete(id);
          states[id] = state;
        } else if (wasActive.has(id) && !acknowledged.has(id)) {
          states[id] = "finished"; // was processing, now stopped, user hasn't looked yet
        }
        // else: running but idle/acknowledged → omit (client renders it as idle)
      }
      return states;
    }

    async function tick() {
      if (computing || socket.readyState !== socket.OPEN) return;
      computing = true;
      try {
        const states = await buildStates();
        const serialized = JSON.stringify(states);
        if (serialized !== lastSerialized) {
          lastSerialized = serialized;
          socket.send(JSON.stringify({ type: "activity", states }));
        }
      } catch {
        // transient fs error — try again next tick
      } finally {
        computing = false;
      }
    }

    // Coalesce bursts of writes (an agent appends to its transcript many times per turn) into one
    // recompute, so a single turn doesn't fire dozens of ticks.
    const scheduleTick = () => {
      if (debounce) return;
      debounce = setTimeout(() => { debounce = undefined; void tick(); }, WATCH_DEBOUNCE_MS);
    };

    // Watch the dirs that drive activity: the Claude transcript dir (turn appends), the running-PID
    // dir (start/stop), and the marker dir (permission prompts). Codex has no live activity.
    for (const dir of [claudeProjectDir(projectPath), claudeSessionsDir(), MARKER_DIR]) {
      try {
        const w = watch(dir, { recursive: true }, scheduleTick);
        w.on("error", () => { try { w.close(); } catch { /* already closed */ } });
        watchers.push(w);
      } catch {
        // dir may not exist yet — the poll still covers it
      }
    }

    timer = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
    void tick(); // push once immediately

    socket.on("close", () => {
      if (timer) clearInterval(timer);
      if (debounce) clearTimeout(debounce);
      for (const w of watchers) { try { w.close(); } catch { /* already closed */ } }
    });
  });
}
