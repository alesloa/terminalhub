import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createContext, type AppContext } from "../context.js";
import { notificationRoutes } from "./notifications.js";

let app: ReturnType<typeof Fastify>;
let ctx: AppContext;

beforeEach(async () => {
  ctx = createContext(":memory:");
  app = Fastify();
  await app.register(async (a) => notificationRoutes(a, ctx));
  await app.ready();
});
afterEach(async () => { await app.close(); });

const get = (url: string) => app.inject({ method: "GET", url });
const post = (url: string) => app.inject({ method: "POST", url });
const del = (url: string) => app.inject({ method: "DELETE", url });
const T = Date.UTC(2026, 5, 13, 9, 0, 0);

describe("notification routes", () => {
  it("lists newest-first with an unread count", async () => {
    ctx.store.createNotification({ title: "first", firedAt: T });
    ctx.store.createNotification({ title: "second", firedAt: T + 1000 });
    const body = (await get("/api/notifications")).json();
    expect(body.notifications.map((n: any) => n.title)).toEqual(["second", "first"]);
    expect(body.unread).toBe(2);
  });

  it("marks one read, all read, and reflects the unread count", async () => {
    const a = ctx.store.createNotification({ title: "a", firedAt: T });
    ctx.store.createNotification({ title: "b", firedAt: T + 1 });
    expect((await post(`/api/notifications/${a.id}/read`)).statusCode).toBe(200);
    expect((await get("/api/notifications")).json().unread).toBe(1);
    await post("/api/notifications/read-all");
    expect((await get("/api/notifications")).json().unread).toBe(0);
  });

  it("deletes one and clears all", async () => {
    const a = ctx.store.createNotification({ title: "a", firedAt: T });
    ctx.store.createNotification({ title: "b", firedAt: T + 1 });
    expect((await del(`/api/notifications/${a.id}`)).statusCode).toBe(200);
    expect((await get("/api/notifications")).json().notifications).toHaveLength(1);
    await del("/api/notifications");
    expect((await get("/api/notifications")).json().notifications).toHaveLength(0);
  });

  it("clears every entry for a viewed terminal, leaving others", async () => {
    ctx.store.createNotification({ title: "x1", terminalId: "tm_x", firedAt: T });
    ctx.store.createNotification({ title: "x2", terminalId: "tm_x", firedAt: T + 1 });
    ctx.store.createNotification({ title: "y1", terminalId: "tm_y", firedAt: T + 2 });
    const res = (await del("/api/notifications/terminal/tm_x")).json();
    expect(res.removed).toBe(2);
    const left = (await get("/api/notifications")).json().notifications;
    expect(left.map((n: any) => n.title)).toEqual(["y1"]);
  });
});
