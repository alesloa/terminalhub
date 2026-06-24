import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createContext, type AppContext } from "../context.js";
import { voicesRoutes } from "./voices.js";

let app: ReturnType<typeof Fastify>;
let ctx: AppContext;

beforeEach(async () => {
  ctx = createContext(":memory:");
  app = Fastify();
  await app.register(async (a) => voicesRoutes(a, ctx));
  await app.ready();
});
afterEach(async () => { await app.close(); });

describe("voices routes", () => {
  it("GET is empty before any curation", async () => {
    const r = await app.inject({ method: "GET", url: "/api/voices" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ voices: [] });
  });

  it("PUT persists the kept list and GET round-trips it", async () => {
    const voices = [{ name: "Daniel", lang: "en-GB" }, { name: "Samantha", lang: "en-US" }];
    const put = await app.inject({ method: "PUT", url: "/api/voices", payload: { voices } });
    expect(put.statusCode).toBe(200);
    const r = await app.inject({ method: "GET", url: "/api/voices" });
    expect(r.json().voices).toEqual(voices);
  });

  it("PUT replaces (not appends) the previous list", async () => {
    await app.inject({ method: "PUT", url: "/api/voices", payload: { voices: [{ name: "A", lang: "en" }] } });
    await app.inject({ method: "PUT", url: "/api/voices", payload: { voices: [{ name: "B", lang: "fr" }] } });
    const r = await app.inject({ method: "GET", url: "/api/voices" });
    expect(r.json().voices).toEqual([{ name: "B", lang: "fr" }]);
  });

  it("rejects a malformed body", async () => {
    const r = await app.inject({ method: "PUT", url: "/api/voices", payload: { voices: [{ name: "", lang: "en" }] } });
    expect(r.statusCode).toBe(400);
  });
});
