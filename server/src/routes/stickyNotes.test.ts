import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createContext, type AppContext } from "../context.js";
import { stickyNotesRoutes } from "./stickyNotes.js";

let app: ReturnType<typeof Fastify>;
let ctx: AppContext;

beforeEach(async () => {
  ctx = createContext(":memory:");
  app = Fastify();
  await app.register(async (a) => stickyNotesRoutes(a, ctx));
  await app.ready();
});
afterEach(async () => { await app.close(); });

const post = (url: string, payload?: unknown) => app.inject({ method: "POST", url, payload });
const get = (url: string) => app.inject({ method: "GET", url });
const patch = (url: string, payload?: unknown) => app.inject({ method: "PATCH", url, payload });
const del = (url: string) => app.inject({ method: "DELETE", url });

const NEW = { x: 40, y: 60, w: 240, h: 200 };

describe("sticky-notes routes", () => {
  it("GET /api/sticky-notes is empty initially", async () => {
    const r = await get("/api/sticky-notes");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ stickyNotes: [] });
  });

  it("creates a note with geometry and returns it", async () => {
    const r = await post("/api/sticky-notes", { ...NEW, spaceId: "sp_x", content: "hi", color: "#aabbcc" });
    expect(r.statusCode).toBe(200);
    const n = r.json().stickyNote;
    expect(n.id).toMatch(/^sn_/);
    expect(n.spaceId).toBe("sp_x");
    expect(n.content).toBe("hi");
    expect(n.color).toBe("#aabbcc");
    expect(n).toMatchObject(NEW);
    expect(n.pinned).toBe(false);
    expect(n.updatedAt).toBe(n.createdAt);
  });

  it("defaults content/color to empty/null and pinned to false", async () => {
    const n = (await post("/api/sticky-notes", { ...NEW, spaceId: "sp_x" })).json().stickyNote;
    expect(n.content).toBe("");
    expect(n.color).toBe(null);
    expect(n.pinned).toBe(false);
  });

  it("rejects a create missing geometry", async () => {
    expect((await post("/api/sticky-notes", { spaceId: "sp_x" })).statusCode).toBe(400);
  });

  it("the list returns full notes including content + geometry", async () => {
    await post("/api/sticky-notes", { ...NEW, content: "alpha" });
    const list = (await get("/api/sticky-notes")).json().stickyNotes;
    expect(list).toHaveLength(1);
    expect(list[0].content).toBe("alpha");
    expect(list[0]).toMatchObject(NEW);
  });

  it("moves a note (x/y) and bumps updatedAt", async () => {
    const created = (await post("/api/sticky-notes", { ...NEW })).json().stickyNote;
    const r = await patch(`/api/sticky-notes/${created.id}`, { x: 500, y: 320 });
    expect(r.statusCode).toBe(200);
    const n = r.json().stickyNote;
    expect(n.x).toBe(500);
    expect(n.y).toBe(320);
    expect(n.updatedAt).toBeGreaterThanOrEqual(n.createdAt);
  });

  it("recolors, resizes, edits, and toggles pinned", async () => {
    const id = (await post("/api/sticky-notes", { ...NEW })).json().stickyNote.id;
    const n = (await patch(`/api/sticky-notes/${id}`,
      { content: "beta", color: "#112233", w: 400, h: 300, pinned: true })).json().stickyNote;
    expect(n.content).toBe("beta");
    expect(n.color).toBe("#112233");
    expect(n.w).toBe(400);
    expect(n.h).toBe(300);
    expect(n.pinned).toBe(true);
  });

  it("moves a note to another space", async () => {
    const id = (await post("/api/sticky-notes", { ...NEW, spaceId: "sp_a" })).json().stickyNote.id;
    const n = (await patch(`/api/sticky-notes/${id}`, { spaceId: "sp_b" })).json().stickyNote;
    expect(n.spaceId).toBe("sp_b");
  });

  it("clears the color back to default with null", async () => {
    const id = (await post("/api/sticky-notes", { ...NEW, color: "#abcabc" })).json().stickyNote.id;
    const n = (await patch(`/api/sticky-notes/${id}`, { color: null })).json().stickyNote;
    expect(n.color).toBe(null);
  });

  it("PATCH a missing note 404s", async () => {
    expect((await patch("/api/sticky-notes/sn_nope", { x: 1 })).statusCode).toBe(404);
  });

  it("deletes a note; second delete 404s", async () => {
    const id = (await post("/api/sticky-notes", { ...NEW })).json().stickyNote.id;
    expect((await del(`/api/sticky-notes/${id}`)).statusCode).toBe(200);
    expect((await get("/api/sticky-notes")).json().stickyNotes).toHaveLength(0);
    expect((await del(`/api/sticky-notes/${id}`)).statusCode).toBe(404);
  });
});
