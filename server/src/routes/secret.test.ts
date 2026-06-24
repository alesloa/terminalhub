import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { secretRoutes } from "./secret.js";

describe("secret routes when onetime is not configured", () => {
  it("reports the feature as disabled", async () => {
    const app = Fastify();
    await app.register(async (a) => secretRoutes(a, { onetimeBase: null }));
    const res = await app.inject({ method: "GET", url: "/api/secret/config" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: false });
    await app.close();
  });

  it("refuses to create a secret with 503", async () => {
    const app = Fastify();
    await app.register(async (a) => secretRoutes(a, { onetimeBase: null }));
    const res = await app.inject({
      method: "POST",
      url: "/api/secret",
      payload: { message: "x", key: "k", expiration: 3600, one_time: true, creator_burn_only: false },
    });
    expect(res.statusCode).toBe(503);
    await app.close();
  });
});
