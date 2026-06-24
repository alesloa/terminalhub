import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { createContext, type AppContext } from "../context.js";
import { claudeProjectDir } from "../claude/paths.js";
import { getCustomNames } from "../claude/names.js";
import { terminalRoutes } from "./terminals.js";
import { claudeRoutes } from "./claude.js";

// Two-way terminal⇄session name sync. Both directions are exercised over the launch-command link
// (`claude --resume <id>`), which resolves without tmux/ps — deterministic in a unit harness.

const PROJECT = "/work/syncproj";
const SID = "aaaa1111-2222-3333-4444-555566667777";

let home: string;
let realHome: string | undefined;
let app: ReturnType<typeof Fastify>;
let ctx: AppContext;
let wsId: string;
let tid: string;

beforeEach(async () => {
  realHome = process.env.HOME;
  home = mkdtempSync(path.join(tmpdir(), "tr-sync-"));
  process.env.HOME = home;
  mkdirSync(claudeProjectDir(PROJECT), { recursive: true }); // setCustomName writes here, doesn't mkdir

  ctx = createContext(":memory:");
  const ws = ctx.store.createWorkspace({ name: "Sync", folder: PROJECT, launchCommand: "claude", color: null });
  wsId = ws.id;
  const term = ctx.store.createTerminal({
    workspaceId: wsId,
    title: "Terminal 1",
    color: null,
    tmuxSession: "tr_sync",
    launchCommandOverride: `claude --model "opus[1m]" --resume ${SID}`,
  });
  tid = term.id;

  app = Fastify();
  await app.register(async (a) => { await terminalRoutes(a, ctx); await claudeRoutes(a, ctx); });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  process.env.HOME = realHome;
  rmSync(home, { recursive: true, force: true });
});

describe("terminal ⇄ session name sync", () => {
  it("terminal rename mirrors onto the running session", async () => {
    const res = await app.inject({ method: "PATCH", url: `/api/terminals/${tid}`, payload: { title: "Auth refactor" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().terminal.title).toBe("Auth refactor");
    expect((await getCustomNames(claudeProjectDir(PROJECT)))[SID]).toBe("Auth refactor");
  });

  it("session rename mirrors onto the terminal running it", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/claude/rename",
      payload: { agent: "claude", sessionId: SID, projectPath: PROJECT, name: "Auth refactor" },
    });
    expect(res.statusCode).toBe(200);
    expect(ctx.store.getTerminal(tid)!.title).toBe("Auth refactor");
  });

  it("session rename keeps the terminal's pin state (auto-title update, not a user lock)", async () => {
    await app.inject({
      method: "POST", url: "/api/claude/rename",
      payload: { agent: "claude", sessionId: SID, projectPath: PROJECT, name: "Renamed" },
    });
    expect(ctx.store.getTerminal(tid)!.titleAuto).toBe(true); // fresh terminal starts unlocked, stays unlocked
  });

  it("an auto-titler update does NOT write back to the session (no loop)", async () => {
    await app.inject({ method: "PATCH", url: `/api/terminals/${tid}`, payload: { title: "auto name", auto: true } });
    expect((await getCustomNames(claudeProjectDir(PROJECT)))[SID]).toBeUndefined();
  });

  it("renaming a terminal with no linked session leaves sessions untouched", async () => {
    const fresh = ctx.store.createTerminal({
      workspaceId: wsId, title: "Terminal 2", color: null, tmuxSession: "tr_fresh", launchCommandOverride: null,
    });
    // No launch link + no tmux session → resolveTerminalSession returns null; rename just stands.
    const res = await app.inject({ method: "PATCH", url: `/api/terminals/${fresh.id}`, payload: { title: "Local shell" } });
    expect(res.statusCode).toBe(200);
    expect(ctx.store.getTerminal(fresh.id)!.title).toBe("Local shell");
  });
});
