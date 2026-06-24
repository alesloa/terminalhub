import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoverSkills } from "./discover.js";

let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "skdisc-")); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

async function skill(rel: string, name: string, description = "d") {
  const dir = path.join(root, rel);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n`);
}

describe("skills/discover", () => {
  it("finds a single skill at the repo root (relPath '.')", async () => {
    await skill(".", "root-skill");
    const found = await discoverSkills(root);
    expect(found).toEqual([{ name: "root-skill", description: "d", relPath: "." }]);
  });
  it("finds multiple skills under a skills/ directory", async () => {
    await skill("skills/foo", "foo");
    await skill("skills/bar", "bar");
    const names = (await discoverSkills(root)).map((s) => s.relPath).sort();
    expect(names).toEqual(["skills/bar", "skills/foo"]);
  });
  it("finds a nested skill within the depth limit", async () => {
    await skill("packages/pkg-a/skill", "nested");
    expect((await discoverSkills(root)).map((s) => s.name)).toContain("nested");
  });
  it("skips a folder whose SKILL.md lacks name or description", async () => {
    const dir = path.join(root, "broken");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "SKILL.md"), `---\nname: only-name\n---\n`);
    expect(await discoverSkills(root)).toEqual([]);
  });
  it("ignores node_modules and .git", async () => {
    await skill("node_modules/pkg/skill", "ignored1");
    await skill(".git/skill", "ignored2");
    await skill("real", "kept");
    expect((await discoverSkills(root)).map((s) => s.name)).toEqual(["kept"]);
  });
  it("treats a skill folder as a leaf (does not descend into its subfolders)", async () => {
    await skill("mine", "mine");
    await skill("mine/examples/demo", "should-not-appear");
    expect((await discoverSkills(root)).map((s) => s.name)).toEqual(["mine"]);
  });
});
