import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createContext, type AppContext } from "../context.js";
import { boardRoutes } from "./board.js";

let app: ReturnType<typeof Fastify>;
let ctx: AppContext;

beforeEach(async () => {
  ctx = createContext(":memory:");
  app = Fastify();
  await app.register(async (a) => boardRoutes(a, ctx));
  await app.ready();
});
afterEach(async () => { await app.close(); });

const post = (url: string, payload?: unknown) => app.inject({ method: "POST", url, payload });
const get = (url: string) => app.inject({ method: "GET", url });
const patch = (url: string, payload?: unknown) => app.inject({ method: "PATCH", url, payload });
const del = (url: string) => app.inject({ method: "DELETE", url });

const titles = (cards: any[], column: string) =>
  cards.filter((c) => c.column === column).sort((a, b) => a.position - b.position).map((c) => c.title);

describe("board routes", () => {
  it("GET /api/board is empty initially", async () => {
    const r = await get("/api/board");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ cards: [] });
  });

  it("creates a card defaulting to the todo column at position 0", async () => {
    const r = await post("/api/board/cards", { title: "ship it" });
    expect(r.statusCode).toBe(200);
    const c = r.json().card;
    expect(c.id).toMatch(/^bc_/);
    expect(c.column).toBe("todo");
    expect(c.position).toBe(0);
    expect(c.title).toBe("ship it");
    expect(c.body).toBe("");
    expect(c.color).toBeNull();
    expect(c.createdAt).toBeTypeOf("number");
    expect(c.updatedAt).toBe(c.createdAt);
  });

  it("appends new cards within a column with increasing positions", async () => {
    await post("/api/board/cards", { title: "A" });
    await post("/api/board/cards", { title: "B" });
    await post("/api/board/cards", { title: "C" });
    const cards = (await get("/api/board")).json().cards;
    expect(titles(cards, "todo")).toEqual(["A", "B", "C"]);
  });

  it("rejects an unknown column", async () => {
    expect((await post("/api/board/cards", { column: "later" })).statusCode).toBe(400);
  });

  it("edits title, body, and color", async () => {
    const id = (await post("/api/board/cards", { title: "A" })).json().card.id;
    const r = await patch(`/api/board/cards/${id}`, { title: "A2", body: "details", color: "#3b82f6" });
    expect(r.statusCode).toBe(200);
    const c = r.json().card;
    expect(c.title).toBe("A2");
    expect(c.body).toBe("details");
    expect(c.color).toBe("#3b82f6");
    expect(c.updatedAt).toBeGreaterThanOrEqual(c.createdAt);
  });

  it("clears a color when patched with null", async () => {
    const id = (await post("/api/board/cards", { title: "A", color: "#3b82f6" })).json().card.id;
    const c = (await patch(`/api/board/cards/${id}`, { color: null })).json().card;
    expect(c.color).toBeNull();
  });

  it("moves a card to another column and appends it there", async () => {
    const id = (await post("/api/board/cards", { title: "A" })).json().card.id;
    await post("/api/board/cards", { title: "B" });
    const moved = (await patch(`/api/board/cards/${id}`, { column: "doing" })).json().card;
    expect(moved.column).toBe("doing");
    const cards = (await get("/api/board")).json().cards;
    expect(titles(cards, "todo")).toEqual(["B"]);
    expect(titles(cards, "doing")).toEqual(["A"]);
  });

  it("reorders within a column by position (index among the other cards)", async () => {
    await post("/api/board/cards", { title: "A" });
    await post("/api/board/cards", { title: "B" });
    const cId = (await post("/api/board/cards", { title: "C" })).json().card.id;
    await patch(`/api/board/cards/${cId}`, { position: 0 });
    const cards = (await get("/api/board")).json().cards;
    expect(titles(cards, "todo")).toEqual(["C", "A", "B"]);
  });

  it("moves into a column at a specific index", async () => {
    await post("/api/board/cards", { column: "doing", title: "X" });
    await post("/api/board/cards", { column: "doing", title: "Y" });
    const id = (await post("/api/board/cards", { title: "A" })).json().card.id;
    await patch(`/api/board/cards/${id}`, { column: "doing", position: 1 });
    const cards = (await get("/api/board")).json().cards;
    expect(titles(cards, "doing")).toEqual(["X", "A", "Y"]);
    expect(titles(cards, "todo")).toEqual([]);
  });

  it("PATCH a missing card 404s", async () => {
    expect((await patch("/api/board/cards/bc_nope", { title: "x" })).statusCode).toBe(404);
  });

  it("deletes a card and renumbers the column; second delete 404s", async () => {
    await post("/api/board/cards", { title: "A" });
    const bId = (await post("/api/board/cards", { title: "B" })).json().card.id;
    await post("/api/board/cards", { title: "C" });
    expect((await del(`/api/board/cards/${bId}`)).statusCode).toBe(200);
    const cards = (await get("/api/board")).json().cards;
    expect(titles(cards, "todo")).toEqual(["A", "C"]);
    expect(cards.map((c: any) => c.position).sort()).toEqual([0, 1]);
    expect((await del(`/api/board/cards/${bId}`)).statusCode).toBe(404);
  });
});
