import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createOAuth } from "../drive/oauth.js";
import type { AppContext } from "../context.js";
import type { Config } from "../config.js";

// Routes for the File Browser's Drive mount. Google creds resolve per request (Settings DB → env →
// null): when nothing resolves, `ctx.drive.config()` is null and every route returns 501 "not
// configured" — no fake accounts, no stub tokens. Refresh tokens live only on the server (db); the
// browser sees the public account projection + bytes only, never the client secret.
export async function driveRoutes(app: FastifyInstance, ctx: AppContext, _config: Config) {
  // Short-lived CSRF states issued by /connect and consumed once by /callback. In-memory: a consent
  // round-trip is seconds, and a restart just invalidates any in-flight connect (harmless re-try).
  const states = new Set<string>();

  // The feature is on only when creds resolve (settings or env). Returns the resolved GoogleConfig for
  // the happy path, or sends 501 and returns null to short-circuit the handler.
  const requireDrive = (reply: FastifyReply) => {
    const google = ctx.drive.config();
    if (!google) { reply.code(501).send({ error: "not configured" }); return null; }
    return google;
  };
  const originOf = (req: FastifyRequest) =>
    `${(req.headers["x-forwarded-proto"] as string) ?? req.protocol}://${req.headers.host}`;

  // Raw file bytes for the Drive upload arrive as application/octet-stream (no base64 inflation),
  // scoped to this plugin so it doesn't clash with the JSON/zip parsers elsewhere.
  const MB = 1024 * 1024;
  const MAX_UPLOAD_BYTES = 100 * MB;
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: MAX_UPLOAD_BYTES + 2 * MB }, (_req, body, done) => done(null, body));

  // --- Client-credential config (set from Settings). The secret is WRITE-ONLY: it's accepted by POST
  // and stored server-side, but GET never returns it (only whether it's configured + the public id). ---
  app.get("/api/drive/config", async () => {
    const settings = ctx.store.getDriveCredentials();
    const resolved = ctx.drive.config();
    const source = settings ? "settings" : resolved ? "env" : null;
    // `redirect` is the (non-secret) OAuth callback override, surfaced so the Settings UI can show it.
    return { configured: !!resolved, clientId: resolved?.clientId ?? null, source, redirect: resolved?.redirect ?? null } as const;
  });

  app.post("/api/drive/config", async (req, reply) => {
    const b = z.object({ clientId: z.string().trim().min(1), clientSecret: z.string().trim().min(1) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "clientId and clientSecret required" });
    ctx.store.setDriveCredentials({ clientId: b.data.clientId, clientSecret: b.data.clientSecret });
    return { ok: true as const };
  });

  // OAuth redirect-URI override (separate from creds so it can change without re-entering the secret).
  // Empty string clears it → the server falls back to deriving the callback from the request origin.
  app.post("/api/drive/redirect", async (req, reply) => {
    const b = z.object({ redirect: z.string() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "redirect required" });
    ctx.store.setDriveRedirect(b.data.redirect.trim() || null);
    return { ok: true as const };
  });

  app.delete("/api/drive/config", async () => {
    ctx.store.clearDriveCredentials();
    return { ok: true as const };
  });

  app.get("/api/drive/accounts", async (_req, reply) => {
    if (!requireDrive(reply)) return;
    return { accounts: ctx.store.listDriveAccounts() };
  });

  app.get("/api/drive/connect", async (req, reply) => {
    const google = requireDrive(reply); if (!google) return;
    const state = randomUUID(); states.add(state);
    return { url: createOAuth(google).consentUrl(state, originOf(req)) };
  });

  app.get("/api/drive/callback", async (req, reply) => {
    const google = requireDrive(reply); if (!google) return;
    const q = z.object({ code: z.string(), state: z.string() }).safeParse(req.query);
    if (!q.success || !states.delete(q.data.state)) return reply.code(400).send({ error: "bad oauth state" });
    const oauth = createOAuth(google);
    const t = await oauth.exchange(q.data.code, originOf(req));
    if (!t.refreshToken) return reply.code(400).send({ error: "no refresh token — remove app access and reconnect" });
    ctx.store.upsertDriveAccount({ email: t.email, name: null, picture: null, refreshToken: t.refreshToken, accessToken: t.accessToken, expiry: t.expiry, scope: t.scope });
    return reply.redirect("/");
  });

  app.get("/api/drive/list", async (req, reply) => {
    if (!requireDrive(reply)) return;
    const q = z.object({
      account: z.string(),
      folder: z.string().optional(),
      root: z.enum(["myDrive", "sharedWithMe", "sharedDrives"]).optional(),
    }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "account required" });
    return { entries: await ctx.drive.listFolder(q.data.account, { folderId: q.data.folder, root: q.data.root }) };
  });

  app.get("/api/drive/file", async (req, reply) => {
    if (!requireDrive(reply)) return;
    const q = z.object({ account: z.string(), id: z.string() }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "account and id required" });
    const { buffer, mimeType } = await ctx.drive.getBytes(q.data.account, q.data.id);
    return reply.type(mimeType).send(buffer);
  });

  // Overwrite an existing Drive file's content (the File Browser editor's Save). Body is the raw new
  // bytes (application/octet-stream); an empty body is allowed (saving a file you cleared).
  app.patch("/api/drive/file", { bodyLimit: MAX_UPLOAD_BYTES + 2 * MB }, async (req, reply) => {
    if (!requireDrive(reply)) return;
    const q = z.object({ account: z.string(), id: z.string() }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "account and id required" });
    const buf = req.body;
    if (!Buffer.isBuffer(buf)) return reply.code(400).send({ error: "expected an octet-stream body" });
    return ctx.drive.updateContent(q.data.account, q.data.id, buf);
  });

  // Rename a connected Drive (the label shown in the Places bar / Settings). Empty → back to email.
  app.patch<{ Params: { id: string }; Body: { label?: string } }>("/api/drive/accounts/:id", async (req, reply) => {
    if (!requireDrive(reply)) return;
    const b = z.object({ label: z.string() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "label required" });
    ctx.store.renameDriveAccount(req.params.id, b.data.label);
    return { ok: true as const };
  });

  // Revoke is not exposed by the OAuth helper; deleting the row drops the server-held refresh token
  // (the account no longer appears and its tokens are gone). The browser never held a token to clear.
  app.delete<{ Params: { id: string } }>("/api/drive/accounts/:id", async (req, reply) => {
    if (!requireDrive(reply)) return;
    ctx.store.deleteDriveAccount(req.params.id);
    return { ok: true as const };
  });

  app.post("/api/drive/mkdir", async (req, reply) => {
    if (!requireDrive(reply)) return;
    const b = z.object({ account: z.string(), parentId: z.string(), name: z.string().min(1) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "account, parentId and name required" });
    return ctx.drive.mkdir(b.data.account, b.data.parentId, b.data.name);
  });

  app.post("/api/drive/rename", async (req, reply) => {
    if (!requireDrive(reply)) return;
    const b = z.object({ account: z.string(), id: z.string(), name: z.string().min(1) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "account, id and name required" });
    return ctx.drive.rename(b.data.account, b.data.id, b.data.name);
  });

  app.post("/api/drive/move", async (req, reply) => {
    if (!requireDrive(reply)) return;
    const b = z.object({ account: z.string(), id: z.string(), addParents: z.string().optional(), removeParents: z.string().optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "account and id required" });
    return ctx.drive.move(b.data.account, b.data.id, b.data.addParents, b.data.removeParents);
  });

  app.post("/api/drive/delete", async (req, reply) => {
    if (!requireDrive(reply)) return;
    const b = z.object({ account: z.string(), id: z.string() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "account and id required" });
    return ctx.drive.remove(b.data.account, b.data.id);
  });

  // Raw bytes (application/octet-stream) → a new Drive file. The real MIME is inferred from `name`.
  app.post("/api/drive/upload", { bodyLimit: MAX_UPLOAD_BYTES + 2 * MB }, async (req, reply) => {
    if (!requireDrive(reply)) return;
    const q = z.object({ account: z.string(), parent: z.string(), name: z.string().min(1) }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "account, parent and name required" });
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) return reply.code(400).send({ error: "empty body" });
    return ctx.drive.upload(q.data.account, q.data.parent, q.data.name, buf);
  });
}
