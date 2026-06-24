import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createContext, type AppContext } from "../context.js";
import { wallpaperRoutes } from "./wallpapers.js";

let app: ReturnType<typeof Fastify>;
let ctx: AppContext;

beforeEach(async () => {
  ctx = createContext(":memory:");
  app = Fastify();
  await app.register(async (a) => wallpaperRoutes(a, ctx));
  await app.ready();
});
afterEach(async () => { await app.close(); });

const post = (url: string, payload?: unknown) => app.inject({ method: "POST", url, payload });
const get = (url: string) => app.inject({ method: "GET", url });
const del = (url: string) => app.inject({ method: "DELETE", url });

// A 1x1 PNG, base64 (tiny but real image bytes).
const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("wallpapers routes", () => {
  it("starts empty", async () => {
    expect((await get("/api/wallpapers")).json().wallpapers).toEqual([]);
  });

  it("uploads, lists (no bytes), fetches the data URL, and deletes", async () => {
    const created = (await post("/api/wallpapers", { name: "Sunset", mimeType: "image/png", dataBase64: PNG_1x1 })).json().wallpaper;
    expect(created.id).toMatch(/^wp_/);
    expect(created).not.toHaveProperty("dataUrl"); // create returns the light row

    const list = (await get("/api/wallpapers")).json().wallpapers;
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty("dataUrl"); // roster stays light

    const full = (await get(`/api/wallpapers/${created.id}`)).json().wallpaper;
    expect(full.dataUrl).toBe(`data:image/png;base64,${PNG_1x1}`);

    expect((await del(`/api/wallpapers/${created.id}`)).statusCode).toBe(200);
    expect((await get("/api/wallpapers")).json().wallpapers).toEqual([]);
    expect((await get(`/api/wallpapers/${created.id}`)).statusCode).toBe(404);
  });

  it("rejects a non-image mime type and a too-large image", async () => {
    expect((await post("/api/wallpapers", { name: "x", mimeType: "text/plain", dataBase64: PNG_1x1 })).statusCode).toBe(400);
    const huge = "A".repeat(13 * 1024 * 1024 * 4 / 3); // > 12MB decoded
    expect((await post("/api/wallpapers", { name: "big", mimeType: "image/jpeg", dataBase64: huge })).statusCode).toBe(413);
  });

  it("404s an unknown id", async () => {
    expect((await get("/api/wallpapers/wp_nope")).statusCode).toBe(404);
    expect((await del("/api/wallpapers/wp_nope")).statusCode).toBe(404);
  });
});
