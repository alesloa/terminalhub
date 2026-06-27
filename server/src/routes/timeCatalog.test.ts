import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createContext, type AppContext } from "../context.js";
import { timeCatalogRoutes } from "./timeCatalog.js";

let app: ReturnType<typeof Fastify>;
let ctx: AppContext;

beforeEach(async () => {
  ctx = createContext(":memory:");
  app = Fastify();
  await app.register(async (a) => timeCatalogRoutes(a, ctx));
  await app.ready();
});
afterEach(async () => { await app.close(); });

const post = (url: string, payload?: unknown) => app.inject({ method: "POST", url, payload });
const get = (url: string) => app.inject({ method: "GET", url });
const patch = (url: string, payload?: unknown) => app.inject({ method: "PATCH", url, payload });
const del = (url: string) => app.inject({ method: "DELETE", url });

describe("time catalog routes", () => {
  it("clients: create → list → rename → archive → delete", async () => {
    const c = (await post("/api/time/clients", { name: "Acme" })).json().client;
    expect(c.id).toMatch(/^cl_/);
    expect(c.archived).toBe(false);
    expect((await get("/api/time/clients")).json().clients).toHaveLength(1);

    const renamed = (await patch(`/api/time/clients/${c.id}`, { name: "Acme Inc" })).json().client;
    expect(renamed.name).toBe("Acme Inc");
    const archived = (await patch(`/api/time/clients/${c.id}`, { archived: true })).json().client;
    expect(archived.archived).toBe(true);

    expect((await del(`/api/time/clients/${c.id}`)).statusCode).toBe(200);
    expect((await get("/api/time/clients")).json().clients).toHaveLength(0);
  });

  it("projects are scoped to a client and filter by clientId", async () => {
    const a = (await post("/api/time/clients", { name: "A" })).json().client;
    const b = (await post("/api/time/clients", { name: "B" })).json().client;
    await post("/api/time/projects", { clientId: a.id, name: "A1" });
    await post("/api/time/projects", { clientId: a.id, name: "A2" });
    await post("/api/time/projects", { clientId: b.id, name: "B1" });

    const aProjects = (await get(`/api/time/projects?clientId=${a.id}`)).json().projects;
    expect(aProjects.map((p: any) => p.name).sort()).toEqual(["A1", "A2"]);
    expect((await get("/api/time/projects")).json().projects).toHaveLength(3);
  });

  it("deleting a client removes its projects", async () => {
    const a = (await post("/api/time/clients", { name: "A" })).json().client;
    await post("/api/time/projects", { clientId: a.id, name: "A1" });
    await del(`/api/time/clients/${a.id}`);
    expect((await get(`/api/time/projects?clientId=${a.id}`)).json().projects).toHaveLength(0);
  });

  it("tasks: create → list → delete", async () => {
    const t = (await post("/api/time/tasks", { name: "Programming" })).json().task;
    expect(t.id).toMatch(/^tk_/);
    expect((await get("/api/time/tasks")).json().tasks.map((x: any) => x.name)).toContain("Programming");
    expect((await del(`/api/time/tasks/${t.id}`)).statusCode).toBe(200);
    expect((await get("/api/time/tasks")).json().tasks).toHaveLength(0);
  });

  it("patching a missing client 404s", async () => {
    expect((await patch("/api/time/clients/cl_nope", { name: "x" })).statusCode).toBe(404);
  });

  it("creating a client/task with no name 400s", async () => {
    expect((await post("/api/time/clients", {})).statusCode).toBe(400);
    expect((await post("/api/time/tasks", {})).statusCode).toBe(400);
  });
});
