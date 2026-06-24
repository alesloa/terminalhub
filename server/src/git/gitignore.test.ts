import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectEcosystems, buildGitignore, writeGitignore, gitignorePreview } from "./gitignore.js";

describe("gitignore", () => {
  let dir: string;
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), "gi-")); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  const touch = (rel: string) => fs.writeFile(path.join(dir, rel), "");
  const mkdir = (rel: string) => fs.mkdir(path.join(dir, rel), { recursive: true });

  it("detects multiple stacks by marker files, extensions, and build dirs", async () => {
    await touch("package.json");   // node by marker
    await touch("Cargo.toml");     // rust by marker
    await touch("main.go");        // go by extension
    await mkdir("__pycache__");    // python by build dir
    const keys = await detectEcosystems(dir);
    expect(keys.sort()).toEqual(["go", "node", "python", "rust"]);
  });

  it("detects nothing in an empty folder", async () => {
    expect(await detectEcosystems(dir)).toEqual([]);
  });

  it("always includes the base section (env/secrets, OS, logs) and per-stack rules", () => {
    const out = buildGitignore(["node"]);
    expect(out).toContain(".env");
    expect(out).toContain("!.env.example"); // example files stay tracked
    expect(out).toContain(".DS_Store");
    expect(out).toContain("*.log");
    expect(out).toContain("node_modules/");
    expect(out).toContain(".next/");
    expect(out).not.toContain("/target/"); // rust section absent when not detected
  });

  it("writes a .gitignore when none exists, then refuses to clobber an existing one", async () => {
    await touch("Cargo.toml");
    const first = await writeGitignore(dir);
    expect(first.wrote).toBe(true);
    expect(first.ecosystems).toEqual(["rust"]);
    expect(await fs.readFile(path.join(dir, ".gitignore"), "utf8")).toContain("/target/");

    await fs.writeFile(path.join(dir, ".gitignore"), "custom\n");
    const second = await writeGitignore(dir);
    expect(second.wrote).toBe(false); // kept as-is
    expect(await fs.readFile(path.join(dir, ".gitignore"), "utf8")).toBe("custom\n");
  });

  it("previews detected stacks with labels and flags an existing .gitignore", async () => {
    await touch("go.mod");
    let p = await gitignorePreview(dir);
    expect(p.exists).toBe(false);
    expect(p.ecosystems).toEqual([{ key: "go", label: "Go" }]);

    await touch(".gitignore");
    p = await gitignorePreview(dir);
    expect(p.exists).toBe(true);
  });
});
