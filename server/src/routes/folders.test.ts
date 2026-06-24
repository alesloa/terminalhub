import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createContext, type AppContext } from "../context.js";
import { folderRoutes } from "./folders.js";

let app: ReturnType<typeof Fastify>;
let ctx: AppContext;

beforeEach(async () => {
  ctx = createContext(":memory:");
  app = Fastify();
  await app.register(async (a) => folderRoutes(a, ctx));
  await app.ready();
});
afterEach(async () => { await app.close(); });

const post = (url: string, payload?: unknown) => app.inject({ method: "POST", url, payload });
const get = (url: string) => app.inject({ method: "GET", url });
const patch = (url: string, payload?: unknown) => app.inject({ method: "PATCH", url, payload });
const del = (url: string) => app.inject({ method: "DELETE", url });

// Spin up loose workspace cards through the store (skips the tmux-backed HTTP create) so a folder
// has real members to group.
const newCard = (name: string) =>
  ctx.store.createWorkspace({ name, folder: `/tmp/${name}`, launchCommand: "claude", color: null });

describe("folder routes", () => {
  it("GET /api/folders is empty initially", async () => {
    const r = await get("/api/folders");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ folders: [] });
  });

  it("creates a folder with name + canvas position and returns it", async () => {
    const r = await post("/api/folders", { name: "Old projects", x: 120, y: 80, spaceId: "sp_x" });
    expect(r.statusCode).toBe(200);
    const f = r.json().folder;
    expect(f.id).toMatch(/^fld_/);
    expect(f.name).toBe("Old projects");
    expect(f.x).toBe(120);
    expect(f.y).toBe(80);
    expect(f.spaceId).toBe("sp_x");
    expect(f.updatedAt).toBe(f.createdAt);
  });

  it("defaults the name to empty", async () => {
    const f = (await post("/api/folders", { x: 0, y: 0 })).json().folder;
    expect(f.name).toBe("");
  });

  it("rejects a create missing position", async () => {
    expect((await post("/api/folders", { name: "x" })).statusCode).toBe(400);
  });

  it("seeds member workspaces into the folder on create", async () => {
    const a = newCard("alpha"), b = newCard("beta");
    const f = (await post("/api/folders", { x: 10, y: 10, memberIds: [a.id, b.id] })).json().folder;
    expect(ctx.store.getWorkspace(a.id)?.folderId).toBe(f.id);
    expect(ctx.store.getWorkspace(b.id)?.folderId).toBe(f.id);
  });

  it("the list returns full folders", async () => {
    await post("/api/folders", { name: "A", x: 1, y: 2 });
    await post("/api/folders", { name: "B", x: 3, y: 4 });
    const list = (await get("/api/folders")).json().folders;
    expect(list).toHaveLength(2);
    expect(list.map((f: { name: string }) => f.name).sort()).toEqual(["A", "B"]);
  });

  it("renames and moves a folder, bumping updatedAt", async () => {
    const id = (await post("/api/folders", { name: "old", x: 0, y: 0 })).json().folder.id;
    const f = (await patch(`/api/folders/${id}`, { name: "new", x: 300, y: 220 })).json().folder;
    expect(f.name).toBe("new");
    expect(f.x).toBe(300);
    expect(f.y).toBe(220);
    expect(f.updatedAt).toBeGreaterThanOrEqual(f.createdAt);
  });

  it("PATCH a missing folder 404s", async () => {
    expect((await patch("/api/folders/fld_nope", { name: "x" })).statusCode).toBe(404);
  });

  it("deleting a folder dissolves it: members return to the canvas", async () => {
    const a = newCard("alpha"), b = newCard("beta");
    const f = (await post("/api/folders", { x: 0, y: 0, memberIds: [a.id, b.id] })).json().folder;
    expect((await del(`/api/folders/${f.id}`)).statusCode).toBe(200);
    expect(ctx.store.getWorkspace(a.id)?.folderId).toBe(null);
    expect(ctx.store.getWorkspace(b.id)?.folderId).toBe(null);
    expect((await get("/api/folders")).json().folders).toHaveLength(0);
    expect((await del(`/api/folders/${f.id}`)).statusCode).toBe(404);
  });
});
