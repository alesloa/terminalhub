import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createContext, type AppContext } from "../context.js";
import { favoritesRoutes } from "./favorites.js";

let app: ReturnType<typeof Fastify>;
let ctx: AppContext;

beforeEach(async () => {
  ctx = createContext(":memory:");
  app = Fastify();
  await app.register(async (a) => favoritesRoutes(a, ctx));
  await app.ready();
});
afterEach(async () => { await app.close(); });

const post = (url: string, payload?: unknown) => app.inject({ method: "POST", url, payload });
const get = (url: string) => app.inject({ method: "GET", url });
const patch = (url: string, payload?: unknown) => app.inject({ method: "PATCH", url, payload });
const del = (url: string) => app.inject({ method: "DELETE", url });

describe("favorites routes", () => {
  it("GET /api/favorites returns empty groups+favorites initially", async () => {
    const r = await get("/api/favorites");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ groups: [], favorites: [] });
  });

  it("creates a group, a favorite in it, and lists them", async () => {
    const g = (await post("/api/favorites/groups", { name: "Work" })).json().group;
    expect(g.id).toMatch(/^fg_/);
    const f = (await post("/api/favorites", { folder: "/tmp/proj", groupId: g.id })).json().favorite;
    expect(f.id).toMatch(/^fv_/);
    expect(f.groupId).toBe(g.id);
    const body = (await get("/api/favorites")).json();
    expect(body.groups).toHaveLength(1);
    expect(body.favorites).toHaveLength(1);
  });

  it("POST /api/favorites is idempotent per bucket (returns the existing favorite)", async () => {
    const first = (await post("/api/favorites", { folder: "/tmp/x" })).json().favorite;
    const again = await post("/api/favorites", { folder: "/tmp/x" });
    expect(again.statusCode).toBe(200);
    expect(again.json().favorite.id).toBe(first.id);
    expect((await get("/api/favorites")).json().favorites).toHaveLength(1);
  });

  it("validates bodies with 400", async () => {
    expect((await post("/api/favorites/groups", {})).statusCode).toBe(400);
    expect((await post("/api/favorites", {})).statusCode).toBe(400);
  });

  it("renames a group and a favorite", async () => {
    const g = (await post("/api/favorites/groups", { name: "Work" })).json().group;
    const f = (await post("/api/favorites", { folder: "/p", groupId: g.id })).json().favorite;
    expect((await patch(`/api/favorites/groups/${g.id}`, { name: "Job" })).json().group.name).toBe("Job");
    expect((await patch(`/api/favorites/${f.id}`, { label: "My P" })).json().favorite.label).toBe("My P");
  });

  it("404s on a missing group/favorite", async () => {
    expect((await patch("/api/favorites/groups/nope", { name: "x" })).statusCode).toBe(404);
    expect((await del("/api/favorites/groups/nope")).statusCode).toBe(404);
    expect((await patch("/api/favorites/nope", { label: "x" })).statusCode).toBe(404);
    expect((await del("/api/favorites/nope")).statusCode).toBe(404);
  });

  it("moves a favorite into a group via /move", async () => {
    const g = (await post("/api/favorites/groups", { name: "G" })).json().group;
    const f = (await post("/api/favorites", { folder: "/a" })).json().favorite;
    const r = await post("/api/favorites/move", { kind: "favorite", id: f.id, targetParentId: g.id, index: 0 });
    expect(r.statusCode).toBe(200);
    const body = (await get("/api/favorites")).json();
    expect(body.favorites.find((x: any) => x.id === f.id).groupId).toBe(g.id);
  });

  it("rejects a cyclic group move with 400", async () => {
    const a = (await post("/api/favorites/groups", { name: "A" })).json().group;
    const child = (await post("/api/favorites/groups", { name: "Child", parentId: a.id })).json().group;
    const r = await post("/api/favorites/move", { kind: "group", id: a.id, targetParentId: child.id, index: 0 });
    expect(r.statusCode).toBe(400);
  });

  it("deletes a group with reassignTo=root, moving its favorites to root", async () => {
    const g = (await post("/api/favorites/groups", { name: "G" })).json().group;
    const f = (await post("/api/favorites", { folder: "/a", groupId: g.id })).json().favorite;
    const r = await del(`/api/favorites/groups/${g.id}?reassignTo=root`);
    expect(r.statusCode).toBe(200);
    const body = (await get("/api/favorites")).json();
    expect(body.groups).toHaveLength(0);
    expect(body.favorites.find((x: any) => x.id === f.id).groupId).toBeNull();
  });
});
