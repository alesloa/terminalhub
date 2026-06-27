import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createContext, type AppContext } from "../context.js";
import { timeRoutes } from "./time.js";
import { timeCatalogRoutes } from "./timeCatalog.js";

let app: ReturnType<typeof Fastify>;
let ctx: AppContext;

beforeEach(async () => {
  ctx = createContext(":memory:");
  app = Fastify();
  await app.register(async (a) => timeRoutes(a, ctx));
  await app.register(async (a) => timeCatalogRoutes(a, ctx)); // start auto-adds to the catalog — assert via these
  await app.ready();
});
afterEach(async () => { await app.close(); });

const post = (url: string, payload?: unknown) => app.inject({ method: "POST", url, payload });
const get = (url: string) => app.inject({ method: "GET", url });
const patch = (url: string, payload?: unknown) => app.inject({ method: "PATCH", url, payload });
const del = (url: string) => app.inject({ method: "DELETE", url });

const DAY = 86_400_000;

describe("time entry routes", () => {
  it("GET /api/time/entries is empty initially", async () => {
    const r = await get("/api/time/entries");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ entries: [] });
  });

  it("start creates a running entry (stoppedAt null) and returns it", async () => {
    const r = await post("/api/time/start", { client: "Acme", project: "Web", task: "Programming", notes: "hero" });
    expect(r.statusCode).toBe(200);
    const e = r.json().entry;
    expect(e.id).toMatch(/^te_/);
    expect(e.client).toBe("Acme");
    expect(e.project).toBe("Web");
    expect(e.task).toBe("Programming");
    expect(e.notes).toBe("hero");
    expect(e.startedAt).toBeTypeOf("number");
    expect(e.stoppedAt).toBeNull();
  });

  it("start with no client 400s", async () => {
    expect((await post("/api/time/start", {})).statusCode).toBe(400);
  });

  it("start auto-adds unknown client, project (under it), and task to the catalog", async () => {
    await post("/api/time/start", { client: "National Disability Alliance", project: "NDA Brain", task: "Programming" });
    const clients = (await get("/api/time/clients")).json().clients;
    const cl = clients.find((c: any) => c.name === "National Disability Alliance");
    expect(cl).toBeTruthy();
    const projects = (await get(`/api/time/projects?clientId=${cl.id}`)).json().projects;
    expect(projects.map((p: any) => p.name)).toContain("NDA Brain");
    const tasks = (await get("/api/time/tasks")).json().tasks;
    expect(tasks.map((t: any) => t.name)).toContain("Programming");
  });

  it("start does not duplicate a catalog name on repeat (case-insensitive)", async () => {
    await post("/api/time/start", { client: "Acme" });
    await post("/api/time/start", { client: "acme" });
    const clients = (await get("/api/time/clients")).json().clients;
    expect(clients.filter((c: any) => c.name.toLowerCase() === "acme")).toHaveLength(1);
  });

  it("stop by id sets stoppedAt", async () => {
    const e = (await post("/api/time/start", { client: "Acme" })).json().entry;
    const r = await post("/api/time/stop", { id: e.id });
    expect(r.statusCode).toBe(200);
    expect(r.json().entry.stoppedAt).toBeTypeOf("number");
    expect(r.json().entry.id).toBe(e.id);
  });

  it("stop by client stops every running entry for that client", async () => {
    await post("/api/time/start", { client: "Acme" });
    await post("/api/time/start", { client: "Acme" });
    await post("/api/time/start", { client: "Other" });
    const r = await post("/api/time/stop", { client: "Acme" });
    expect(r.json().entries).toHaveLength(2);
    expect(r.json().entries.every((e: any) => e.stoppedAt !== null)).toBe(true);
    // Other is still running
    const running = (await get("/api/time/entries")).json().entries.filter((e: any) => e.stoppedAt === null);
    expect(running.map((e: any) => e.client)).toEqual(["Other"]);
  });

  it("stop with no arg stops the latest running entry", async () => {
    const first = (await post("/api/time/start", { client: "A" })).json().entry;
    const second = (await post("/api/time/start", { client: "B" })).json().entry;
    const r = await post("/api/time/stop", {});
    expect(r.json().entry.id).toBe(second.id);
    expect(r.json().entry.stoppedAt).toBeTypeOf("number");
    // first is still running
    const fresh = (await get("/api/time/entries")).json().entries.find((e: any) => e.id === first.id);
    expect(fresh.stoppedAt).toBeNull();
  });

  it("stop a missing id 404s", async () => {
    expect((await post("/api/time/stop", { id: "te_nope" })).statusCode).toBe(404);
  });

  it("default range is today + any running; explicit range filters by startedAt", async () => {
    const twoDaysAgo = Date.now() - 2 * DAY;
    await post("/api/time/entries", { client: "Past", startedAt: twoDaysAgo, stoppedAt: twoDaysAgo + 3_600_000 });
    await post("/api/time/start", { client: "Now" }); // running, started today

    const today = (await get("/api/time/entries")).json().entries;
    expect(today.find((e: any) => e.client === "Past")).toBeUndefined(); // stopped + old → out of today
    expect(today.find((e: any) => e.client === "Now")).toBeTruthy();     // running → always shown

    const wide = (await get(`/api/time/entries?from=${twoDaysAgo - 1000}&to=${Date.now() + DAY}`)).json().entries;
    expect(wide.find((e: any) => e.client === "Past")).toBeTruthy();
  });

  it("manual add stores the given start/stop", async () => {
    const start = Date.now() - 5_000_000, stop = start + 1_800_000;
    const e = (await post("/api/time/entries", { client: "A", startedAt: start, stoppedAt: stop })).json().entry;
    expect(e.startedAt).toBe(start);
    expect(e.stoppedAt).toBe(stop);
  });

  it("patch edits fields and can re-open a stopped entry", async () => {
    const e = (await post("/api/time/start", { client: "A" })).json().entry;
    await post("/api/time/stop", { id: e.id });
    const edited = (await patch(`/api/time/entries/${e.id}`, { notes: "fixed", client: "B" })).json().entry;
    expect(edited.notes).toBe("fixed");
    expect(edited.client).toBe("B");
    const reopened = (await patch(`/api/time/entries/${e.id}`, { stoppedAt: null })).json().entry;
    expect(reopened.stoppedAt).toBeNull();
  });

  it("patch a missing entry 404s", async () => {
    expect((await patch("/api/time/entries/te_nope", { notes: "x" })).statusCode).toBe(404);
  });

  it("deletes an entry; second delete 404s", async () => {
    const e = (await post("/api/time/start", { client: "A" })).json().entry;
    expect((await del(`/api/time/entries/${e.id}`)).statusCode).toBe(200);
    expect((await del(`/api/time/entries/${e.id}`)).statusCode).toBe(404);
  });
});
