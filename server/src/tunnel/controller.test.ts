import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTunnelController, makeDefaultSpawn, buildQuickTunnelScript, type TunnelSpawn, type TunnelPersist } from "./controller.js";

// Let queued microtasks + setTimeout(0) settle so the pid/url promise .then handlers run.
const flush = () => new Promise((r) => setTimeout(r, 0));

// In-memory persistence stand-in so tests never touch the filesystem.
function memPersist(initial: { pid: number; url: string; port: number } | null = null) {
  let saved = initial;
  const persist: TunnelPersist = {
    load: () => saved,
    save: (s) => { saved = s; },
    clear: () => { saved = null; },
  };
  return { persist, get: () => saved };
}

// Spawn stand-in: records the ports it was asked for, hands back a pid promise + a url promise we control.
// The real spawn now learns the pid asynchronously (it's read off `sh`'s stdout), so pid is a Promise.
function spawner(opts: { pid?: number | Promise<number>; url?: Promise<string> } = {}) {
  const ports: number[] = [];
  const spawn: TunnelSpawn = (port) => {
    ports.push(port);
    const pid = opts.pid instanceof Promise ? opts.pid : Promise.resolve(opts.pid ?? 4242);
    return { pid, url: opts.url ?? Promise.resolve("https://x.trycloudflare.com") };
  };
  return { spawn, ports };
}

