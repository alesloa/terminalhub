import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { createStore } from "../db/store.js";
import { createTmuxController } from "../tmux/controller.js";
import { agentRoutes } from "./agents.js";

function build() {
  const ctx = { store: createStore(":memory:"), tmux: createTmuxController(async () => "") };
  const app = Fastify();
  app.register(async a => agentRoutes(a, ctx));
  return { app, ctx };
}

describe("agent routes", () => {
  let h: ReturnType<typeof build>;
  beforeEach(() => { h = build(); });

  it("GET /api/agents returns the builtin registry with installed flags + empty custom list", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/agents" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.builtin.map((a: any) => a.id)).toEqual(["claude", "codex", "gemini", "opencode", "cursor"]);
    expect(typeof body.builtin[0].installed).toBe("boolean");
    expect(body.builtin[0].bin).toBeUndefined();
    expect(body.custom).toEqual([]);
  });

  it("GET /api/agents/headroom returns install/run status + the wrap launch command", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/agents/headroom" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.installed).toBe("boolean");
    expect(typeof body.running).toBe("boolean");
    expect(body.command).toBe('headroom wrap claude --model "opus[1m]"');
    expect(body.installHint).toContain("headroom-ai");
    // not installed must imply not running
    if (!body.installed) expect(body.running).toBe(false);
  });

  it("POST /api/agents creates a custom agent that GET then returns", async () => {
    const res = await h.app.inject({
      method: "POST", url: "/api/agents",
      payload: { name: "Aider", command: "aider", icon: "data:image/svg+xml,<svg/>" },
    });
    expect(res.statusCode).toBe(200);
    const agent = res.json().agent;
    expect(agent.id).toMatch(/^ag_/);
    expect(agent.icon).toBe("data:image/svg+xml,<svg/>");
    const list = (await h.app.inject({ method: "GET", url: "/api/agents" })).json();
    expect(list.custom.map((a: any) => a.name)).toContain("Aider");
  });

  it("DELETE /api/agents/:id removes a custom agent", async () => {
    const agent = (await h.app.inject({ method: "POST", url: "/api/agents", payload: { name: "X", command: "x" } })).json().agent;
    const del = await h.app.inject({ method: "DELETE", url: `/api/agents/${agent.id}` });
    expect(del.statusCode).toBe(200);
    const list = (await h.app.inject({ method: "GET", url: "/api/agents" })).json();
    expect(list.custom).toEqual([]);
  });

  it("POST /api/agents 400s on empty name", async () => {
    const res = await h.app.inject({ method: "POST", url: "/api/agents", payload: { name: "", command: "x" } });
    expect(res.statusCode).toBe(400);
  });

  it("defaults category to Other and keeps a chosen one", async () => {
    const a = (await h.app.inject({ method: "POST", url: "/api/agents", payload: { name: "A", command: "a" } })).json().agent;
    expect(a.category).toBe("Other");
    const b = (await h.app.inject({ method: "POST", url: "/api/agents", payload: { name: "B", command: "b", category: "Local tools" } })).json().agent;
    expect(b.category).toBe("Local tools");
  });

  it("coerces the reserved 'Detected agents' category to Other", async () => {
    const a = (await h.app.inject({ method: "POST", url: "/api/agents", payload: { name: "C", command: "c", category: "Detected Agents" } })).json().agent;
    expect(a.category).toBe("Other");
  });

  // `npm run dev` means something different in every folder, so a saved command belongs to its
  // project. Shared commands still exist — they are just no longer the only option.
  describe("per-workspace commands", () => {
    const makeWorkspace = (h: ReturnType<typeof build>, name: string, folder: string) =>
      h.ctx.store.createWorkspace({ name, folder, launchCommand: "", color: null });

    it("offers a workspace its own commands plus the shared ones, and nobody else's", async () => {
      const mine = makeWorkspace(h, "mine", "/tmp/mine");
      const theirs = makeWorkspace(h, "theirs", "/tmp/theirs");
      const post = (payload: object) => h.app.inject({ method: "POST", url: "/api/agents", payload });
      await post({ name: "shared", command: "htop" });
      await post({ name: "mine", command: "npm run dev", workspaceId: mine.id });
      await post({ name: "theirs", command: "npm run serve", workspaceId: theirs.id });

      const listed = async (workspaceId?: string) => {
        const url = workspaceId ? `/api/agents?workspaceId=${workspaceId}` : "/api/agents";
        return ((await h.app.inject({ method: "GET", url })).json().custom as { name: string }[]).map(a => a.name);
      };
      expect(await listed(mine.id)).toEqual(["shared", "mine"]);
      expect(await listed(theirs.id)).toEqual(["shared", "theirs"]);
      // No workspace named: only what every workspace shares.
      expect(await listed()).toEqual(["shared"]);
    });

    it("saves a command as shared when no workspace is named", async () => {
      const a = (await h.app.inject({ method: "POST", url: "/api/agents", payload: { name: "A", command: "a" } })).json().agent;
      expect(a.workspaceId).toBeNull();
    });

    it("refuses a command scoped to a workspace that does not exist", async () => {
      const res = await h.app.inject({ method: "POST", url: "/api/agents", payload: { name: "A", command: "a", workspaceId: "ws_nope" } });
      expect(res.statusCode).toBe(404);
    });

    it("deletes a workspace's commands with the workspace", async () => {
      const ws = makeWorkspace(h, "gone", "/tmp/gone");
      await h.app.inject({ method: "POST", url: "/api/agents", payload: { name: "doomed", command: "x", workspaceId: ws.id } });
      h.ctx.store.deleteWorkspace(ws.id);
      expect(h.ctx.store.listCustomAgents(ws.id)).toEqual([]);
    });
  });

  describe("GET /api/agents/presets", () => {
    it("400s without a workspace and 404s for one that does not exist", async () => {
      expect((await h.app.inject({ method: "GET", url: "/api/agents/presets" })).statusCode).toBe(400);
      expect((await h.app.inject({ method: "GET", url: "/api/agents/presets?workspaceId=ws_nope" })).statusCode).toBe(404);
    });

    it("reads the workspace folder's own scripts", async () => {
      const dir = await mkdtemp(join(tmpdir(), "tr-presets-"));
      await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { dev: "vite", ship: "tsc -b" } }));
      const ws = h.ctx.store.createWorkspace({ name: "p", folder: dir, launchCommand: "", color: null });

      const body = (await h.app.inject({ method: "GET", url: `/api/agents/presets?workspaceId=${ws.id}` })).json();
      const commands = (body.presets as { command: string }[]).map(p => p.command);
      expect(commands).toContain("npm run dev");
      expect(commands).toContain("npm run ship"); // a script nothing could have guessed
      expect(commands).toContain("npm run build"); // not defined here, offered as a common one
      await rm(dir, { recursive: true, force: true });
    });
  });
});
