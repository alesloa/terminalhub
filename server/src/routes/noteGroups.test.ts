import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createContext, type AppContext } from "../context.js";
import { notesRoutes } from "./notes.js";
import { noteGroupsRoutes } from "./noteGroups.js";

let app: ReturnType<typeof Fastify>;
let ctx: AppContext;

beforeEach(async () => {
  ctx = createContext(":memory:");
  app = Fastify();
  await app.register(async (a) => notesRoutes(a, ctx));
  await app.register(async (a) => noteGroupsRoutes(a, ctx));
  await app.ready();
});
afterEach(async () => { await app.close(); });

const post = (url: string, payload?: unknown) => app.inject({ method: "POST", url, payload });
const get = (url: string) => app.inject({ method: "GET", url });
const patch = (url: string, payload?: unknown) => app.inject({ method: "PATCH", url, payload });
const del = (url: string) => app.inject({ method: "DELETE", url });

describe("note-groups routes", () => {
  it("GET /api/note-groups is empty initially", async () => {
    const r = await get("/api/note-groups");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ groups: [] });
  });

  it("creates a group and returns it with sort 0", async () => {
    const r = await post("/api/note-groups", { name: "Work" });
    expect(r.statusCode).toBe(200);
    const g = r.json().group;
    expect(g.id).toMatch(/^ng_/);
    expect(g.name).toBe("Work");
    expect(g.color).toBeNull();
    expect(g.sort).toBe(0);
  });

  it("appends groups in creation order via sort", async () => {
    await post("/api/note-groups", { name: "Work" });
    await post("/api/note-groups", { name: "Personal" });
    const groups = (await get("/api/note-groups")).json().groups;
    expect(groups.map((g: { name: string }) => g.name)).toEqual(["Work", "Personal"]);
    expect(groups.map((g: { sort: number }) => g.sort)).toEqual([0, 1]);
  });

  it("renames a group and sets a color", async () => {
    const g = (await post("/api/note-groups", { name: "Work" })).json().group;
    const r = await patch(`/api/note-groups/${g.id}`, { name: "Job", color: "#fbbf24" });
    expect(r.statusCode).toBe(200);
    const updated = r.json().group;
    expect(updated.name).toBe("Job");
    expect(updated.color).toBe("#fbbf24");
  });

  it("PATCH/DELETE a missing group 404s", async () => {
    expect((await patch("/api/note-groups/ng_nope", { name: "x" })).statusCode).toBe(404);
    expect((await del("/api/note-groups/ng_nope")).statusCode).toBe(404);
  });
});

describe("notes ⇄ groups", () => {
  it("creates a note inside a group", async () => {
    const g = (await post("/api/note-groups", { name: "Work" })).json().group;
    const n = (await post("/api/notes", { title: "Plan", content: "x", groupId: g.id })).json().note;
    expect(n.groupId).toBe(g.id);
  });

  it("an ungrouped note has groupId null", async () => {
    const n = (await post("/api/notes", { title: "Loose", content: "y" })).json().note;
    expect(n.groupId).toBeNull();
  });

  it("moves a note into and back out of a group via PATCH", async () => {
    const g = (await post("/api/note-groups", { name: "Work" })).json().group;
    const n = (await post("/api/notes", { title: "Plan", content: "x" })).json().note;
    expect((await patch(`/api/notes/${n.id}`, { groupId: g.id })).json().note.groupId).toBe(g.id);
    expect((await patch(`/api/notes/${n.id}`, { groupId: null })).json().note.groupId).toBeNull();
  });

  it("deleting a group re-homes its notes to ungrouped (notes survive)", async () => {
    const g = (await post("/api/note-groups", { name: "Work" })).json().group;
    const n = (await post("/api/notes", { title: "Plan", content: "x", groupId: g.id })).json().note;
    expect((await del(`/api/note-groups/${g.id}`)).statusCode).toBe(200);
    const notes = (await get("/api/notes")).json().notes;
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe(n.id);
    expect(notes[0].groupId).toBeNull();
  });
});
