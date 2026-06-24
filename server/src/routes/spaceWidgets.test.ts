import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createContext, type AppContext } from "../context.js";
import { spaceWidgetsRoutes } from "./spaceWidgets.js";

let app: ReturnType<typeof Fastify>;
let ctx: AppContext;

beforeEach(async () => {
  ctx = createContext(":memory:");
  app = Fastify();
  await app.register(async (a) => spaceWidgetsRoutes(a, ctx));
  await app.ready();
});
afterEach(async () => { await app.close(); });

const post = (url: string, payload?: unknown) => app.inject({ method: "POST", url, payload });
const get = (url: string) => app.inject({ method: "GET", url });
const patch = (url: string, payload?: unknown) => app.inject({ method: "PATCH", url, payload });
const del = (url: string) => app.inject({ method: "DELETE", url });

// The exact body the picker posts when a tile is clicked.
const NEW = { spaceId: "sp_x", kind: "claude-meter", x: 40, y: 60, w: 250, h: 250 };

describe("space-widgets routes", () => {
  it("GET /api/space-widgets is empty initially", async () => {
    const r = await get("/api/space-widgets");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ spaceWidgets: [] });
  });

  it("creates a widget and returns it (the picker's POST)", async () => {
    const r = await post("/api/space-widgets", NEW);
    expect(r.statusCode).toBe(200);
    const w = r.json().spaceWidget;
    expect(w.id).toMatch(/^sw_/);
    expect(w.kind).toBe("claude-meter");
    expect(w.spaceId).toBe("sp_x");
    expect(w).toMatchObject({ x: 40, y: 60, w: 250, h: 250 });
    expect(w.config).toBe(null);
  });

  it("accepts a click with no spaceId (activeSpaceId falsy → undefined)", async () => {
    const r = await post("/api/space-widgets", { kind: "world-clock", x: 1, y: 2, w: 300, h: 210 });
    expect(r.statusCode).toBe(200);
    expect(r.json().spaceWidget.kind).toBe("world-clock");
  });

  it("rejects an unknown kind", async () => {
    expect((await post("/api/space-widgets", { ...NEW, kind: "bogus" })).statusCode).toBe(400);
  });

  it("the list returns the created widget", async () => {
    await post("/api/space-widgets", NEW);
    const list = (await get("/api/space-widgets")).json().spaceWidgets;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "claude-meter", x: 40, y: 60 });
  });

  it("moves a widget (x/y) on release", async () => {
    const id = (await post("/api/space-widgets", NEW)).json().spaceWidget.id;
    const w = (await patch(`/api/space-widgets/${id}`, { x: 500, y: 320 })).json().spaceWidget;
    expect(w.x).toBe(500);
    expect(w.y).toBe(320);
  });

  it("deletes a widget; second delete 404s", async () => {
    const id = (await post("/api/space-widgets", NEW)).json().spaceWidget.id;
    expect((await del(`/api/space-widgets/${id}`)).statusCode).toBe(200);
    expect((await get("/api/space-widgets")).json().spaceWidgets).toHaveLength(0);
    expect((await del(`/api/space-widgets/${id}`)).statusCode).toBe(404);
  });
});
