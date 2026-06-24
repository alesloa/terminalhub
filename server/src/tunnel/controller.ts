import { spawn as nodeSpawn } from "node:child_process";
import { openSync, closeSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";

// A public Cloudflare "Quick Tunnel" — `cloudflared tunnel --url http://127.0.0.1:<port>`. It needs no
// Cloudflare account and prints a throwaway https://<random>.trycloudflare.com URL that anyone on the
// internet can reach, which we hand to the access-link builder so a teammate off your network can get in.
// One controller per server; owner-only (a key teammate must never start/stop host networking).
//
// DURABILITY (the whole point — mirrors the tmux model): cloudflared is daemonized so it OUTLIVES the
// server process, and its pid+url are persisted. The next server boot re-adopts the still-live process,
// so the public URL stays valid across a tsx-watch reload or a terminal Ctrl-C. It dies only when the
// owner clicks Stop (or the box reboots).
//
// Why daemonize through `sh` instead of a plain detached child: `npm run dev` is `concurrently` →
// `tsx watch`, and BOTH tree-kill on restart by walking child PIDs (PPID). A Node `detached: true` child
// is a new session leader but its PPID is still the server process, so the tree-kill sweeps it up. We
// instead launch via `sh -c '<bin> … & echo $!'`: the shell backgrounds cloudflared and exits, which
// reparents cloudflared to init (PPID 1) — invisible to a PPID-walking tree-kill — and `detached: true`
// on the shell setsids it out of the terminal's foreground group so Ctrl-C's SIGINT misses it too. The
// trade-off is the pid now arrives asynchronously (read off the shell's stdout), hence `pid: Promise`.

export type TunnelState =
  | { status: "idle" }
  | { status: "starting"; port: number }
  | { status: "running"; port: number; url: string }
  | { status: "error"; message: string };

// Spawn returns a promise for the child's pid plus a promise that resolves with the public URL (or
// rejects). Both are async because the daemonized process reports its pid via the launcher shell's
// stdout. Injectable so tests run with no real process or filesystem; production polls the logfile.
export interface TunnelHandle {
  pid: Promise<number>;
  url: Promise<string>;
}
export type TunnelSpawn = (port: number) => TunnelHandle;

// Persisted record of the live tunnel, so a restart re-adopts it instead of orphaning the process.
export interface TunnelPersist {
  load(): { pid: number; url: string; port: number } | null;
  save(s: { pid: number; url: string; port: number }): void;
  clear(): void;
}

export interface TunnelController {
  status(): TunnelState;
  start(port: number): TunnelState;
  stop(): TunnelState;
}

const URL_RE = /https:\/\/[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.trycloudflare\.com/i;
const INSTALL_HINT =
  "cloudflared is not installed. Install it (macOS: brew install cloudflared; " +
  "Linux: https://developers.cloudflare.com/cloudflared), then try again.";
const URL_TIMEOUT_MS = 25_000;

function errMessage(err: unknown): string {
  const e = err as NodeJS.ErrnoException;
  if (e?.code === "ENOENT") return INSTALL_HINT;
  return e?.message || "failed to start cloudflared";
}

// pids ≤ 1 are never real per-process targets (0/-1 address process GROUPS — broadcasting a signal there
// could hit unrelated processes), so treat them as dead and never signal them.
function defaultPidAlive(pid: number): boolean {
  if (pid <= 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } // exists but not ours = still alive
}
function defaultKillPid(pid: number): void {
  if (pid > 1) process.kill(pid, "SIGTERM");
}

// Single-quote a string for safe interpolation into an `sh -c` script.
function shq(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

// The `sh -c` script that daemonizes a quick tunnel. Pure + exported so its load-bearing flags are tested:
//   --config /dev/null  IGNORE the user's ~/.cloudflared/config.yml. A stale named-tunnel config there
//                       (e.g. an ingress ending in `service: http_status:404`) is otherwise inherited by
//                       the quick tunnel and 404s every request whose hostname isn't that named one — so a
//                       perfectly live quick tunnel still served a 404. This is the actual "link is broken" fix.
//   --url               serve our local origin (Vite in dev, Fastify in prod).
//   … & echo $!         background cloudflared and print its pid; `sh` then exits, reparenting cloudflared to
//                       init (PPID 1) so the dev runner's PPID-walking tree-kill can't reach it (durability).
//   > log 2>&1          cloudflared's own output → the logfile we poll for the public URL.
export function buildQuickTunnelScript(port: number, logPath?: string, bin = "cloudflared"): string {
  const target = `http://127.0.0.1:${port}`;
  const redirect = logPath ? `> ${shq(logPath)} 2>&1` : "> /dev/null 2>&1";
  return `${shq(bin)} tunnel --config /dev/null --url ${shq(target)} --no-autoupdate ${redirect} < /dev/null & echo $!`;
}

// Production spawn: daemonize cloudflared via the script above so it reparents to init and survives the dev
// runner's tree-kill (see the DURABILITY note). The launcher shell prints the backgrounded pid on its stdout
// (which we read) while cloudflared's own output goes to the logfile (which we poll for the public URL). A
// missing binary shows up in the log as "command not found", which we translate into the friendly install
// hint instead of a blind timeout. Exported for testing.
export function makeDefaultSpawn(logPath?: string, bin = "cloudflared"): TunnelSpawn {
  return (port) => {
    if (logPath) { try { closeSync(openSync(logPath, "w")); } catch { /* truncate to a fresh file per run */ } }
    const script = buildQuickTunnelScript(port, logPath, bin);
    const child = nodeSpawn("sh", ["-c", script], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
    child.unref(); // don't let the launcher keep the server's event loop alive

    // `sh` itself failing to spawn (≈never) rejects both promises; otherwise the binary's own failure
    // surfaces through the logfile ("command not found") rather than a child 'error' event.
    const rejecters: Array<(e: unknown) => void> = [];
    child.on("error", (err) => rejecters.forEach((r) => r(err)));

    const pid = new Promise<number>((resolve, reject) => {
      rejecters.push(reject);
      let buf = "";
      const grab = () => { const m = buf.match(/\d+/); if (m) { resolve(Number(m[0])); return true; } return false; };
      child.stdout?.on("data", (d) => { buf += String(d); grab(); });
      child.stdout?.on("end", () => { if (!grab()) reject(new Error("could not read the tunnel process id")); });
    });

    const url = new Promise<string>((resolve, reject) => {
      rejecters.push(reject);
      let settled = false;
      const deadline = Date.now() + URL_TIMEOUT_MS;
      const tick = () => {
        if (settled) return;
        let txt = "";
        if (logPath) { try { txt = readFileSync(logPath, "utf8"); } catch { /* not written yet */ } }
        const m = URL_RE.exec(txt);
        if (m) { settled = true; resolve(m[0]); return; }
        if (/not found/i.test(txt)) { settled = true; reject(new Error(INSTALL_HINT)); return; } // bad/missing binary
        if (Date.now() >= deadline) {
          settled = true;
          reject(new Error("timed out waiting for the tunnel URL — check that cloudflared can reach the internet."));
          return;
        }
        setTimeout(tick, 300);
      };
      setTimeout(tick, 300);
    });
    return { pid, url };
  };
}

function makeFsPersist(statePath: string): TunnelPersist {
  return {
    load() {
      try {
        const r = JSON.parse(readFileSync(statePath, "utf8"));
        if (r && typeof r.pid === "number" && typeof r.url === "string" && typeof r.port === "number") return r;
      } catch { /* missing/corrupt = nothing to adopt */ }
      return null;
    },
    save(s) { try { writeFileSync(statePath, JSON.stringify(s)); } catch { /* best-effort */ } },
    clear() { try { unlinkSync(statePath); } catch { /* already gone */ } },
  };
}

export function createTunnelController(opts: {
  spawn?: TunnelSpawn;
  persist?: TunnelPersist;
  statePath?: string;
  logPath?: string;
  pidAlive?: (pid: number) => boolean;
  killPid?: (pid: number) => void;
} = {}): TunnelController {
  const spawn = opts.spawn ?? makeDefaultSpawn(opts.logPath);
  const persist = opts.persist ?? (opts.statePath ? makeFsPersist(opts.statePath) : null);
  const pidAlive = opts.pidAlive ?? defaultPidAlive;
  const killPid = opts.killPid ?? defaultKillPid;

  let state: TunnelState = { status: "idle" };
  let pid: number | null = null;
  // Bumped on every start()/stop(); an in-flight url promise only applies if its generation is still current
  // (guards the start→stop→start race so a late resolve can't resurrect a stopped/replaced tunnel).
  let gen = 0;

  // Re-adopt a tunnel left running by a previous process (a tsx-watch reload), if it's still alive.
  const saved = persist?.load();
  if (saved) {
    if (pidAlive(saved.pid)) { pid = saved.pid; state = { status: "running", port: saved.port, url: saved.url }; }
    else persist?.clear();
  }

  function start(port: number): TunnelState {
    if (state.status === "starting" || state.status === "running") return state; // idempotent
    const myGen = ++gen;
    state = { status: "starting", port };
    let handle: TunnelHandle;
    try { handle = spawn(port); }
    catch (err) { state = { status: "error", message: errMessage(err) }; return state; }

    // The pid surfaces asynchronously (read off the launcher shell's stdout). Record it once known — but
    // if a stop()/restart raced ahead (gen moved on), reap the now-orphaned process instead of adopting
    // it, so a tunnel the owner already stopped can never leak.
    handle.pid.then(
      (p) => { if (myGen === gen) pid = p; else { try { killPid(p); } catch { /* already gone */ } } },
      () => { /* pid never surfaced; the url branch reports the failure */ },
    );

    handle.url.then(
      async (url) => {
        if (myGen !== gen) return;
        let p: number;
        try { p = await handle.pid; }
        catch { if (myGen === gen) { pid = null; state = { status: "error", message: "could not read the tunnel process id" }; } return; }
        if (myGen !== gen) return; // stop()/restart happened while awaiting the pid
        pid = p;
        state = { status: "running", port, url };
        persist?.save({ pid: p, url, port });
      },
      (err) => {
        if (myGen !== gen) return;
        pid = null;
        state = { status: "error", message: errMessage(err) };
      },
    );
    return state;
  }

  function stop(): TunnelState {
    gen++; // invalidate any in-flight start resolution
    if (pid != null) { try { killPid(pid); } catch { /* already gone */ } }
    pid = null;
    persist?.clear();
    state = { status: "idle" };
    return state;
  }

  function status(): TunnelState {
    // A re-adopted (or spawned) tunnel can die out from under us; reflect that instead of lying "running".
    if (state.status === "running" && pid != null && !pidAlive(pid)) {
      pid = null;
      persist?.clear();
      state = { status: "idle" };
    }
    return state;
  }

  return { status, start, stop };
}
