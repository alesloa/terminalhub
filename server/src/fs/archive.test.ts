import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import { extractZipInto } from "./archive.js";

let root: string;
beforeAll(() => { root = mkdtempSync(join(tmpdir(), "tr-zip-")); });
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("extractZipInto", () => {
  it("unpacks files and nested folders, creating subdirs", async () => {
    const zip = zipSync({
      "a.txt": strToU8("A"),
      "folder/b.txt": strToU8("B"),
      "folder/deep/c.bin": new Uint8Array([0, 1, 2, 255]),
    });
    const res = await extractZipInto(root, zip);
    expect(res.files).toBe(3);
    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("A");
    expect(readFileSync(join(root, "folder", "b.txt"), "utf8")).toBe("B");
    expect(readFileSync(join(root, "folder", "deep", "c.bin"))).toEqual(Buffer.from([0, 1, 2, 255]));
    expect(res.pasted).toEqual(expect.arrayContaining([join(root, "a.txt"), join(root, "folder")]));
  });
  it("skips entries that try to escape the target dir", async () => {
    const zip = zipSync({ "../escape.txt": strToU8("x"), "safe.txt": strToU8("ok") });
    const res = await extractZipInto(root, zip);
    expect(res.files).toBe(1); // only safe.txt written
    expect(existsSync(join(root, "..", "escape.txt"))).toBe(false);
    expect(readFileSync(join(root, "safe.txt"), "utf8")).toBe("ok");
  });
});
