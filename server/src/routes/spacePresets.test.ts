import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createContext, type AppContext } from "../context.js";
import { spacePresetRoutes } from "./spacePresets.js";

let app: ReturnType<typeof Fastify>;
let ctx: AppContext;

beforeEach(async () => {
  ctx = createContext(":memory:");
  app = Fastify();
  await app.register(async (a) => spacePresetRoutes(a, ctx));
  await app.ready();
});
afterEach(async () => { await app.close(); });

const post = (url: string, payload?: unknown) => app.inject({ method: "POST", url, payload });
const get = (url: string) => app.inject({ method: "GET", url });
const patch = (url: string, payload?: unknown) => app.inject({ method: "PATCH", url, payload });
const del = (url: string) => app.inject({ method: "DELETE", url });

const baseConfig = { skills: ["caveman"], commands: [], mcpServers: [], env: "", claudeMd: { mode: "append", content: "X" }, seedTarget: "both", presetId: null, version: 1 };

describe("space-preset routes", () => {
  it("starts empty, creates a preset (normalized), and lists it", async () => {
    expect((await get("/api/space-presets")).json().presets).toEqual([]);
    const p = (await post("/api/space-presets", { name: "React", icon: "react", config: baseConfig })).json().preset;
    expect(p.id).toMatch(/^spt_/);
    expect(p.config.skills).toEqual(["caveman"]);
    expect((await get("/api/space-presets")).json().presets).toHaveLength(1);
  });

  it("updates and deletes a preset, 404ing on a missing id", async () => {
    const p = (await post("/api/space-presets", { name: "React", config: baseConfig })).json().preset;
    const up = (await patch(`/api/space-presets/${p.id}`, { name: "React 18" })).json().preset;
    expect(up.name).toBe("React 18");
    expect((await del(`/api/space-presets/${p.id}`)).statusCode).toBe(200);
    expect((await get("/api/space-presets")).json().presets).toEqual([]);
    expect((await patch(`/api/space-presets/nope`, { name: "x" })).statusCode).toBe(404);
    expect((await del(`/api/space-presets/nope`)).statusCode).toBe(404);
  });

  it("rejects a create missing name or config with 400", async () => {
    expect((await post("/api/space-presets", { name: "x" })).statusCode).toBe(400);
    expect((await post("/api/space-presets", { config: baseConfig })).statusCode).toBe(400);
  });
});
