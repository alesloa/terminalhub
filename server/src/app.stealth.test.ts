import { describe, it, expect } from "vitest";
import { buildApp } from "./app.js";
import { createStore } from "./db/store.js";
import { createTmuxController } from "./tmux/controller.js";
import { createSessionsController } from "./presence/sessions.js";
import type { Config } from "./config.js";

function build(reveal: string | null) {
  const config: Config = { port: 0, host: "127.0.0.1", token: "secret", dbPath: ":memory:", fsRoots: null, reveal, onetimeBase: null, google: null };
  const ctx = { store: createStore(":memory:"), tmux: createTmuxController(async () => ""), sessions: createSessionsController() } as any;
  return buildApp(config, ctx);
}

// A "blank" curtain response is the only one with an empty body — every real path (SPA index or
// the 404 fallback) returns a non-empty body, so emptiness is the environment-independent signal.
const EXPOSED = { "x-forwarded-for": "203.0.113.7" };

describe("stealth curtain wiring", () => {
  it("serves a blank page to an exposed navigation without the flag", async () => {
    const app = await build("sonos=1169");
    const res = await app.inject({ method: "GET", url: "/", headers: EXPOSED });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("");
  });

  it("lifts the curtain when the exposed request carries the flag", async () => {
    const app = await build("sonos=1169");
    const res = await app.inject({ method: "GET", url: "/?sonos=1169", headers: EXPOSED });
    expect(res.body).not.toBe("");
  });

  it("never curtains a loopback navigation", async () => {
    const app = await build("sonos=1169");
    const res = await app.inject({ method: "GET", url: "/" }); // inject defaults to 127.0.0.1, no proxy header
    expect(res.body).not.toBe("");
  });

  it("leaves /api token-gated, not curtained, so it still 401s (no silent blank)", async () => {
    const app = await build("sonos=1169");
    const res = await app.inject({ method: "GET", url: "/api/workspaces", headers: EXPOSED });
    expect(res.statusCode).toBe(401);
  });

  it("is a no-op when TERMINALHUB_REVEAL is unset", async () => {
    const app = await build(null);
    const res = await app.inject({ method: "GET", url: "/", headers: EXPOSED });
    expect(res.body).not.toBe("");
  });
});
