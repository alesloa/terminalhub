import { describe, it, expect, beforeEach } from "vitest";
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
});
