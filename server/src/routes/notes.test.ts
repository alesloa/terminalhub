import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createContext, type AppContext } from "../context.js";
import { notesRoutes } from "./notes.js";

let app: ReturnType<typeof Fastify>;
let ctx: AppContext;

beforeEach(async () => {
  ctx = createContext(":memory:");
  app = Fastify();
  await app.register(async (a) => notesRoutes(a, ctx));
  await app.ready();
});
afterEach(async () => { await app.close(); });

const post = (url: string, payload?: unknown) => app.inject({ method: "POST", url, payload });
const get = (url: string) => app.inject({ method: "GET", url });
const patch = (url: string, payload?: unknown) => app.inject({ method: "PATCH", url, payload });
const del = (url: string) => app.inject({ method: "DELETE", url });

describe("notes routes", () => {
  it("GET /api/notes is empty initially", async () => {
    const r = await get("/api/notes");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ notes: [] });
  });

  it("creates a note with title + content and returns it", async () => {
    const r = await post("/api/notes", { title: "Todo", content: "buy milk" });
    expect(r.statusCode).toBe(200);
    const n = r.json().note;
    expect(n.id).toMatch(/^np_/);
    expect(n.title).toBe("Todo");
    expect(n.content).toBe("buy milk");
    expect(n.createdAt).toBeTypeOf("number");
    expect(n.updatedAt).toBe(n.createdAt);
  });

  it("creates a blank untitled note when the body is empty", async () => {
    const r = await post("/api/notes", {});
    expect(r.statusCode).toBe(200);
    const n = r.json().note;
    expect(n.title).toBe("");
    expect(n.content).toBe("");
  });

  it("the list returns full notes including content", async () => {
    await post("/api/notes", { title: "A", content: "alpha" });
    const list = (await get("/api/notes")).json().notes;
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("A");
    expect(list[0].content).toBe("alpha");
  });

  it("updates title and content and bumps updatedAt", async () => {
    const created = (await post("/api/notes", { title: "A", content: "alpha" })).json().note;
    const r = await patch(`/api/notes/${created.id}`, { title: "B", content: "beta" });
    expect(r.statusCode).toBe(200);
    const n = r.json().note;
    expect(n.title).toBe("B");
    expect(n.content).toBe("beta");
    expect(n.updatedAt).toBeGreaterThanOrEqual(n.createdAt);
  });

  it("PATCH a missing note 404s", async () => {
    expect((await patch("/api/notes/np_nope", { title: "x" })).statusCode).toBe(404);
  });

  it("deletes a note; second delete 404s", async () => {
    const id = (await post("/api/notes", { title: "A", content: "alpha" })).json().note.id;
    expect((await del(`/api/notes/${id}`)).statusCode).toBe(200);
    expect((await get("/api/notes")).json().notes).toHaveLength(0);
    expect((await del(`/api/notes/${id}`)).statusCode).toBe(404);
  });
});
