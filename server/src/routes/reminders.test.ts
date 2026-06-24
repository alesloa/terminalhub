import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createContext, type AppContext } from "../context.js";
import { reminderRoutes } from "./reminders.js";

let app: ReturnType<typeof Fastify>;
let ctx: AppContext;

beforeEach(async () => {
  ctx = createContext(":memory:");
  app = Fastify();
  await app.register(async (a) => reminderRoutes(a, ctx));
  await app.ready();
});
afterEach(async () => { await app.close(); });

const post = (url: string, payload?: unknown) => app.inject({ method: "POST", url, payload });
const get = (url: string) => app.inject({ method: "GET", url });
const patch = (url: string, payload?: unknown) => app.inject({ method: "PATCH", url, payload });
const del = (url: string) => app.inject({ method: "DELETE", url });
const FIRE = Date.UTC(2026, 5, 20, 9, 0, 0);

describe("reminder routes — create", () => {
  it("creates a reminder with defaults", async () => {
    const r = await post("/api/reminders", { title: "Standup", fireAt: FIRE });
    expect(r.statusCode).toBe(200);
    const rem = r.json().reminder;
    expect(rem.id).toMatch(/^rem_/);
    expect(rem.title).toBe("Standup");
    expect(rem.fireAt).toBe(FIRE);
    expect(rem.status).toBe("pending");
    expect(rem.channels).toEqual({ inApp: true, pushover: false, speak: true });
  });

  it("rejects a missing title and an out-of-range priority", async () => {
    expect((await post("/api/reminders", { fireAt: FIRE })).statusCode).toBe(400);
    expect((await post("/api/reminders", { title: "x", fireAt: FIRE, priority: 5 })).statusCode).toBe(400);
  });

  it("accepts channels, recurrence, and lead time", async () => {
    const r = await post("/api/reminders", {
      title: "Weekly", fireAt: FIRE, leadMinutes: 15,
      channels: { inApp: true, pushover: true, speak: false },
      recurrence: { freq: "weekly", interval: 1, until: null, count: null },
    });
    const rem = r.json().reminder;
    expect(rem.leadMinutes).toBe(15);
    expect(rem.channels.pushover).toBe(true);
    expect(rem.recurrence.freq).toBe("weekly");
  });
});

describe("reminder routes — agent-friendly fire inputs", () => {
  it("accepts fireInMinutes (relative to now) instead of an epoch-ms fireAt", async () => {
    const before = Date.now();
    const r = await post("/api/reminders", { title: "check deploy", fireInMinutes: 120 });
    expect(r.statusCode).toBe(200);
    const rem = r.json().reminder;
    expect(rem.fireAt).toBeGreaterThanOrEqual(before + 120 * 60_000);
    expect(rem.fireAt).toBeLessThanOrEqual(Date.now() + 120 * 60_000 + 1000);
  });

  it("accepts an absolute fireAtISO string", async () => {
    const iso = "2026-06-20T09:00:00.000Z";
    const rem = (await post("/api/reminders", { title: "Standup", fireAtISO: iso })).json().reminder;
    expect(rem.fireAt).toBe(Date.parse(iso));
  });

  it("400s when no fire instant is provided, and on an unparseable fireAtISO", async () => {
    expect((await post("/api/reminders", { title: "x" })).statusCode).toBe(400);
    expect((await post("/api/reminders", { title: "x", fireAtISO: "not a date" })).statusCode).toBe(400);
  });
});

describe("reminder routes — list + filter", () => {
  it("lists all, and filters by status and range", async () => {
    const a = (await post("/api/reminders", { title: "A", fireAt: FIRE })).json().reminder;
    const b = (await post("/api/reminders", { title: "B", fireAt: FIRE + 86_400_000 })).json().reminder;
    await patch(`/api/reminders/${b.id}`, { status: "cancelled" });
    expect((await get("/api/reminders")).json().reminders).toHaveLength(2);
    expect((await get("/api/reminders?status=pending")).json().reminders.map((x: any) => x.id)).toEqual([a.id]);
    const ranged = (await get(`/api/reminders?from=${FIRE + 1}&to=${FIRE + 2 * 86_400_000}`)).json().reminders;
    expect(ranged.map((x: any) => x.id)).toEqual([b.id]);
  });
});

describe("reminder routes — patch + delete + snooze", () => {
  it("edits content, time, and status", async () => {
    const id = (await post("/api/reminders", { title: "A", fireAt: FIRE })).json().reminder.id;
    const rem = (await patch(`/api/reminders/${id}`, { title: "B", fireAt: FIRE + 5000, status: "cancelled" })).json().reminder;
    expect(rem.title).toBe("B");
    expect(rem.fireAt).toBe(FIRE + 5000);
    expect(rem.status).toBe("cancelled");
  });

  it("404s a missing reminder on patch and delete", async () => {
    expect((await patch("/api/reminders/rem_nope", { title: "x" })).statusCode).toBe(404);
    expect((await del("/api/reminders/rem_nope")).statusCode).toBe(404);
  });

  it("deletes a reminder; second delete 404s", async () => {
    const id = (await post("/api/reminders", { title: "A", fireAt: FIRE })).json().reminder.id;
    expect((await del(`/api/reminders/${id}`)).statusCode).toBe(200);
    expect((await del(`/api/reminders/${id}`)).statusCode).toBe(404);
  });

  it("snoozes by minutes, moving status to snoozed with a future snoozeUntil", async () => {
    const id = (await post("/api/reminders", { title: "A", fireAt: FIRE })).json().reminder.id;
    const before = Date.now();
    const rem = (await post(`/api/reminders/${id}/snooze`, { minutes: 10 })).json().reminder;
    expect(rem.status).toBe("snoozed");
    expect(rem.snoozeUntil).toBeGreaterThanOrEqual(before + 10 * 60_000);
  });
});

describe("reminder routes — image attachment", () => {
  it("stores an image on create, serves the bytes, and clears it on patch", async () => {
    const id = (await post("/api/reminders", { title: "Look", fireAt: FIRE, image: "data:image/png;base64,QUJD" })).json().reminder.id;
    expect((await get("/api/reminders")).json().reminders[0].imagePath).toBe(`/api/reminders/${id}/image`);

    const img = await get(`/api/reminders/${id}/image`);
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toContain("image/png");
    expect(img.body).toBe("ABC"); // base64 QUJD decodes to ABC

    const rem = (await patch(`/api/reminders/${id}`, { image: null })).json().reminder;
    expect(rem.imagePath).toBeNull();
    expect((await get(`/api/reminders/${id}/image`)).statusCode).toBe(404);
  });

  it("rejects a non-image data URL", async () => {
    expect((await post("/api/reminders", { title: "x", fireAt: FIRE, image: "data:text/plain;base64,QUJD" })).statusCode).toBe(400);
  });
});
