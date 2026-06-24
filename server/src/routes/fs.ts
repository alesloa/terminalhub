import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { listDir, listVolumes, readFile, writeFile, readFileBytes, writeFileBytes, writeDocxFromHtml, createFile, createDir, renamePath, copyPath, deletePath, writeUpload, pasteClipboardInto } from "../fs/browser.js";
import { extractZipInto } from "../fs/archive.js";
import { listFiles } from "../fs/search.js";
import { readClipboardFiles } from "../fs/clipboard.js";
import { isLoopback } from "../auth/guard.js";

const MB = 1024 * 1024;
const MAX_UPLOAD_BYTES = 50 * MB; // decoded cap per file dragged/pasted into the explorer
const MAX_ZIP_BYTES = 100 * MB;   // cap per zipped folder/multi-file batch (raw archive bytes)

/** Map a node fs error to a client-friendly 400. */
function fsError(reply: FastifyReply, err: any) {
  const msg = err.code === "EACCES" ? "permission denied"
    : err.code === "EEXIST" ? "already exists"
    : err.code === "ENOENT" ? "no such file or directory"
    : err.code === "ENOTEMPTY" ? "directory not empty"
    : "operation failed";
  return reply.code(400).send({ error: msg, code: err.code });
}

export async function fsRoutes(app: FastifyInstance) {
  // Raw zip bytes for the folder/multi-file upload arrive as application/zip (no base64 inflation).
  app.addContentTypeParser("application/zip", { parseAs: "buffer", bodyLimit: MAX_ZIP_BYTES + 2 * MB }, (_req, body, done) => done(null, body));

  app.get("/api/fs/volumes", async () => ({ volumes: await listVolumes() }));

  app.get("/api/fs/list", async (req, reply) => {
    const q = z.object({ path: z.string().min(1), all: z.enum(["true", "false"]).optional() }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "path required" });
    try {
      return await listDir(q.data.path, { includeHidden: q.data.all === "true" });
    } catch (err: any) {
      return reply.code(400).send({ error: err.code === "EACCES" ? "permission denied" : "cannot read directory", code: err.code });
    }
  });

  // Flat filename index for the Explorer's "Filter Files" tab: every file under `root` (build/system
  // folders pruned). The client caches it and fuzzy-filters in memory, so typing narrows instantly.
  app.get("/api/fs/files", async (req, reply) => {
    const q = z.object({ root: z.string().min(1) }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "root required" });
    try {
      return await listFiles(q.data.root);
    } catch (err: any) {
      return reply.code(400).send({ error: err.code === "EACCES" ? "permission denied" : "cannot list files", code: err.code });
    }
  });

  app.get("/api/fs/file", async (req, reply) => {
    const q = z.object({ path: z.string().min(1) }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "path required" });
    try {
      return await readFile(q.data.path);
    } catch (err: any) {
      return reply.code(400).send({ error: err.code === "EACCES" ? "permission denied" : "cannot read file", code: err.code });
    }
  });

  app.put("/api/fs/file", async (req, reply) => {
    const b = z.object({ path: z.string().min(1), content: z.string() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path and content required" });
    try {
      return await writeFile(b.data.path, b.data.content);
    } catch (err: any) {
      return reply.code(400).send({ error: err.code === "EACCES" ? "permission denied" : "cannot write file", code: err.code });
    }
  });

  // Raw-bytes read/write for the rich editors (docx, …) that can't ride the utf8 routes above.
  app.get("/api/fs/file-bytes", async (req, reply) => {
    const q = z.object({ path: z.string().min(1) }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "path required" });
    try {
      return await readFileBytes(q.data.path);
    } catch (err: any) {
      return reply.code(400).send({ error: err.code === "EACCES" ? "permission denied" : "cannot read file", code: err.code });
    }
  });

  // bodyLimit lifted well past the 25 MiB binary cap to leave room for base64's ~33% inflation + the JSON envelope.
  app.put("/api/fs/file-bytes", { bodyLimit: 40 * MB }, async (req, reply) => {
    const b = z.object({ path: z.string().min(1), dataBase64: z.string() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path and dataBase64 required" });
    try {
      return await writeFileBytes(b.data.path, b.data.dataBase64);
    } catch (err: any) {
      return reply.code(400).send({ error: err.code === "EACCES" ? "permission denied" : "cannot write file", code: err.code });
    }
  });

  // The Word editor posts its document HTML; we render the .docx on Node and write it to `path`.
  app.post("/api/fs/docx", { bodyLimit: 40 * MB }, async (req, reply) => {
    const b = z.object({ path: z.string().min(1), html: z.string() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path and html required" });
    try {
      return await writeDocxFromHtml(b.data.path, b.data.html);
    } catch (err: any) {
      return reply.code(400).send({ error: err.code === "EACCES" ? "permission denied" : "cannot write document", code: err.code });
    }
  });

  // ---- mutations (New File/Folder, Rename, Duplicate/Paste, Delete) ----

  app.post("/api/fs/create", async (req, reply) => {
    const b = z.object({ path: z.string().min(1) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path required" });
    try { return await createFile(b.data.path); } catch (err: any) { return fsError(reply, err); }
  });

  app.post("/api/fs/mkdir", async (req, reply) => {
    const b = z.object({ path: z.string().min(1) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path required" });
    try { return await createDir(b.data.path); } catch (err: any) { return fsError(reply, err); }
  });

  app.post("/api/fs/rename", async (req, reply) => {
    const b = z.object({ from: z.string().min(1), to: z.string().min(1) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "from and to required" });
    try { return await renamePath(b.data.from, b.data.to); } catch (err: any) { return fsError(reply, err); }
  });

  app.post("/api/fs/copy", async (req, reply) => {
    const b = z.object({ from: z.string().min(1), to: z.string().min(1) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "from and to required" });
    try { return await copyPath(b.data.from, b.data.to); } catch (err: any) { return fsError(reply, err); }
  });

  // Drag/paste a real OS file into the explorer. The browser holds the bytes (a dropped Finder
  // file exposes no host path), so they're POSTed base64 — like /clip-image — and written under
  // `dir`. `name` may include subdirs for a dropped folder; missing parents are created. bodyLimit
  // is lifted past the decoded cap to leave room for base64's ~33% inflation.
  app.post("/api/fs/upload", { bodyLimit: 70 * MB }, async (req, reply) => {
    const b = z.object({ dir: z.string().min(1), name: z.string().min(1), dataBase64: z.string() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "dir, name and dataBase64 required" });
    if (Buffer.byteLength(b.data.dataBase64, "base64") > MAX_UPLOAD_BYTES) return reply.code(413).send({ error: "file too large" });
    try { return await writeUpload(b.data.dir, b.data.name, b.data.dataBase64); } catch (err: any) { return fsError(reply, err); }
  });

  // Folder / multi-file upload: the browser zips the dropped tree (or pasted files) into one
  // archive and POSTs the raw bytes here; we unpack them under `dir`. One round-trip for a whole
  // folder — the workable path for a remote VPS where the host can't read the user's clipboard.
  app.post("/api/fs/upload-zip", { bodyLimit: MAX_ZIP_BYTES + 2 * MB }, async (req, reply) => {
    const q = z.object({ dir: z.string().min(1) }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "dir required" });
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) return reply.code(400).send({ error: "empty or non-zip body" });
    try { return await extractZipInto(q.data.dir, buf); } catch (err: any) { return fsError(reply, err); }
  });

  // Desktop-style Paste (Cmd+V) on a local host: read the host OS clipboard for copied files/folders
  // and copy them into `dir` with a real recursive cp — so multi-selections and whole folders come
  // through, intact and instantly (no byte upload). Local-only: reading the host clipboard over a
  // tunnel would hand the server operator's clipboard to a remote user, so exposed requests refuse.
  app.post("/api/fs/paste-clipboard", async (req, reply) => {
    const exposed = Boolean(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"]) || !isLoopback(req.ip);
    if (exposed) return reply.code(403).send({ error: "clipboard paste is local-only" });
    const b = z.object({ dir: z.string().min(1) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "dir required" });
    try { return await pasteClipboardInto(b.data.dir, await readClipboardFiles()); }
    catch (err: any) { return fsError(reply, err); }
  });

  app.post("/api/fs/delete", async (req, reply) => {
    const b = z.object({ path: z.string().min(1) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path required" });
    try { return await deletePath(b.data.path); } catch (err: any) { return fsError(reply, err); }
  });
}
