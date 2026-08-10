import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../app.js";
import { createStore } from "../db/store.js";
import { createTmuxController } from "../tmux/controller.js";
import { createSessionsController } from "../presence/sessions.js";
import { createGuiManager } from "../gui/manager.js";
import type { Config } from "../config.js";

const config: Config = { port: 0, host: "127.0.0.1", token: "secret", dbPath: ":memory:", fsRoots: null, reveal: null, onetimeBase: null, google: null };

function build() {
  const ctx: any = { store: createStore(":memory:"), tmux: createTmuxController(async () => ""), sessions: createSessionsController(), gui: createGuiManager() };
  return buildApp(config, ctx);
}

const EXPOSED = { "x-forwarded-for": "203.0.113.7" };
const CONTENT = "0123456789ABCDEF"; // 16 bytes

let dir: string;
let file: string;
const enc = (p: string) => encodeURIComponent(p);
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "media-test-"));
  file = join(dir, "clip.mp4");
  writeFileSync(file, CONTENT);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("GET /api/media/file", () => {
  it("serves the whole file (200) with the right type + Accept-Ranges on loopback", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: `/api/media/file?path=${enc(file)}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("video/mp4");
    expect(res.headers["accept-ranges"]).toBe("bytes");
    expect(res.headers["content-length"]).toBe(String(CONTENT.length));
    expect(res.body).toBe(CONTENT);
    await app.close();
  });

  it("answers a Range request with 206 + Content-Range and only the requested slice", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: `/api/media/file?path=${enc(file)}`, headers: { range: "bytes=0-3" } });
    expect(res.statusCode).toBe(206);
    expect(res.headers["content-range"]).toBe(`bytes 0-3/${CONTENT.length}`);
    expect(res.headers["content-length"]).toBe("4");
    expect(res.body).toBe("0123");
    await app.close();
  });

  it("answers an unsatisfiable Range with 416", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: `/api/media/file?path=${enc(file)}`, headers: { range: "bytes=100-" } });
    expect(res.statusCode).toBe(416);
    expect(res.headers["content-range"]).toBe(`bytes */${CONTENT.length}`);
    await app.close();
  });

  it("HEAD advertises the size without a body", async () => {
    const app = await build();
    const res = await app.inject({ method: "HEAD", url: `/api/media/file?path=${enc(file)}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-length"]).toBe(String(CONTENT.length));
    expect(res.body).toBe("");
    await app.close();
  });

  it("404s a missing file", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: `/api/media/file?path=${enc(join(dir, "nope.mp4"))}` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("rejects an exposed request with no token (401)", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: `/api/media/file?path=${enc(file)}`, headers: EXPOSED });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("accepts an exposed request carrying the token as ?token=", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: `/api/media/file?path=${enc(file)}&token=secret`, headers: EXPOSED });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(CONTENT);
    await app.close();
  });

  it("accepts an exposed request carrying the preview cookie", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: `/api/media/file?path=${enc(file)}`, headers: { ...EXPOSED, cookie: "tr_preview=secret" } });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
