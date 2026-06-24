import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { createStore } from "../db/store.js";
import { createTmuxController } from "../tmux/controller.js";
import { createClipController } from "../clip/controller.js";
import { workspaceRoutes } from "./workspaces.js";
import { terminalRoutes } from "./terminals.js";

function build() {
  const calls: string[][] = [];
  const live = new Set<string>();
  const run = vi.fn(async (args: string[]) => {
    calls.push(args);
    if (args[0] === "new-session") live.add(args[args.indexOf("-s") + 1]);
    if (args[0] === "kill-session") live.delete(args[args.indexOf("-t") + 1]);
    if (args[0] === "list-sessions") return [...live].join("\n");
    return "";
  });
  const ctx = { store: createStore(":memory:"), tmux: createTmuxController(run), clip: createClipController() };
  const app = Fastify();
  app.register(async a => workspaceRoutes(a, ctx));
  app.register(async a => terminalRoutes(a, ctx));
  return { app, ctx, calls };
}

describe("workspace routes: spaceId + non-destructive delete", () => {
  let h: ReturnType<typeof build>;
  beforeEach(() => { h = build(); });

  it("POST creates a workspace in the given space", async () => {
    const sp = h.ctx.store.createSpace({ name: "Work" });
    const r = await h.app.inject({ method: "POST", url: "/api/workspaces", payload: { name: "A", folder: "/work", spaceId: sp.id } });
    expect(r.statusCode).toBe(200);
    expect(r.json().workspace.spaceId).toBe(sp.id);
  });

  it("POST without a spaceId defaults to Home", async () => {
    const r = await h.app.inject({ method: "POST", url: "/api/workspaces", payload: { name: "A", folder: "/work" } });
    expect(r.json().workspace.spaceId).toBe(h.ctx.store.getHomeSpaceId());
  });

  it("PATCH sets a workspace's spaceId", async () => {
    const sp = h.ctx.store.createSpace({ name: "Work" });
    const ws = h.ctx.store.createWorkspace({ name: "A", folder: "/work", launchCommand: "", color: null });
    const r = await h.app.inject({ method: "PATCH", url: `/api/workspaces/${ws.id}`, payload: { spaceId: sp.id } });
    expect(r.statusCode).toBe(200);
    expect(r.json().workspace.spaceId).toBe(sp.id);
  });

  it("GET /api/workspaces includes spaceId", async () => {
    const r = await h.app.inject({ method: "GET", url: "/api/workspaces" });
    const desk = r.json().workspaces.find((w: any) => w.id === h.ctx.store.getDesktopWorkspaceId());
    expect(desk.spaceId).toBe(h.ctx.store.getHomeSpaceId());
  });

  it("deleting a workspace rehomes its terminals to Desktop without killing tmux", async () => {
    const ws = h.ctx.store.createWorkspace({ name: "A", folder: "/work", launchCommand: "claude", color: null });
    const term = (await h.app.inject({ method: "POST", url: `/api/workspaces/${ws.id}/terminals`, payload: {} })).json().terminal;
    const deskId = h.ctx.store.getDesktopWorkspaceId()!;

    const r = await h.app.inject({ method: "DELETE", url: `/api/workspaces/${ws.id}` });
    expect(r.statusCode).toBe(200);
    // No tmux session was killed.
    expect(h.calls.find(c => c[0] === "kill-session")).toBeUndefined();
    // The workspace row is gone; the terminal now belongs to Desktop, session name unchanged.
    expect(h.ctx.store.getWorkspace(ws.id)).toBeUndefined();
    const moved = h.ctx.store.getTerminal(term.id)!;
    expect(moved.workspaceId).toBe(deskId);
    expect(moved.tmuxSession).toBe(`tr_${ws.id}_${term.id}`);
  });

  it("refuses to delete the Desktop catch-all workspace", async () => {
    const deskId = h.ctx.store.getDesktopWorkspaceId()!;
    const r = await h.app.inject({ method: "DELETE", url: `/api/workspaces/${deskId}` });
    expect(r.statusCode).toBe(400);
    expect(h.ctx.store.getWorkspace(deskId)).toBeDefined();
  });

  it("ignores a spaceId PATCH on the Desktop workspace (it stays in Home)", async () => {
    const sp = h.ctx.store.createSpace({ name: "Work" });
    const deskId = h.ctx.store.getDesktopWorkspaceId()!;
    const r = await h.app.inject({ method: "PATCH", url: `/api/workspaces/${deskId}`, payload: { spaceId: sp.id } });
    expect(r.statusCode).toBe(200);
    expect(r.json().workspace.spaceId).toBe(h.ctx.store.getHomeSpaceId());
  });
});
