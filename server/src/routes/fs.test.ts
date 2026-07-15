import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import { fsRoutes } from "./fs.js";

// The host-clipboard read is environment-dependent, so stub it — the route's job is to copy
// whatever paths it returns into the target dir (and to refuse exposed requests). vi.hoisted keeps
// the mock fn available to the (hoisted) vi.mock factory.
const { clipboardSources, clipboardWrite } = vi.hoisted(() => ({
  clipboardSources: vi.fn(async (): Promise<string[]> => []),
  clipboardWrite: vi.fn(async (_paths: string[]): Promise<boolean> => true),
}));
vi.mock("../fs/clipboard.js", () => ({ readClipboardFiles: clipboardSources, writeClipboardFiles: clipboardWrite }));

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "tr-fsroute-"));
  writeFileSync(join(root, "hello.txt"), "hi there");
  writeFileSync(join(root, ".hidden"), "x");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

function build() {
  const app = Fastify();
  app.register(fsRoutes);
  return app;
}

describe("fs file routes", () => {
  let app: ReturnType<typeof build>;
  beforeEach(() => { app = build(); });

  it("GET /api/fs/files indexes files recursively and 400s without a root", async () => {
    const ok = await app.inject({ method: "GET", url: `/api/fs/files?root=${encodeURIComponent(root)}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().files).toContain(join(root, "hello.txt"));
    const bad = await app.inject({ method: "GET", url: `/api/fs/files` });
    expect(bad.statusCode).toBe(400);
  });

  it("GET /api/fs/list hides dotfiles, ?all=true shows them", async () => {
    const hidden = (await app.inject({ method: "GET", url: `/api/fs/list?path=${encodeURIComponent(root)}` })).json();
    expect(hidden.entries.map((e: any) => e.name)).not.toContain(".hidden");
    const all = (await app.inject({ method: "GET", url: `/api/fs/list?path=${encodeURIComponent(root)}&all=true` })).json();
    expect(all.entries.map((e: any) => e.name)).toContain(".hidden");
  });

  it("GET /api/fs/file returns text content", async () => {
    const res = await app.inject({ method: "GET", url: `/api/fs/file?path=${encodeURIComponent(join(root, "hello.txt"))}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().content).toBe("hi there");
  });

  it("PUT /api/fs/file writes content to disk", async () => {
    const p = join(root, "written.txt");
    const res = await app.inject({ method: "PUT", url: "/api/fs/file", payload: { path: p, content: "from put" } });
    expect(res.statusCode).toBe(200);
    expect(readFileSync(p, "utf8")).toBe("from put");
  });

  it("GET /api/fs/file 400s on missing path arg", async () => {
    const res = await app.inject({ method: "GET", url: "/api/fs/file" });
    expect(res.statusCode).toBe(400);
  });
});

// The rich (binary) editors — docx, etc. — can't ride the utf8 text routes, so they read/write
// raw bytes as base64 through these. They handle files the text routes refuse as `binary`.
describe("fs binary file routes", () => {
  let app: ReturnType<typeof build>;
  beforeEach(() => { app = build(); });

  it("GET /api/fs/file-bytes returns base64 content of a binary file", async () => {
    const data = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x10]); // zip magic + a null + a high byte
    const p = join(root, "doc.docx");
    writeFileSync(p, data);
    const res = await app.inject({ method: "GET", url: `/api/fs/file-bytes?path=${encodeURIComponent(p)}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tooLarge).toBe(false);
    expect(body.size).toBe(data.length);
    expect(Buffer.from(body.dataBase64, "base64")).toEqual(data);
  });

  it("PUT /api/fs/file-bytes writes base64 bytes to disk", async () => {
    const data = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]);
    const p = join(root, "written.docx");
    const res = await app.inject({ method: "PUT", url: "/api/fs/file-bytes", payload: { path: p, dataBase64: data.toString("base64") } });
    expect(res.statusCode).toBe(200);
    expect(res.json().size).toBe(data.length);
    expect(readFileSync(p)).toEqual(data);
  });

  it("GET /api/fs/file-bytes 400s on missing path arg", async () => {
    const res = await app.inject({ method: "GET", url: "/api/fs/file-bytes" });
    expect(res.statusCode).toBe(400);
  });

  it("PUT /api/fs/file-bytes 400s when dataBase64 is missing", async () => {
    const res = await app.inject({ method: "PUT", url: "/api/fs/file-bytes", payload: { path: join(root, "x.docx") } });
    expect(res.statusCode).toBe(400);
  });
});

describe("fs docx-from-html route", () => {
  let app: ReturnType<typeof build>;
  beforeEach(() => { app = build(); });

  it("POST /api/fs/docx generates a valid .docx from HTML on disk", async () => {
    const p = join(root, "generated.docx");
    const html = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body><h1>Title</h1><p><b>Bold</b> text.</p></body></html>";
    const res = await app.inject({ method: "POST", url: "/api/fs/docx", payload: { path: p, html } });
    expect(res.statusCode).toBe(200);
    expect(res.json().size).toBeGreaterThan(0);
    const bytes = readFileSync(p);
    // .docx is a zip — verify the PK local-file-header magic so we know it's a real document.
    expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });

  it("POST /api/fs/docx 400s when html is missing", async () => {
    const res = await app.inject({ method: "POST", url: "/api/fs/docx", payload: { path: join(root, "x.docx") } });
    expect(res.statusCode).toBe(400);
  });
});

describe("fs mutation routes", () => {
  let app: ReturnType<typeof build>;
  beforeEach(() => { app = build(); });

  it("POST /api/fs/create makes an empty file, 400s if it exists", async () => {
    const p = join(root, "created.txt");
    expect((await app.inject({ method: "POST", url: "/api/fs/create", payload: { path: p } })).statusCode).toBe(200);
    expect(readFileSync(p, "utf8")).toBe("");
    const dup = await app.inject({ method: "POST", url: "/api/fs/create", payload: { path: p } });
    expect(dup.statusCode).toBe(400);
    expect(dup.json().code).toBe("EEXIST");
  });

  it("POST /api/fs/mkdir makes a directory", async () => {
    const p = join(root, "mkdir-d");
    expect((await app.inject({ method: "POST", url: "/api/fs/mkdir", payload: { path: p } })).statusCode).toBe(200);
    expect(existsSync(p)).toBe(true);
  });

  it("POST /api/fs/rename moves a file, 400s on collision", async () => {
    const from = join(root, "r-from.txt"), to = join(root, "r-to.txt");
    writeFileSync(from, "x");
    expect((await app.inject({ method: "POST", url: "/api/fs/rename", payload: { from, to } })).statusCode).toBe(200);
    expect(existsSync(from)).toBe(false);
    writeFileSync(from, "y");
    const collide = await app.inject({ method: "POST", url: "/api/fs/rename", payload: { from, to } });
    expect(collide.statusCode).toBe(400);
  });

  it("POST /api/fs/copy duplicates a file", async () => {
    const from = join(root, "c-from.txt"), to = join(root, "c-to.txt");
    writeFileSync(from, "dup");
    expect((await app.inject({ method: "POST", url: "/api/fs/copy", payload: { from, to } })).statusCode).toBe(200);
    expect(readFileSync(to, "utf8")).toBe("dup");
    expect(existsSync(from)).toBe(true);
  });

  it("POST /api/fs/copy duplicates a folder recursively", async () => {
    const src = join(root, "cp-src"); mkdirSync(src); writeFileSync(join(src, "inner.txt"), "deep");
    mkdirSync(join(src, "sub")); writeFileSync(join(src, "sub", "n.txt"), "nested");
    const to = join(root, "cp-dst");
    const res = await app.inject({ method: "POST", url: "/api/fs/copy", payload: { from: src, to } });
    expect(res.statusCode).toBe(200);
    expect(readFileSync(join(to, "inner.txt"), "utf8")).toBe("deep");
    expect(readFileSync(join(to, "sub", "n.txt"), "utf8")).toBe("nested");
  });

  // Copying a folder into its own subtree (what a Ctrl+C/Ctrl+V on a selected folder used to build)
  // makes node's cp throw ERR_FS_CP_EINVAL. That must surface as a clear message, never the generic
  // "operation failed" — so a slipped-through case is legible instead of a mystery toast.
  it("POST /api/fs/copy 400s with a clear message when copying a folder into itself", async () => {
    const src = join(root, "self-src"); mkdirSync(src); writeFileSync(join(src, "f.txt"), "x");
    const res = await app.inject({ method: "POST", url: "/api/fs/copy", payload: { from: src, to: join(src, "self-src") } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("ERR_FS_CP_EINVAL");
    expect(res.json().error).not.toBe("operation failed");
    expect(res.json().error).toMatch(/itself/i);
  });

  it("POST /api/fs/upload writes base64 bytes, creating parent dirs", async () => {
    const data = Buffer.from([0x89, 0x50, 0x4e, 0x00]); // binary, with a null byte
    const res = await app.inject({ method: "POST", url: "/api/fs/upload",
      payload: { dir: root, name: "drop/nested.bin", dataBase64: data.toString("base64") } });
    expect(res.statusCode).toBe(200);
    expect(readFileSync(join(root, "drop/nested.bin"))).toEqual(data);
  });

  it("POST /api/fs/upload 400s on a name escaping the dir", async () => {
    const res = await app.inject({ method: "POST", url: "/api/fs/upload",
      payload: { dir: root, name: "../evil.txt", dataBase64: Buffer.from("x").toString("base64") } });
    expect(res.statusCode).toBe(400);
  });

  it("POST /api/fs/upload-zip unpacks a zip (files + nested folder) into dir", async () => {
    const dest = mkdtempSync(join(tmpdir(), "tr-zip-dest-"));
    const zip = zipSync({ "x.txt": strToU8("hi"), "pics/y.png": strToU8("img") });
    const res = await app.inject({ method: "POST", url: `/api/fs/upload-zip?dir=${encodeURIComponent(dest)}`,
      headers: { "content-type": "application/zip" }, payload: Buffer.from(zip) });
    expect(res.statusCode).toBe(200);
    expect(res.json().files).toBe(2);
    expect(readFileSync(join(dest, "x.txt"), "utf8")).toBe("hi");
    expect(readFileSync(join(dest, "pics", "y.png"), "utf8")).toBe("img");
    rmSync(dest, { recursive: true, force: true });
  });

  it("POST /api/fs/upload-zip 400s on an empty body", async () => {
    const res = await app.inject({ method: "POST", url: `/api/fs/upload-zip?dir=${encodeURIComponent(root)}`,
      headers: { "content-type": "application/zip" }, payload: Buffer.alloc(0) });
    expect(res.statusCode).toBe(400);
  });

  it("POST /api/fs/paste-clipboard copies clipboard files/folders into dir", async () => {
    const dest = mkdtempSync(join(tmpdir(), "tr-clip-dest-"));
    const srcDir = mkdtempSync(join(tmpdir(), "tr-clip-src-"));
    const f = join(srcDir, "doc.txt"); writeFileSync(f, "hello");
    const folder = join(srcDir, "pics"); mkdirSync(folder); writeFileSync(join(folder, "a.png"), "img");
    clipboardSources.mockResolvedValueOnce([f, folder]);
    const res = await app.inject({ method: "POST", url: "/api/fs/paste-clipboard", payload: { dir: dest } });
    expect(res.statusCode).toBe(200);
    expect(res.json().pasted).toHaveLength(2);
    expect(readFileSync(join(dest, "doc.txt"), "utf8")).toBe("hello");
    expect(readFileSync(join(dest, "pics", "a.png"), "utf8")).toBe("img");
    rmSync(dest, { recursive: true, force: true }); rmSync(srcDir, { recursive: true, force: true });
  });

  it("POST /api/fs/paste-clipboard 403s an exposed (forwarded) request", async () => {
    const res = await app.inject({ method: "POST", url: "/api/fs/paste-clipboard",
      headers: { "x-forwarded-for": "203.0.113.7" }, payload: { dir: root } });
    expect(res.statusCode).toBe(403);
  });

  it("POST /api/fs/copy-clipboard writes the selected paths onto the host clipboard", async () => {
    clipboardWrite.mockResolvedValueOnce(true);
    const paths = [join(root, "hello.txt"), join(root, "somedir")];
    const res = await app.inject({ method: "POST", url: "/api/fs/copy-clipboard", payload: { paths } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, copied: 2 });
    expect(clipboardWrite).toHaveBeenCalledWith(paths);
  });

  it("POST /api/fs/copy-clipboard reports copied:0 when the OS write is unsupported", async () => {
    clipboardWrite.mockResolvedValueOnce(false);
    const res = await app.inject({ method: "POST", url: "/api/fs/copy-clipboard", payload: { paths: [join(root, "hello.txt")] } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: false, copied: 0 });
  });

  it("POST /api/fs/copy-clipboard 400s with no paths", async () => {
    const res = await app.inject({ method: "POST", url: "/api/fs/copy-clipboard", payload: { paths: [] } });
    expect(res.statusCode).toBe(400);
  });

  it("POST /api/fs/copy-clipboard 403s an exposed (forwarded) request", async () => {
    const res = await app.inject({ method: "POST", url: "/api/fs/copy-clipboard",
      headers: { "x-forwarded-for": "203.0.113.7" }, payload: { paths: [join(root, "hello.txt")] } });
    expect(res.statusCode).toBe(403);
  });

  it("POST /api/fs/delete removes a directory recursively", async () => {
    const d = join(root, "del"); mkdirSync(d); writeFileSync(join(d, "x"), "x");
    expect((await app.inject({ method: "POST", url: "/api/fs/delete", payload: { path: d } })).statusCode).toBe(200);
    expect(existsSync(d)).toBe(false);
  });
});
