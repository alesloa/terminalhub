import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createContext, type AppContext } from "../context.js";
import { spaceRoutes } from "./spaces.js";

let app: ReturnType<typeof Fastify>;
let ctx: AppContext;

beforeEach(async () => {
  ctx = createContext(":memory:");
  app = Fastify();
  await app.register(async (a) => spaceRoutes(a, ctx));
  await app.ready();
});
afterEach(async () => { await app.close(); });

const post = (url: string, payload?: unknown) => app.inject({ method: "POST", url, payload });
const get = (url: string) => app.inject({ method: "GET", url });
const patch = (url: string, payload?: unknown) => app.inject({ method: "PATCH", url, payload });
const del = (url: string) => app.inject({ method: "DELETE", url });

describe("spaces routes", () => {
  it("GET /api/spaces returns the seeded Home space plus the well-known ids", async () => {
    const r = await get("/api/spaces");
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.spaces).toHaveLength(1);
    expect(body.spaces[0].name).toBe("Home");
    expect(body.homeSpaceId).toBe(body.spaces[0].id);
    expect(body.desktopWorkspaceId).toBeTruthy();
  });

  it("creates, renames, and lists a space", async () => {
    const sp = (await post("/api/spaces", { name: "Work", icon: "briefcase", color: "#123456" })).json().space;
    expect(sp.id).toMatch(/^sp_/);
    expect(sp.icon).toBe("briefcase");
    const renamed = (await patch(`/api/spaces/${sp.id}`, { name: "Job" })).json().space;
    expect(renamed.name).toBe("Job");
    expect((await get("/api/spaces")).json().spaces.map((s: any) => s.name)).toEqual(["Home", "Job"]);
  });

  it("validates bodies with 400 and 404s on a missing space", async () => {
    expect((await post("/api/spaces", {})).statusCode).toBe(400);
    expect((await patch("/api/spaces/nope", { name: "x" })).statusCode).toBe(404);
    expect((await post("/api/spaces/nope/move", { index: 0 })).statusCode).toBe(404);
    expect((await del("/api/spaces/nope")).statusCode).toBe(404);
  });

  it("moves a space to a new index", async () => {
    const a = (await post("/api/spaces", { name: "A" })).json().space;
    const b = (await post("/api/spaces", { name: "B" })).json().space;
    expect((await post(`/api/spaces/${b.id}/move`, { index: 0 })).statusCode).toBe(200);
    expect((await get("/api/spaces")).json().spaces.map((s: any) => s.name)).toEqual(["B", "Home", "A"]);
    expect(a.id).toBeTruthy();
  });

  it("DELETE reassigns workspaces to the adjacent space and refuses home/last", async () => {
    const a = (await post("/api/spaces", { name: "A" })).json().space;
    // a workspace placed in A, via the store directly (workspace routes aren't registered here)
    const w = ctx.store.createWorkspace({ name: "P", folder: "/tmp/p", launchCommand: "", color: null, spaceId: a.id });
    const r = await del(`/api/spaces/${a.id}`);
    expect(r.statusCode).toBe(200);
    expect(ctx.store.getWorkspace(w.id)!.spaceId).toBe(ctx.store.getHomeSpaceId());
    // Home cannot be deleted.
    expect((await del(`/api/spaces/${ctx.store.getHomeSpaceId()}`)).statusCode).toBe(400);
  });

  it("sets, parses back, and clears a per-space background override", async () => {
    const sp = (await post("/api/spaces", { name: "Work" })).json().space;
    expect(sp.background).toBeNull(); // new spaces inherit the global default

    const background = { kind: "wallpaper", color: null, wallpaper: "upload:wp_abc", overlay: false, dim: 60 };
    const patched = (await patch(`/api/spaces/${sp.id}`, { background })).json().space;
    expect(patched.background).toEqual(background); // returned parsed, not a JSON string
    expect((await get("/api/spaces")).json().spaces.find((s: any) => s.id === sp.id).background).toEqual(background);

    const cleared = (await patch(`/api/spaces/${sp.id}`, { background: null })).json().space;
    expect(cleared.background).toBeNull();
  });

  it("rejects a malformed background", async () => {
    const sp = (await post("/api/spaces", { name: "Bad" })).json().space;
    expect((await patch(`/api/spaces/${sp.id}`, { background: { kind: "nope" } })).statusCode).toBe(400);
  });

  it("accepts a wizard config on create, normalizes it, and returns it parsed", async () => {
    const config = {
      skills: ["caveman"], commands: ["deploy"], mcpServers: ["pencil"],
      env: "OPENAI_API_KEY=sk-x", claudeMd: { mode: "pin", content: "Be terse." },
      seedTarget: "both", presetId: null, version: 1,
    };
    const sp = (await post("/api/spaces", { name: "Dev", config })).json().space;
    expect(sp.config.skills).toEqual(["caveman"]);
    expect(sp.config.claudeMd).toEqual({ mode: "pin", content: "Be terse." });
    // round-trips through GET as a parsed object, not a JSON string
    expect((await get("/api/spaces")).json().spaces.find((s: any) => s.id === sp.id).config.commands).toEqual(["deploy"]);
  });

  it("updates a space's config via PATCH and new spaces default to null config", async () => {
    const sp = (await post("/api/spaces", { name: "Dev" })).json().space;
    expect(sp.config).toBeNull();
    const config = { skills: ["a"], commands: [], mcpServers: [], env: "", claudeMd: { mode: "append", content: "" }, seedTarget: "AGENTS.md", presetId: null, version: 1 };
    const patched = (await patch(`/api/spaces/${sp.id}`, { config })).json().space;
    expect(patched.config.skills).toEqual(["a"]);
    expect(patched.config.seedTarget).toBe("AGENTS.md");
  });
});
