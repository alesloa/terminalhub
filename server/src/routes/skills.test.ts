import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { createContext, type AppContext } from "../context.js";
import { skillsRoutes } from "./skills.js";

const run = promisify(execFile);

let root: string, repo: string, ws: string, realHome: string | undefined;
let app: ReturnType<typeof Fastify>;
let ctx: AppContext;

beforeEach(async () => {
  realHome = process.env.HOME;
  root = mkdtempSync(path.join(tmpdir(), "tr-skills-routes-"));
  process.env.HOME = path.join(root, "home");
  ws = path.join(root, "ws");
  await fs.mkdir(ws, { recursive: true });
  repo = path.join(root, "repo");
  await fs.mkdir(repo, { recursive: true });
  await run("git", ["init", "-q"], { cwd: repo });
  await run("git", ["config", "user.email", "t@t.t"], { cwd: repo });
  await run("git", ["config", "user.name", "t"], { cwd: repo });
  await fs.mkdir(path.join(repo, "skills/foo"), { recursive: true });
  await fs.writeFile(path.join(repo, "skills/foo/SKILL.md"), "---\nname: foo\ndescription: does foo\n---\n");
  await run("git", ["add", "-A"], { cwd: repo });
  await run("git", ["commit", "-qm", "init"], { cwd: repo });

  ctx = createContext(":memory:");
  app = Fastify();
  await app.register(async (a) => skillsRoutes(a, ctx));
  await app.ready();
});
afterEach(async () => {
  await app.close();
  process.env.HOME = realHome;
  rmSync(root, { recursive: true, force: true });
});

const post = (url: string, payload: unknown) => app.inject({ method: "POST", url, payload });
const get = (url: string) => app.inject({ method: "GET", url });

describe("skills routes", () => {
  it("GET /api/skills requires a scope", async () => {
    expect((await get("/api/skills")).statusCode).toBe(400);
  });

  it("scan → install → list → content → disable → remove round trip", async () => {
    const wq = `scope=workspace&workspace=${encodeURIComponent(ws)}`;
    expect((await get(`/api/skills?${wq}`)).json().skills).toEqual([]);

    const scan = (await post("/api/skills/scan", { source: repo })).json();
    expect(scan.candidates.map((c: any) => c.name)).toEqual(["foo"]);

    const installed = (await post("/api/skills/install", {
      tmpId: scan.tmpId, names: ["foo"], scope: "workspace", workspace: ws,
    })).json();
    expect(installed.skills[0]).toMatchObject({ name: "foo", sourceUrl: repo });
    const installPath = installed.skills[0].installPath;

    const list = (await get(`/api/skills?${wq}`)).json().skills;
    expect(list).toHaveLength(1);

    const content = (await get(`/api/skills/content?path=${encodeURIComponent(installPath)}&workspace=${encodeURIComponent(ws)}`)).json();
    expect(content.content).toContain("does foo");

    const disabled = (await post("/api/skills/enabled", { path: installPath, enabled: false, workspace: ws })).json();
    expect(disabled.path).toContain("skills-disabled");
    expect((await get(`/api/skills?${wq}`)).json().skills[0].enabled).toBe(false);

    const removed = await post("/api/skills/remove", { path: disabled.path, workspace: ws });
    expect(removed.json()).toEqual({ ok: true });
    expect((await get(`/api/skills?${wq}`)).json().skills).toEqual([]);
  });

  it("rejects reading a path outside the skills roots", async () => {
    const res = await get(`/api/skills/content?path=${encodeURIComponent("/etc/passwd")}&workspace=${encodeURIComponent(ws)}`);
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("GET /api/skills/search requires a query", async () => {
    expect((await get("/api/skills/search")).statusCode).toBe(400);
  });

  it("catalog: add source → index → list → filter → reindex → remove", async () => {
    expect((await get("/api/skills/catalog")).json()).toEqual({ entries: [], sources: [] });

    const added = await post("/api/skills/catalog/source", { source: repo });
    expect(added.statusCode).toBe(200);
    expect(added.json().sources[0]).toMatchObject({ source: repo, skillCount: 1, error: null });

    const all = (await get("/api/skills/catalog")).json();
    expect(all.entries.map((e: { name: string }) => e.name)).toEqual(["foo"]);

    expect((await get("/api/skills/catalog?filter=foo")).json().entries).toHaveLength(1);
    expect((await get("/api/skills/catalog?filter=zzz")).json().entries).toEqual([]);

    expect((await post("/api/skills/catalog/reindex", {})).json().sources[0].skillCount).toBe(1);

    const removed = await post("/api/skills/catalog/source/remove", { source: repo });
    expect(removed.json()).toEqual({ sources: [] });
    expect((await get("/api/skills/catalog")).json().entries).toEqual([]);
  });

  it("POST /api/skills/catalog/source requires a source", async () => {
    expect((await post("/api/skills/catalog/source", {})).statusCode).toBe(400);
  });

  it("catalog: official flag defaults off for a non-vendor source and toggles its skills' badge", async () => {
    // a local temp repo is not a known vendor org → seeds official=false
    const added = (await post("/api/skills/catalog/source", { source: repo })).json();
    expect(added.sources[0].official).toBe(false);
    expect((await get("/api/skills/catalog")).json().entries[0].official).toBe(false);

    // flip it on → the source and every skill from it become official
    const on = (await post("/api/skills/catalog/source/official", { source: repo, official: true })).json();
    expect(on.sources[0].official).toBe(true);
    expect((await get("/api/skills/catalog")).json().entries[0].official).toBe(true);

    // and back off
    await post("/api/skills/catalog/source/official", { source: repo, official: false });
    expect((await get("/api/skills/catalog")).json().entries[0].official).toBe(false);
  });

  it("catalog: an explicit official=true on add is honored", async () => {
    const added = (await post("/api/skills/catalog/source", { source: repo, official: true })).json();
    expect(added.sources[0].official).toBe(true);
  });
});