describe("tunnel controller", () => {
  it("starts idle when nothing is persisted", () => {
    const t = createTunnelController({ spawn: spawner().spawn });
    expect(t.status()).toEqual({ status: "idle" });
  });

  it("spawns cloudflared at the given port and reports starting immediately", () => {
    const s = spawner();
    const t = createTunnelController({ spawn: s.spawn });
    expect(t.start(5173)).toEqual({ status: "starting", port: 5173 });
    expect(s.ports).toEqual([5173]);
  });

  it("becomes running when the url promise resolves", async () => {
    const s = spawner({ pid: 111, url: Promise.resolve("https://happy-tree-1234.trycloudflare.com") });
    const t = createTunnelController({ spawn: s.spawn, pidAlive: () => true });
    t.start(8189);
    await flush();
    expect(t.status()).toEqual({ status: "running", port: 8189, url: "https://happy-tree-1234.trycloudflare.com" });
  });

  it("persists the resolved pid+url+port once running so a restart can re-adopt it", async () => {
    const mem = memPersist();
    const s = spawner({ pid: 777, url: Promise.resolve("https://kept.trycloudflare.com") });
    const t = createTunnelController({ spawn: s.spawn, persist: mem.persist });
    t.start(5173);
    await flush();
    expect(mem.get()).toEqual({ pid: 777, url: "https://kept.trycloudflare.com", port: 5173 });
  });

  it("re-adopts a still-alive tunnel from persisted state without spawning", () => {
    const mem = memPersist({ pid: 999, url: "https://alive.trycloudflare.com", port: 5173 });
    const s = spawner();
    const t = createTunnelController({ spawn: s.spawn, persist: mem.persist, pidAlive: () => true });
    expect(t.status()).toEqual({ status: "running", port: 5173, url: "https://alive.trycloudflare.com" });
    expect(s.ports).toEqual([]); // never spawned — adopted the live process
  });

  it("clears stale persisted state when the saved pid is dead", () => {
    const mem = memPersist({ pid: 999, url: "https://dead.trycloudflare.com", port: 5173 });
    const t = createTunnelController({ spawn: spawner().spawn, persist: mem.persist, pidAlive: () => false });
    expect(t.status()).toEqual({ status: "idle" });
    expect(mem.get()).toBeNull();
  });

  it("status flips a running tunnel to idle once its process dies", async () => {
    let alive = true;
    const mem = memPersist();
    const s = spawner({ pid: 222, url: Promise.resolve("https://x.trycloudflare.com") });
    const t = createTunnelController({ spawn: s.spawn, persist: mem.persist, pidAlive: () => alive });
    t.start(5173);
    await flush();
    expect(t.status().status).toBe("running");
    alive = false;
    expect(t.status()).toEqual({ status: "idle" });
    expect(mem.get()).toBeNull();
  });

  it("reports a friendly install hint when cloudflared is missing (ENOENT)", async () => {
    const enoent = Object.assign(new Error("spawn cloudflared ENOENT"), { code: "ENOENT" });
    const t = createTunnelController({ spawn: spawner({ url: Promise.reject(enoent) }).spawn });
    t.start(5173);
    await flush();
    expect(t.status().status).toBe("error");
    expect((t.status() as { message: string }).message).toContain("brew install cloudflared");
  });

  it("reports an error if the url never arrives (timeout/reject)", async () => {
    const t = createTunnelController({ spawn: spawner({ url: Promise.reject(new Error("timed out")) }).spawn });
    t.start(5173);
    await flush();
    expect(t.status()).toMatchObject({ status: "error" });
  });

  it("stop kills the process by pid, clears persistence, and returns idle", async () => {
    const killed: number[] = [];
    const mem = memPersist();
    const s = spawner({ pid: 555, url: Promise.resolve("https://x.trycloudflare.com") });
    const t = createTunnelController({ spawn: s.spawn, persist: mem.persist, killPid: (p) => killed.push(p) });
    t.start(5173);
    await flush();
    expect(t.stop()).toEqual({ status: "idle" });
    expect(killed).toEqual([555]);
    expect(mem.get()).toBeNull();
    expect(t.status()).toEqual({ status: "idle" });
  });

  it("a stop before the url resolves does not later flip to running", async () => {
    let resolveUrl!: (u: string) => void;
    const pending = new Promise<string>((res) => { resolveUrl = res; });
    const t = createTunnelController({ spawn: spawner({ url: pending }).spawn, killPid: () => {} });
    t.start(5173);
    t.stop();
    resolveUrl("https://late.trycloudflare.com");
    await flush();
    expect(t.status()).toEqual({ status: "idle" });
  });

  it("a stop before the pid arrives still reaps the process once its pid resolves", async () => {
    let resolvePid!: (n: number) => void;
    const pidP = new Promise<number>((res) => { resolvePid = res; });
    const killed: number[] = [];
    const t = createTunnelController({
      spawn: spawner({ pid: pidP, url: new Promise<string>(() => {}) }).spawn, // url never settles
      killPid: (p) => killed.push(p),
    });
    t.start(5173);
    t.stop();          // pid unknown yet — nothing to kill at this instant
    resolvePid(31337); // the daemonized process's real pid finally surfaces
    await flush();
    expect(killed).toEqual([31337]); // reaped anyway — a stopped tunnel must never be orphaned
    expect(t.status()).toEqual({ status: "idle" });
  });

  it("is idempotent: starting again while running does not spawn a second process", async () => {
    const s = spawner();
    const t = createTunnelController({ spawn: s.spawn });
    t.start(5173);
    await flush();
    expect(t.start(5173)).toMatchObject({ status: "running" });
    expect(s.ports).toEqual([5173]); // only one spawn
  });

  // The load-bearing flags of the daemonize script. `--config /dev/null` is the bug fix: without it the
  // quick tunnel inherits the user's ~/.cloudflared/config.yml, whose ingress catch-all (http_status:404)
  // 404s every request whose hostname isn't the named tunnel's — so a live quick tunnel still served 404.
  it("builds a script that ignores the user's cloudflared config and targets the given port", () => {
    const s = buildQuickTunnelScript(5173, "/tmp/cf.log");
    expect(s).toContain("--config /dev/null");                 // do NOT inherit ~/.cloudflared/config.yml
    expect(s).toContain("--url 'http://127.0.0.1:5173'");      // serve our local origin
    expect(s).toContain("--no-autoupdate");
    expect(s).toContain("> '/tmp/cf.log' 2>&1");               // cloudflared output → logfile we poll
    expect(s).toMatch(/& echo \$!$/);                          // background it, then print the reparented pid
  });

  // Real-process integration check (no dev server): a bogus binary makes `sh` log "command not found",
  // which the spawner must translate into the friendly install hint rather than a blind timeout.
  it("makeDefaultSpawn surfaces the install hint when the binary is missing", async () => {
    const log = join(tmpdir(), `tr-tunnel-test-${process.pid}.log`);
    const h = makeDefaultSpawn(log, "tr-cloudflared-does-not-exist-zzz")(5999);
    await expect(h.url).rejects.toThrow(/install/i);
  });
});
