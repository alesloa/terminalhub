import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listDir, readFile, writeFile, createFile, createDir, renamePath, copyPath, deletePath, writeUpload, pasteClipboardInto, MAX_EDIT_BYTES } from "./browser.js";

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "tr-fs-"));
  mkdirSync(join(root, "sub"));
  writeFileSync(join(root, "file.txt"), "hi");
  writeFileSync(join(root, ".hidden"), "secret");
  writeFileSync(join(root, "bin.dat"), Buffer.from([0x68, 0x00, 0x69])); // null byte = binary
  writeFileSync(join(root, "big.txt"), Buffer.alloc(MAX_EDIT_BYTES + 1, 0x61)); // > cap
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("listDir", () => {
  it("lists directories and files with types, dirs first", async () => {
    const res = await listDir(root);
    expect(res.path).toBe(root);
    const names = res.entries.map(e => e.name);
    expect(names).toContain("sub");
    expect(names).toContain("file.txt");
    expect(res.entries[0].type).toBe("dir"); // dirs sorted first
    const sub = res.entries.find(e => e.name === "sub")!;
    expect(sub.type).toBe("dir");
    expect(sub.readable).toBe(true);
  });
  it("reports parent of a nested path", async () => {
    const res = await listDir(join(root, "sub"));
    expect(res.parent).toBe(root);
  });
  it("hides dotfiles by default but shows them with includeHidden", async () => {
    const hidden = await listDir(root);
    expect(hidden.entries.map(e => e.name)).not.toContain(".hidden");
    const shown = await listDir(root, { includeHidden: true });
    expect(shown.entries.map(e => e.name)).toContain(".hidden");
  });
});

describe("readFile", () => {
  it("returns utf8 content for a text file", async () => {
    const res = await readFile(join(root, "file.txt"));
    expect(res.content).toBe("hi");
    expect(res.binary).toBe(false);
    expect(res.tooLarge).toBe(false);
  });
  it("flags binary files (null byte) and omits content", async () => {
    const res = await readFile(join(root, "bin.dat"));
    expect(res.binary).toBe(true);
    expect(res.content).toBeUndefined();
  });
  it("flags files past the size cap and omits content", async () => {
    const res = await readFile(join(root, "big.txt"));
    expect(res.tooLarge).toBe(true);
    expect(res.content).toBeUndefined();
  });
});

describe("writeFile", () => {
  it("round-trips content to disk", async () => {
    const p = join(root, "out.txt");
    const res = await writeFile(p, "written\n");
    expect(res.path).toBe(p);
    expect(readFileSync(p, "utf8")).toBe("written\n");
  });
});

describe("writeUpload", () => {
  it("writes binary bytes decoded from base64", async () => {
    const data = Buffer.from([0xff, 0x00, 0x10, 0x68]); // includes a null byte
    const res = await writeUpload(root, "up.bin", data.toString("base64"));
    expect(res.path).toBe(join(root, "up.bin"));
    expect(res.size).toBe(4);
    expect(readFileSync(res.path)).toEqual(data);
  });
  it("writes an empty file from empty base64", async () => {
    const res = await writeUpload(root, "empty.txt", "");
    expect(res.size).toBe(0);
    expect(readFileSync(res.path, "utf8")).toBe("");
  });
  it("creates missing parent dirs for a nested name (dropped folder)", async () => {
    await writeUpload(root, "dropped/assets/logo.txt", Buffer.from("L").toString("base64"));
    expect(readFileSync(join(root, "dropped/assets/logo.txt"), "utf8")).toBe("L");
  });
  it("rejects a name that escapes the target dir (EACCES)", async () => {
    await expect(writeUpload(root, "../escape.txt", Buffer.from("x").toString("base64"))).rejects.toMatchObject({ code: "EACCES" });
    expect(existsSync(join(root, "..", "escape.txt"))).toBe(false);
  });
});

describe("createFile", () => {
  it("creates an empty file", async () => {
    const p = join(root, "new.txt");
    await createFile(p);
    expect(readFileSync(p, "utf8")).toBe("");
  });
  it("refuses to clobber an existing file (EEXIST)", async () => {
    const p = join(root, "file.txt");
    await expect(createFile(p)).rejects.toMatchObject({ code: "EEXIST" });
    expect(readFileSync(p, "utf8")).toBe("hi"); // untouched
  });
});

