import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { tunnelRoutes } from "./tunnel.js";
import type { TunnelController, TunnelState } from "../tunnel/controller.js";

// A fake controller so the route tests never spawn cloudflared. Records the calls and replays a state.
function fakeTunnel(initial: TunnelState = { status: "idle" }) {
  const calls: { fn: string; arg?: number }[] = [];
  let state = initial;
  const ctrl: TunnelController = {
    status: () => state,
    start(port) { calls.push({ fn: "start", arg: port }); state = { status: "running", port, url: "https://x.trycloudflare.com" }; return state; },
    stop() { calls.push({ fn: "stop" }); state = { status: "idle" }; return state; },
  };
  return { ctrl, calls };
}

function build(kind: "main" | "key" = "main", tunnel = fakeTunnel()) {
  const ctx = { tunnel: tunnel.ctrl } as any;
  const app = Fastify();
  app.addHook("preHandler", async (req) => {
    (req as any).principal = kind === "key" ? { kind: "key", keyId: "ak_guest" } : { kind: "main" };
  });
  app.register(async (a) => tunnelRoutes(a, ctx));
  return { app, tunnel };
}

describe("tunnel routes: owner-only guard", () => {
  it("returns 403 to a key principal", async () => {
    const { app } = build("key");
    expect((await app.inject({ method: "GET", url: "/api/tunnel" })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/tunnel", payload: { port: 5173 } })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: "/api/tunnel" })).statusCode).toBe(403);
  });
});

describe("tunnel routes", () => {
  it("GET returns the current status", async () => {
    const { app } = build("main", fakeTunnel({ status: "running", port: 8189, url: "https://abc.trycloudflare.com" }));
    const res = await app.inject({ method: "GET", url: "/api/tunnel" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "running", port: 8189, url: "https://abc.trycloudflare.com" });
  });

  it("POST starts the tunnel on the given port and returns the new status", async () => {
    const tunnel = fakeTunnel();
    const { app } = build("main", tunnel);
    const res = await app.inject({ method: "POST", url: "/api/tunnel", payload: { port: 5173 } });
    expect(res.statusCode).toBe(200);
    expect(tunnel.calls).toEqual([{ fn: "start", arg: 5173 }]);
    expect(res.json()).toMatchObject({ status: "running", port: 5173 });
  });

  it("POST rejects a missing or out-of-range port", async () => {
    const { app } = build();
    expect((await app.inject({ method: "POST", url: "/api/tunnel", payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/tunnel", payload: { port: 0 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/tunnel", payload: { port: 99999 } })).statusCode).toBe(400);
  });

  it("DELETE stops the tunnel", async () => {
    const tunnel = fakeTunnel({ status: "running", port: 5173, url: "https://x.trycloudflare.com" });
    const { app } = build("main", tunnel);
    const res = await app.inject({ method: "DELETE", url: "/api/tunnel" });
    expect(res.statusCode).toBe(200);
    expect(tunnel.calls).toEqual([{ fn: "stop" }]);
    expect(res.json()).toEqual({ status: "idle" });
  });
});
