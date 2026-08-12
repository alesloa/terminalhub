import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandPresets, packageManagerFor } from "./presets.js";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "tr-presets-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const pkg = (scripts: Record<string, string>) =>
  writeFile(join(dir, "package.json"), JSON.stringify({ name: "x", scripts }));

describe("command presets", () => {
  it("offers every script the folder defines, with its body as the hint", async () => {
    await pkg({ dev: "vite --port 4173", "db:seed": "tsx scripts/seed.ts" });
    const presets = await commandPresets(dir);
    expect(presets).toContainEqual({
      label: "npm run dev", command: "npm run dev", source: "script", detail: "vite --port 4173",
    });
    // A script no generic list would ever contain — the point of reading the folder.
    expect(presets.map(p => p.command)).toContain("npm run db:seed");
  });

  it("adds the usual suspects only when the folder does not define them", async () => {
    await pkg({ dev: "vite" });
    const presets = await commandPresets(dir);
    expect(presets.filter(p => p.command === "npm run dev")).toHaveLength(1); // not offered twice
    expect(presets.find(p => p.command === "npm run dev")?.source).toBe("script");
    expect(presets.find(p => p.command === "npm run build")?.source).toBe("common");
  });

  it("uses the package manager the folder's lockfile names", async () => {
    await pkg({ dev: "vite" });
    await writeFile(join(dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    expect(await packageManagerFor(dir)).toBe("pnpm");
    expect((await commandPresets(dir)).map(p => p.command)).toContain("pnpm run dev");
  });

  it("still offers the common commands in a folder with no package.json", async () => {
    const presets = await commandPresets(dir);
    expect(presets.every(p => p.source === "common")).toBe(true);
    expect(presets.map(p => p.command)).toEqual(["npm run dev", "npm run start", "npm run build", "npm run test"]);
  });

  it("treats an unparseable package.json as having no scripts rather than failing", async () => {
    await writeFile(join(dir, "package.json"), "{ half-written");
    const presets = await commandPresets(dir);
    expect(presets.every(p => p.source === "common")).toBe(true);
  });

  it("ignores non-string script bodies", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { dev: "vite", bad: { nested: true } } }));
    expect((await commandPresets(dir)).map(p => p.command)).not.toContain("npm run bad");
  });
});
