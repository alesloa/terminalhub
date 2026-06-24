import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStore, type Store } from "../db/store.js";
import { createSkillsController, type SkillsController } from "./controller.js";

const run = promisify(execFile);

let root: string, repo: string, ws: string, prevHome: string | undefined;
let store: Store, ctrl: SkillsController;

async function writeSkill(rel: string, name: string, body = "original") {
  const dir = path.join(repo, rel);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: does ${name}\n---\n\n${body}\n`);
}
async function commit(msg: string) {
  await run("git", ["add", "-A"], { cwd: repo });
  await run("git", ["commit", "-qm", msg], { cwd: repo });
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "skctrl-"));
  prevHome = process.env.HOME;
  process.env.HOME = path.join(root, "home");
  ws = path.join(root, "ws");
  await fs.mkdir(ws, { recursive: true });
  repo = path.join(root, "repo");
  await fs.mkdir(repo, { recursive: true });
  await run("git", ["init", "-q"], { cwd: repo });
  await run("git", ["config", "user.email", "t@t.t"], { cwd: repo });
  await run("git", ["config", "user.name", "t"], { cwd: repo });
  await writeSkill("skills/foo", "foo");
  await writeSkill("skills/bar", "bar");
  await commit("init");

  store = createStore(":memory:");
  ctrl = createSkillsController(store);
});
afterEach(async () => {
  process.env.HOME = prevHome;
  await fs.rm(root, { recursive: true, force: true });
});

describe("skills/controller: scan + install", () => {
  it("scan discovers every skill in a repo", async () => {
    const { candidates } = await ctrl.scan(repo);
    expect(candidates.map((c) => c.name).sort()).toEqual(["bar", "foo"]);
  });
  it("installs only the picked skills into the workspace scope", async () => {
    const { tmpId } = await ctrl.scan(repo);
    const installed = await ctrl.install(tmpId, ["foo"], "workspace", ws);
    expect(installed).toHaveLength(1);
    expect(installed[0]).toMatchObject({ name: "foo", scope: "workspace", enabled: true, sourceUrl: repo });
    expect(await fs.readFile(path.join(ws, ".claude/skills/foo/SKILL.md"), "utf8")).toContain("name: foo");
    expect((await fs.readdir(path.join(ws, ".claude/skills"))).sort()).toEqual(["foo"]);
  });
  it("lists installed skills with provenance and description", async () => {
    const { tmpId } = await ctrl.scan(repo);
    await ctrl.install(tmpId, ["foo"], "workspace", ws);
    const list = await ctrl.list("workspace", ws);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "foo", description: "does foo", enabled: true, sourceUrl: repo });
  });
  it("installs to global scope under ~/.claude/skills", async () => {
    const { tmpId } = await ctrl.scan(repo);
    await ctrl.install(tmpId, ["bar"], "global");
    expect(await fs.readFile(path.join(process.env.HOME!, ".claude/skills/bar/SKILL.md"), "utf8")).toContain("name: bar");
    expect((await ctrl.list("global")).map((s) => s.name)).toEqual(["bar"]);
  });
});

describe("skills/controller: read", () => {
  it("returns the raw SKILL.md of an installed skill", async () => {
    const { tmpId } = await ctrl.scan(repo);
    const [foo] = await ctrl.install(tmpId, ["foo"], "workspace", ws);
    expect(await ctrl.read(foo.installPath, ws)).toContain("does foo");
  });
  it("rejects a path outside the skills roots", async () => {
    await expect(ctrl.read("/etc/passwd", ws)).rejects.toThrow();
  });
});

describe("skills/controller: enable/disable", () => {
  it("disabling moves the folder to skills-disabled and back", async () => {
    const { tmpId } = await ctrl.scan(repo);
    const [foo] = await ctrl.install(tmpId, ["foo"], "workspace", ws);

    const { installPath: disabledPath } = await ctrl.setEnabled(foo.installPath, false, ws);
    expect(disabledPath).toBe(path.join(ws, ".claude/skills-disabled/foo"));
    expect(await fs.readdir(path.join(ws, ".claude/skills")).catch(() => [])).toEqual([]);
    const afterDisable = await ctrl.list("workspace", ws);
    expect(afterDisable).toHaveLength(1);
    expect(afterDisable[0]).toMatchObject({ enabled: false, sourceUrl: repo }); // provenance survives the move

    const { installPath: backPath } = await ctrl.setEnabled(disabledPath, true, ws);
    expect(backPath).toBe(path.join(ws, ".claude/skills/foo"));
    expect((await ctrl.list("workspace", ws))[0].enabled).toBe(true);
  });
});

describe("skills/controller: remove", () => {
  it("deletes the folder and its provenance row", async () => {
    const { tmpId } = await ctrl.scan(repo);
    const [foo] = await ctrl.install(tmpId, ["foo"], "workspace", ws);
    await ctrl.remove(foo.installPath, ws);
    expect(await ctrl.list("workspace", ws)).toEqual([]);
    expect(store.getSkillInstall(foo.installPath)).toBeUndefined();
  });
});

describe("skills/controller: updates", () => {
  it("reports no update right after install, then an update after upstream changes", async () => {
    const { tmpId } = await ctrl.scan(repo);
    const [foo] = await ctrl.install(tmpId, ["foo"], "workspace", ws);

    let updates = await ctrl.checkUpdates("workspace", ws);
    expect(updates).toEqual([{ installPath: foo.installPath, updateAvailable: false }]);

    await writeSkill("skills/foo", "foo", "CHANGED");
    await commit("change foo");

    updates = await ctrl.checkUpdates("workspace", ws);
    expect(updates).toEqual([{ installPath: foo.installPath, updateAvailable: true }]);
  });
  it("update pulls the new content and clears the update flag", async () => {
    const { tmpId } = await ctrl.scan(repo);
    const [foo] = await ctrl.install(tmpId, ["foo"], "workspace", ws);
    await writeSkill("skills/foo", "foo", "CHANGED");
    await commit("change foo");

    await ctrl.update(foo.installPath, ws);
    expect(await fs.readFile(path.join(foo.installPath, "SKILL.md"), "utf8")).toContain("CHANGED");
    expect(await ctrl.checkUpdates("workspace", ws)).toEqual([{ installPath: foo.installPath, updateAvailable: false }]);
  });
});

describe("skills/controller: catalog", () => {
  it("adds a source, indexes it immediately, and lists its entries", async () => {
    const sources = await ctrl.addCatalogSource(repo);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ source: repo, skillCount: 2, error: null });
    expect(sources[0].lastIndexedAt).toBeGreaterThan(0);
    expect(ctrl.listCatalog().map((e) => e.name).sort()).toEqual(["bar", "foo"]);
  });

  it("filters catalog entries by query", async () => {
    await ctrl.addCatalogSource(repo);
    expect(ctrl.listCatalog("foo").map((e) => e.name)).toEqual(["foo"]);
  });

  it("reindex picks up new skills and drops removed ones", async () => {
    await ctrl.addCatalogSource(repo);
    await writeSkill("skills/baz", "baz");
    await fs.rm(path.join(repo, "skills/bar"), { recursive: true });
    await commit("add baz, drop bar");
    const sources = await ctrl.reindexCatalog();
    expect(sources[0].skillCount).toBe(2);
    expect(ctrl.listCatalog().map((e) => e.name).sort()).toEqual(["baz", "foo"]);
  });

  it("records an error for a bad source without throwing, leaving others intact", async () => {
    await ctrl.addCatalogSource(repo);
    const sources = await ctrl.addCatalogSource(path.join(root, "does-not-exist"));
    const bad = sources.find((s) => s.source.endsWith("does-not-exist"))!;
    expect(bad.error).toBeTruthy();
    expect(bad.skillCount).toBe(0);
    // the good source's entries survive
    expect(ctrl.listCatalog().map((e) => e.name).sort()).toEqual(["bar", "foo"]);
  });

  it("removing a source drops its catalog entries", async () => {
    await ctrl.addCatalogSource(repo);
    const sources = await ctrl.removeCatalogSource(repo);
    expect(sources).toEqual([]);
    expect(ctrl.listCatalog()).toEqual([]);
  });
});
