import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchFiles, replaceInFiles, buildRegex, scanLines } from "./search.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "tr-search-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(rel: string, content: string) {
  const abs = join(root, rel);
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, content);
  return abs;
}

describe("searchFiles", () => {
  it("finds a literal across files and reports line/col", async () => {
    await write("a.ts", "const foo = 1;\nconst bar = foo + 2;\n");
    await write("b.ts", "no match here\n");
    const r = await searchFiles(root, "foo", {});
    expect(r.total).toBe(2);
    expect(r.fileCount).toBe(1);
    const m = r.results[0].matches;
    expect(m[0]).toMatchObject({ line: 1, col: 6, length: 3 });
    expect(m[1]).toMatchObject({ line: 2, col: 12, length: 3 });
    expect(m[0].text).toBe("const foo = 1;");
  });

  it("is case-insensitive by default and case-sensitive on demand", async () => {
    await write("a.ts", "Foo foo FOO\n");
    expect((await searchFiles(root, "foo", {})).total).toBe(3);
    expect((await searchFiles(root, "foo", { caseSensitive: true })).total).toBe(1);
  });

  it("matches whole words only when asked", async () => {
    await write("a.ts", "foo foobar food\n");
    expect((await searchFiles(root, "foo", {})).total).toBe(3);
    expect((await searchFiles(root, "foo", { wholeWord: true })).total).toBe(1);
  });

  it("supports regex and reports an invalid pattern", async () => {
    await write("a.ts", "x1 x2 y3\n");
    expect((await searchFiles(root, "x\\d", { regexp: true })).total).toBe(2);
    const bad = await searchFiles(root, "x(", { regexp: true });
    expect(bad.error).toMatch(/invalid/i);
    expect(bad.total).toBe(0);
  });

  it("escapes regex metachars when not in regex mode", async () => {
    await write("a.ts", "a.b axb a.b\n");
    expect((await searchFiles(root, "a.b", {})).total).toBe(2); // literal "a.b", not "a<any>b"
  });

  it("honors include and exclude globs", async () => {
    await write("src/a.ts", "needle\n");
    await write("src/a.test.ts", "needle\n");
    await write("docs/b.md", "needle\n");
    expect((await searchFiles(root, "needle", { include: "*.ts" })).total).toBe(2);
    expect((await searchFiles(root, "needle", { include: "src/**" })).total).toBe(2);
    expect((await searchFiles(root, "needle", { include: "*.ts", exclude: "*.test.ts" })).total).toBe(1);
    expect((await searchFiles(root, "needle", { include: "*.md" })).results[0].name).toBe("b.md");
  });

  it("skips node_modules and .git", async () => {
    await write("node_modules/dep/index.js", "needle\n");
    await write(".git/config", "needle\n");
    await write("app.js", "needle\n");
    const r = await searchFiles(root, "needle", {});
    expect(r.fileCount).toBe(1);
    expect(r.results[0].name).toBe("app.js");
  });

  it("prunes a whole excluded directory subtree (not just exact path)", async () => {
    // The bug: `.next` in the exclude box left deep files like .next/dev/static/x.css visible
    // because exclusion was tested per-file against the full rel path, never to prune the dir.
    await write(".next/dev/static/chunks/x.css", "needle\n");
    await write("src/app.css", "needle\n");
    const r = await searchFiles(root, "needle", { exclude: ".next" });
    expect(r.fileCount).toBe(1);
    expect(r.results[0].name).toBe("app.css");
  });

  it("excludes build & dependency folders by default (.next, dist, node_modules)", async () => {
    await write(".next/static/x.js", "needle\n");
    await write("dist/bundle.js", "needle\n");
    await write("node_modules/dep/i.js", "needle\n");
    await write("src/app.ts", "needle\n");
    const r = await searchFiles(root, "needle", {});
    expect(r.fileCount).toBe(1);
    expect(r.results[0].name).toBe("app.ts");
  });

  it("searches build folders when excludeBuild is turned off", async () => {
    await write(".next/static/x.js", "needle\n");
    await write("dist/bundle.js", "needle\n");
    await write("src/app.ts", "needle\n");
    const r = await searchFiles(root, "needle", { excludeBuild: false });
    expect(r.fileCount).toBe(3);
  });

  it("excludes system folders by default but searches them when excludeSystem is off", async () => {
    await write(".git/config", "needle\n");
    await write(".vscode/settings.json", "needle\n");
    await write("app.ts", "needle\n");
    expect((await searchFiles(root, "needle", {})).fileCount).toBe(1);
    expect((await searchFiles(root, "needle", { excludeSystem: false })).fileCount).toBe(3);
  });

  it("lets an explicit include override the default folder exclusion", async () => {
    await write("node_modules/dep/i.js", "needle\n");
    await write("src/app.ts", "needle\n");
    // Including node_modules/** opts back into that folder even though it's excluded by default.
    const r = await searchFiles(root, "needle", { include: "node_modules/**" });
    expect(r.fileCount).toBe(1);
    expect(r.results[0].path).toContain("node_modules");
  });

  it("skips binary files", async () => {
    await writeFile(join(root, "bin"), Buffer.from([0x66, 0x6f, 0x6f, 0x00, 0x66, 0x6f, 0x6f])); // foo\0foo
    await write("text.txt", "foo\n");
    const r = await searchFiles(root, "foo", {});
    expect(r.fileCount).toBe(1);
    expect(r.results[0].name).toBe("text.txt");
  });
});

describe("scanLines", () => {
  it("does not loop forever on a zero-width regex", () => {
    const re = buildRegex("x*", { regexp: true })!;
    const out = scanLines("axbxc", re);
    expect(out.every((m) => m.length > 0)).toBe(true);
  });
});

describe("replaceInFiles", () => {
  it("replaces all matches in a file and preserves CRLF line endings", async () => {
    const p = await write("a.ts", "foo\r\nbar foo\r\n");
    const res = await replaceInFiles("foo", "baz", {}, [{ path: p }]);
    expect(res).toEqual({ replaced: 2, files: 1 });
    expect(await readFile(p, "utf8")).toBe("baz\r\nbar baz\r\n");
  });

  it("replaces only the targeted match when positions are given", async () => {
    const p = await write("a.ts", "foo foo\nfoo\n");
    // Only the second match on line 1 (col 4).
    const res = await replaceInFiles("foo", "X", {}, [{ path: p, matches: [{ line: 1, col: 4 }] }]);
    expect(res.replaced).toBe(1);
    expect(await readFile(p, "utf8")).toBe("foo X\nfoo\n");
  });

  it("inserts the replacement verbatim in literal mode ($ not interpreted)", async () => {
    const p = await write("a.ts", "cost = price;\n");
    const res = await replaceInFiles("price", "$amount", {}, [{ path: p }]);
    expect(res.replaced).toBe(1);
    expect(await readFile(p, "utf8")).toBe("cost = $amount;\n");
  });

  it("supports regex capture references in the replacement", async () => {
    const p = await write("a.ts", "name=alice\nname=bob\n");
    const res = await replaceInFiles("name=(\\w+)", "user:$1", { regexp: true }, [{ path: p }]);
    expect(res.replaced).toBe(2);
    expect(await readFile(p, "utf8")).toBe("user:alice\nuser:bob\n");
  });
});
