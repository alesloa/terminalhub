import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createContext, type AppContext } from "../context.js";
import { blueprintRoutes } from "./blueprints.js";

let app: ReturnType<typeof Fastify>;
let ctx: AppContext;

beforeEach(async () => {
  ctx = createContext(":memory:");
  app = Fastify();
  await app.register(async (a) => blueprintRoutes(a, ctx));
  await app.ready();
});
afterEach(async () => { await app.close(); });

const post = (url: string, payload?: unknown) => app.inject({ method: "POST", url, payload });
const get = (url: string) => app.inject({ method: "GET", url });
const put = (url: string, payload?: unknown) => app.inject({ method: "PUT", url, payload });
const del = (url: string) => app.inject({ method: "DELETE", url });

const graph = { nodes: [{ id: "n1", type: "start", position: { x: 0, y: 0 }, data: { label: "Start" } }], edges: [] };

describe("blueprint routes", () => {
  it("GET /api/blueprints is empty initially", async () => {
    const r = await get("/api/blueprints");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ blueprints: [] });
  });

  it("creates a blueprint and returns it with a parsed graph object", async () => {
    const r = await post("/api/blueprints", { name: "Hello", graph });
    expect(r.statusCode).toBe(200);
    const bp = r.json().blueprint;
    expect(bp.id).toMatch(/^bp_/);
    expect(bp.name).toBe("Hello");
    expect(bp.graph).toEqual(graph); // round-trips as a JSON object, not a string
  });

  it("the list omits the heavy graph (summaries only)", async () => {
    await post("/api/blueprints", { name: "Hello", graph });
    const list = (await get("/api/blueprints")).json().blueprints;
    expect(list).toHaveLength(1);
    expect(list[0].graph).toBeUndefined();
    expect(list[0].name).toBe("Hello");
  });

  it("GET by id returns the full graph; 404 for unknown", async () => {
    const id = (await post("/api/blueprints", { name: "Hello", graph })).json().blueprint.id;
    expect((await get(`/api/blueprints/${id}`)).json().blueprint.graph).toEqual(graph);
    expect((await get("/api/blueprints/bp_nope")).statusCode).toBe(404);
  });

  it("updates name and graph", async () => {
    const id = (await post("/api/blueprints", { name: "Hello", graph })).json().blueprint.id;
    const next = { nodes: [], edges: [] };
    const r = await put(`/api/blueprints/${id}`, { name: "Renamed", graph: next });
    expect(r.statusCode).toBe(200);
    expect(r.json().blueprint.name).toBe("Renamed");
    expect(r.json().blueprint.graph).toEqual(next);
  });

  it("400s on a malformed graph (missing nodes/edges arrays)", async () => {
    expect((await post("/api/blueprints", { name: "Bad", graph: { foo: 1 } })).statusCode).toBe(400);
    expect((await post("/api/blueprints", { name: "Bad" })).statusCode).toBe(400);
  });

  it("saves and round-trips the AI-assistant chat transcript", async () => {
    const chat = [
      { role: "user", content: "build me a CSV importer" },
      { role: "assistant", content: "Sure — what columns does the CSV have?" },
    ];
    const id = (await post("/api/blueprints", { name: "Session", graph, chat })).json().blueprint.id;
    // Full GET returns the saved transcript…
    expect((await get(`/api/blueprints/${id}`)).json().blueprint.chat).toEqual(chat);
    // …the light list omits it.
    expect((await get("/api/blueprints")).json().blueprints[0].chat).toBeUndefined();
    // Updating the chat (e.g. after more turns) persists the new transcript.
    const more = [...chat, { role: "user", content: "id, name, email" }];
    await put(`/api/blueprints/${id}`, { chat: more });
    expect((await get(`/api/blueprints/${id}`)).json().blueprint.chat).toEqual(more);
  });

  it("defaults chat to [] when a blueprint is saved without one", async () => {
    const id = (await post("/api/blueprints", { name: "NoChat", graph })).json().blueprint.id;
    expect((await get(`/api/blueprints/${id}`)).json().blueprint.chat).toEqual([]);
  });

  it("deletes a blueprint", async () => {
    const id = (await post("/api/blueprints", { name: "Hello", graph })).json().blueprint.id;
    expect((await del(`/api/blueprints/${id}`)).statusCode).toBe(200);
    expect((await get(`/api/blueprints/${id}`)).statusCode).toBe(404);
    expect((await del(`/api/blueprints/${id}`)).statusCode).toBe(404);
  });
});
