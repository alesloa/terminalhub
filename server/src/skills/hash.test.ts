import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { computeFolderHash } from "./hash.js";

let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "skhash-")); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

async function write(dir: string, rel: string, content: string) {
  const full = path.join(dir, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content);
}

describe("skills/hash: computeFolderHash", () => {
  it("is deterministic for identical trees regardless of write order", async () => {
    const a = path.join(root, "a"), b = path.join(root, "b");
    await write(a, "SKILL.md", "x");
    await write(a, "sub/data.txt", "y");
    // build b in the opposite order
    await write(b, "sub/data.txt", "y");
    await write(b, "SKILL.md", "x");
    expect(await computeFolderHash(a)).toBe(await computeFolderHash(b));
  });
  it("changes when a file's content changes", async () => {
    const a = path.join(root, "a"), b = path.join(root, "b");
    await write(a, "SKILL.md", "one");
    await write(b, "SKILL.md", "two");
    expect(await computeFolderHash(a)).not.toBe(await computeFolderHash(b));
  });
  it("changes when a file is added", async () => {
    const a = path.join(root, "a"), b = path.join(root, "b");
    await write(a, "SKILL.md", "x");
    await write(b, "SKILL.md", "x");
    await write(b, "extra.txt", "z");
    expect(await computeFolderHash(a)).not.toBe(await computeFolderHash(b));
  });
  it("changes when a file is renamed (path is part of the hash)", async () => {
    const a = path.join(root, "a"), b = path.join(root, "b");
    await write(a, "one.txt", "same");
    await write(b, "two.txt", "same");
    expect(await computeFolderHash(a)).not.toBe(await computeFolderHash(b));
  });
  it("returns a 64-char hex sha-256", async () => {
    const a = path.join(root, "a");
    await write(a, "SKILL.md", "x");
    expect(await computeFolderHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("ignores a .git directory so a clone and an installed copy hash equal", async () => {
    const a = path.join(root, "a"), b = path.join(root, "b");
    await write(a, "SKILL.md", "x");
    await write(a, ".git/HEAD", "ref: refs/heads/main");
    await write(b, "SKILL.md", "x"); // no .git
    expect(await computeFolderHash(a)).toBe(await computeFolderHash(b));
  });
});
