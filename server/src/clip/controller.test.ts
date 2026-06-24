import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClipController } from "./controller.js";

describe("clip controller", () => {
  let folder: string;
  beforeEach(() => { folder = mkdtempSync(join(tmpdir(), "tr-clip-")); });
  afterEach(() => { rmSync(folder, { recursive: true, force: true }); });

  it("writes the bytes under .terminalhub/clip/<terminalId> and returns a workspace-relative path", () => {
    const clip = createClipController();
    const bytes = Buffer.from("PNGBYTES");
    const saved = clip.saveImage(folder, "tm_abc", bytes, "png");

    expect(saved.relPath).toBe(`.terminalhub/clip/tm_abc/${saved.name}`);
    expect(saved.name).toMatch(/^img-[a-z0-9]+\.png$/);
    expect(saved.absPath).toBe(join(folder, saved.relPath));
    expect(existsSync(saved.absPath)).toBe(true);
    expect(readFileSync(saved.absPath).equals(bytes)).toBe(true);
  });

  it("drops a self-contained .terminalhub/.gitignore so the clip dir never shows in git", () => {
    const clip = createClipController();
    clip.saveImage(folder, "tm_abc", Buffer.from("x"), "png");
    const gi = join(folder, ".terminalhub", ".gitignore");
    expect(existsSync(gi)).toBe(true);
    expect(readFileSync(gi, "utf8").trim()).toBe("*");
  });

  it("sanitizes the extension and falls back to png", () => {
    const clip = createClipController();
    expect(clip.saveImage(folder, "tm_a", Buffer.from("x"), "JPEG").name).toMatch(/\.jpeg$/);
    expect(clip.saveImage(folder, "tm_a", Buffer.from("x"), "../evil").name).toMatch(/^img-[a-z0-9]+\.evil$/);
    expect(clip.saveImage(folder, "tm_a", Buffer.from("x"), "").name).toMatch(/\.png$/);
  });

  it("clearTerminal removes only that terminal's images", () => {
    const clip = createClipController();
    const a = clip.saveImage(folder, "tm_a", Buffer.from("a"), "png");
    const b = clip.saveImage(folder, "tm_b", Buffer.from("b"), "png");

    clip.clearTerminal(folder, "tm_a");

    expect(existsSync(a.absPath)).toBe(false);
    expect(existsSync(join(folder, ".terminalhub", "clip", "tm_a"))).toBe(false);
    expect(existsSync(b.absPath)).toBe(true);
  });

  it("clearTerminal on a missing dir is a silent no-op", () => {
    const clip = createClipController();
    expect(() => clip.clearTerminal(folder, "tm_nope")).not.toThrow();
  });

  it("clearWorkspace wipes all pasted images but keeps the gitignore", () => {
    const clip = createClipController();
    const a = clip.saveImage(folder, "tm_a", Buffer.from("a"), "png");

    clip.clearWorkspace(folder);

    expect(existsSync(a.absPath)).toBe(false);
    expect(existsSync(join(folder, ".terminalhub", "clip"))).toBe(false);
    expect(existsSync(join(folder, ".terminalhub", ".gitignore"))).toBe(true);
  });
});
