import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import { createContext, type AppContext } from "../context.js";
import { pushoverRoutes } from "./pushover.js";

let app: ReturnType<typeof Fastify>;
let ctx: AppContext;

beforeEach(async () => {
  ctx = createContext(":memory:");
  app = Fastify();
  await app.register(async (a) => pushoverRoutes(a, ctx));
  await app.ready();
});
afterEach(async () => { await app.close(); vi.unstubAllGlobals(); });

const okRes = (body: unknown) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body }) as any;
const post = (url: string) => app.inject({ method: "POST", url });
const get = (url: string) => app.inject({ method: "GET", url });

describe("pushover routes", () => {
  it("test reports not configured when no keys are set", async () => {
    const body = (await post("/api/pushover/test")).json();
    expect(body.ok).toBe(false);
    expect(body.errors.join(" ")).toMatch(/configured/i);
  });

  it("test validates the keys against Pushover when configured", async () => {
    ctx.store.setSettings({ pushoverToken: "tok", pushoverUser: "usr" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okRes({ status: 1, devices: ["iphone"] })));
    const body = (await post("/api/pushover/test")).json();
    expect(body.ok).toBe(true);
  });

  it("quota reports not configured with no keys", async () => {
    const body = (await get("/api/pushover/quota")).json();
    expect(body.configured).toBe(false);
  });

  it("quota returns the monthly usage when configured", async () => {
    ctx.store.setSettings({ pushoverToken: "tok", pushoverUser: "usr" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okRes({ limit: 10000, remaining: 9998, reset: 1780000000 })));
    const body = (await get("/api/pushover/quota")).json();
    expect(body.configured).toBe(true);
    expect(body.quota).toEqual({ limit: 10000, remaining: 9998, reset: 1780000000 });
  });
});