describe("createDir", () => {
  it("creates a directory", async () => {
    const p = join(root, "newdir");
    await createDir(p);
    expect(existsSync(p)).toBe(true);
  });
  it("refuses an existing path (EEXIST)", async () => {
    await expect(createDir(join(root, "sub"))).rejects.toMatchObject({ code: "EEXIST" });
  });
});

describe("renamePath", () => {
  it("renames a file", async () => {
    const from = join(root, "ren-a.txt"), to = join(root, "ren-b.txt");
    writeFileSync(from, "x");
    await renamePath(from, to);
    expect(existsSync(from)).toBe(false);
    expect(readFileSync(to, "utf8")).toBe("x");
  });
  it("refuses to overwrite an existing destination (EEXIST)", async () => {
    const from = join(root, "ren-c.txt"); writeFileSync(from, "x");
    await expect(renamePath(from, join(root, "file.txt"))).rejects.toMatchObject({ code: "EEXIST" });
    expect(readFileSync(join(root, "file.txt"), "utf8")).toBe("hi"); // untouched
  });
});

describe("copyPath", () => {
  it("copies a directory recursively", async () => {
    const src = join(root, "cp-src"); mkdirSync(src);
    writeFileSync(join(src, "inner.txt"), "deep");
    const dst = join(root, "cp-dst");
    await copyPath(src, dst);
    expect(readFileSync(join(dst, "inner.txt"), "utf8")).toBe("deep");
    expect(existsSync(src)).toBe(true); // original kept
  });
  it("refuses to overwrite an existing destination", async () => {
    await expect(copyPath(join(root, "file.txt"), join(root, "sub"))).rejects.toBeTruthy();
  });
});

describe("pasteClipboardInto", () => {
  it("copies multiple files and a whole folder into the target dir", async () => {
    const dest = mkdtempSync(join(tmpdir(), "tr-paste-"));
    const fa = join(root, "pc-a.txt"); writeFileSync(fa, "A");
    const fb = join(root, "pc-b.txt"); writeFileSync(fb, "B");
    const folder = join(root, "pc-folder"); mkdirSync(folder); mkdirSync(join(folder, "deep"));
    writeFileSync(join(folder, "deep", "inner.txt"), "I");
    const res = await pasteClipboardInto(dest, [fa, fb, folder]);
    expect(res.pasted).toHaveLength(3);
    expect(readFileSync(join(dest, "pc-a.txt"), "utf8")).toBe("A");
    expect(readFileSync(join(dest, "pc-b.txt"), "utf8")).toBe("B");
    expect(readFileSync(join(dest, "pc-folder", "deep", "inner.txt"), "utf8")).toBe("I"); // recursive
    rmSync(dest, { recursive: true, force: true });
  });
  it("dedupes a name that already exists in the target ('name copy.ext')", async () => {
    const dest = mkdtempSync(join(tmpdir(), "tr-paste-"));
    writeFileSync(join(dest, "dup.txt"), "existing"); // collide
    // Copy a source literally named dup.txt so the dedupe has to rename it.
    const srcDir = mkdtempSync(join(tmpdir(), "tr-src-"));
    const dupSrc = join(srcDir, "dup.txt"); writeFileSync(dupSrc, "new");
    const res = await pasteClipboardInto(dest, [dupSrc]);
    expect(res.pasted).toEqual([join(dest, "dup copy.txt")]);
    expect(readFileSync(join(dest, "dup.txt"), "utf8")).toBe("existing"); // original untouched
    expect(readFileSync(join(dest, "dup copy.txt"), "utf8")).toBe("new");
    rmSync(dest, { recursive: true, force: true }); rmSync(srcDir, { recursive: true, force: true });
  });
  it("skips a source that is an ancestor of the target (no self-recursion) and missing sources", async () => {
    const dest = join(root, "sub"); // root/sub exists
    const res = await pasteClipboardInto(dest, [root, join(root, "does-not-exist")]);
    expect(res.pasted).toEqual([]); // root is an ancestor of root/sub → skipped; missing → skipped
  });
});

describe("deletePath", () => {
  it("deletes a directory recursively", async () => {
    const d = join(root, "del-dir"); mkdirSync(d); writeFileSync(join(d, "x.txt"), "x");
    await deletePath(d);
    expect(existsSync(d)).toBe(false);
  });
  it("is a no-op for a missing path", async () => {
    await expect(deletePath(join(root, "nope-nope"))).resolves.toBeTruthy();
  });
});
