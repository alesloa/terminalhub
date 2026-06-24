import { describe, it, expect, vi } from "vitest";
import { buildApp } from "../app.js";
import { createStore } from "../db/store.js";
import { createTmuxController } from "../tmux/controller.js";
import { createDriveController } from "../drive/controller.js";
import { createSessionsController } from "../presence/sessions.js";
import type { Config, GoogleConfig } from "../config.js";

const GOOGLE: GoogleConfig = { clientId: "cid", clientSecret: "sec", redirect: null };
const cfg: Config = {
  port: 0, host: "127.0.0.1", token: "secret", dbPath: ":memory:", fsRoots: null,
  reveal: null, onetimeBase: null, google: GOOGLE,
};

// A minimal ctx: only the pieces the Drive routes touch. The gate is now `ctx.drive.config()`, so the
// fake drive carries a `config()` returning either the resolved creds (configured) or null (offline).
// The HTTP methods are stubbed per test. The stealth test does the same — buildApp registers the whole
// AppContext but the loopback-injected Drive paths only reach store + drive.
function ctxWith(drive: any, store = createStore(":memory:")) {
  return { store, tmux: createTmuxController(async () => ""), drive, sessions: createSessionsController() } as any;
}
const online = (methods: any = {}, store = createStore(":memory:")) =>
  buildApp(cfg, ctxWith({ config: () => GOOGLE, ...methods }, store));
const offline = (store = createStore(":memory:")) =>
  buildApp({ ...cfg, google: null }, ctxWith({ config: () => null }, store));

describe("drive routes", () => {
  it("gates every drive route with 501 when no creds resolve", async () => {
    const app = await offline();
    const accounts = await app.inject({ method: "GET", url: "/api/drive/accounts" });
    expect(accounts.statusCode).toBe(501);
    expect(accounts.json()).toEqual({ error: "not configured" });
    expect((await app.inject({ method: "GET", url: "/api/drive/list?account=da_1&root=myDrive" })).statusCode).toBe(501);
  });

  it("lists accounts (public projection, no tokens) when configured", async () => {
    const store = createStore(":memory:");
    store.upsertDriveAccount({ email: "me@x.com", name: "Me", picture: null, refreshToken: "r", accessToken: "a", expiry: 1, scope: "drive" });
    const app = await online({ listFolder: vi.fn() }, store);
    const res = await app.inject({ method: "GET", url: "/api/drive/accounts" });
    expect(res.statusCode).toBe(200);
    expect(res.json().accounts).toHaveLength(1);
    expect(res.json().accounts[0]).toMatchObject({ email: "me@x.com", name: "Me" });
    expect(res.json().accounts[0].refreshToken).toBeUndefined();
  });

  it("lists a folder via the controller when configured", async () => {
    const listFolder = vi.fn(async () => [{ id: "1", name: "Sub", type: "dir" }]);
    const app = await online({ listFolder });
    const res = await app.inject({ method: "GET", url: "/api/drive/list?account=da_1&root=myDrive" });
    expect(res.statusCode).toBe(200);
    expect(res.json().entries[0].id).toBe("1");
    expect(listFolder).toHaveBeenCalledWith("da_1", { folderId: undefined, root: "myDrive" });
  });

  it("400s a list with no account", async () => {
    const app = await online({ listFolder: vi.fn() });
    expect((await app.inject({ method: "GET", url: "/api/drive/list?root=myDrive" })).statusCode).toBe(400);
  });

  it("returns a consent URL from /connect", async () => {
    const app = await online({ listFolder: vi.fn() });
    const res = await app.inject({ method: "GET", url: "/api/drive/connect", headers: { host: "localhost:8189" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().url).toContain("client_id=cid");
    expect(res.json().url).toContain("access_type=offline");
  });

  it("rejects a callback with a bad/unknown state", async () => {
    const app = await online({ listFolder: vi.fn() });
    const res = await app.inject({ method: "GET", url: "/api/drive/callback?code=abc&state=never-issued" });
    expect(res.statusCode).toBe(400);
  });

  it("streams file bytes with the real content-type", async () => {
    const getBytes = vi.fn(async () => ({ buffer: Buffer.from([1, 2, 3]), mimeType: "application/pdf" }));
    const app = await online({ getBytes });
    const res = await app.inject({ method: "GET", url: "/api/drive/file?account=da_1&id=f1" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect([...res.rawPayload]).toEqual([1, 2, 3]);
  });

  // --- write routes (Phase 3) ---
  it("gates the write routes with 501 when no creds resolve", async () => {
    const app = await offline();
    expect((await app.inject({ method: "POST", url: "/api/drive/mkdir", payload: { account: "da_1", parentId: "p", name: "x" } })).statusCode).toBe(501);
    expect((await app.inject({ method: "POST", url: "/api/drive/delete", payload: { account: "da_1", id: "f1" } })).statusCode).toBe(501);
  });

  it("mkdir forwards to the controller", async () => {
    const mkdir = vi.fn(async () => ({ id: "newfolder" }));
    const app = await online({ mkdir });
    const res = await app.inject({ method: "POST", url: "/api/drive/mkdir", payload: { account: "da_1", parentId: "p1", name: "Reports" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: "newfolder" });
    expect(mkdir).toHaveBeenCalledWith("da_1", "p1", "Reports");
  });

  it("rename forwards to the controller", async () => {
    const rename = vi.fn(async () => ({ id: "f1" }));
    const app = await online({ rename });
    const res = await app.inject({ method: "POST", url: "/api/drive/rename", payload: { account: "da_1", id: "f1", name: "renamed" } });
    expect(res.statusCode).toBe(200);
    expect(rename).toHaveBeenCalledWith("da_1", "f1", "renamed");
  });

  it("move forwards add/remove parents", async () => {
    const move = vi.fn(async () => ({ id: "f1" }));
    const app = await online({ move });
    const res = await app.inject({ method: "POST", url: "/api/drive/move", payload: { account: "da_1", id: "f1", addParents: "dest", removeParents: "src" } });
    expect(res.statusCode).toBe(200);
    expect(move).toHaveBeenCalledWith("da_1", "f1", "dest", "src");
  });

  it("delete (trash) forwards to the controller", async () => {
    const remove = vi.fn(async () => ({ id: "f1" }));
    const app = await online({ remove });
    const res = await app.inject({ method: "POST", url: "/api/drive/delete", payload: { account: "da_1", id: "f1" } });
    expect(res.statusCode).toBe(200);
    expect(remove).toHaveBeenCalledWith("da_1", "f1");
  });

  it("upload streams raw octet-stream bytes to the controller", async () => {
    const upload = vi.fn(async () => ({ id: "up1" }));
    const app = await online({ upload });
    const res = await app.inject({
      method: "POST", url: "/api/drive/upload?account=da_1&parent=p1&name=note.txt",
      headers: { "content-type": "application/octet-stream" }, payload: Buffer.from("hello"),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: "up1" });
    const [account, parent, name, buf] = upload.mock.calls[0];
    expect([account, parent, name]).toEqual(["da_1", "p1", "note.txt"]);
    expect(Buffer.isBuffer(buf) && buf.toString()).toBe("hello");
  });

  it("400s an upload with an empty body", async () => {
    const app = await online({ upload: vi.fn() });
    const res = await app.inject({
      method: "POST", url: "/api/drive/upload?account=da_1&parent=p1&name=note.txt",
      headers: { "content-type": "application/octet-stream" }, payload: Buffer.alloc(0),
    });
    expect(res.statusCode).toBe(400);
  });

  it("disconnect deletes the account row", async () => {
    const store = createStore(":memory:");
    const acc = store.upsertDriveAccount({ email: "me@x.com", name: null, picture: null, refreshToken: "r", accessToken: "a", expiry: 1, scope: "drive" });
    const app = await online({ listFolder: vi.fn() }, store);
    const res = await app.inject({ method: "DELETE", url: `/api/drive/accounts/${acc.id}` });
    expect(res.statusCode).toBe(200);
    expect(store.listDriveAccounts()).toHaveLength(0);
  });
});

// --- client-credential config endpoints, against a REAL drive controller (settings → env → null). ---
// These use the actual createDriveController so the resolve path + the store round-trip are exercised
// end-to-end (no fake config() shim). The secret must never be returned by any config response.
describe("drive config routes", () => {
  const buildReal = (google: GoogleConfig | null, store = createStore(":memory:")) =>
    buildApp({ ...cfg, google }, { store, tmux: createTmuxController(async () => ""), drive: createDriveController({ store, envGoogle: google }), sessions: createSessionsController() } as any);

  it("reports not configured and 501s the gated routes before anything is saved (no env)", async () => {
    const app = await buildReal(null);
    expect((await app.inject({ method: "GET", url: "/api/drive/config" })).json()).toEqual({ configured: false, clientId: null, source: null, redirect: null });
    expect((await app.inject({ method: "GET", url: "/api/drive/accounts" })).statusCode).toBe(501);
  });

  it("save → GET reports configured + clientId, NEVER the secret; gated routes open up", async () => {
    const store = createStore(":memory:");
    const app = await buildReal(null, store);
    const saved = await app.inject({ method: "POST", url: "/api/drive/config", payload: { clientId: "my-client-id", clientSecret: "my-secret" } });
    expect(saved.statusCode).toBe(200);

    const res = await app.inject({ method: "GET", url: "/api/drive/config" });
    expect(res.json()).toEqual({ configured: true, clientId: "my-client-id", source: "settings", redirect: null });
    expect(res.payload).not.toContain("my-secret"); // secret is write-only, never echoed

    expect((await app.inject({ method: "GET", url: "/api/drive/accounts" })).statusCode).toBe(200);
  });

  it("rejects an empty clientId or clientSecret", async () => {
    const app = await buildReal(null);
    expect((await app.inject({ method: "POST", url: "/api/drive/config", payload: { clientId: "", clientSecret: "x" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/drive/config", payload: { clientId: "x", clientSecret: "  " } })).statusCode).toBe(400);
  });

  it("clear → not configured again (no env)", async () => {
    const app = await buildReal(null);
    await app.inject({ method: "POST", url: "/api/drive/config", payload: { clientId: "cid", clientSecret: "sec" } });
    expect((await app.inject({ method: "GET", url: "/api/drive/config" })).json().configured).toBe(true);
    expect((await app.inject({ method: "DELETE", url: "/api/drive/config" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/drive/config" })).json()).toEqual({ configured: false, clientId: null, source: null, redirect: null });
  });

  it("falls back to env when no settings, and settings override env once saved", async () => {
    const env: GoogleConfig = { clientId: "env-id", clientSecret: "env-secret", redirect: null };
    const app = await buildReal(env);
    expect((await app.inject({ method: "GET", url: "/api/drive/config" })).json()).toEqual({ configured: true, clientId: "env-id", source: "env", redirect: null });

    await app.inject({ method: "POST", url: "/api/drive/config", payload: { clientId: "settings-id", clientSecret: "settings-secret" } });
    expect((await app.inject({ method: "GET", url: "/api/drive/config" })).json()).toEqual({ configured: true, clientId: "settings-id", source: "settings", redirect: null });

    await app.inject({ method: "DELETE", url: "/api/drive/config" });
    expect((await app.inject({ method: "GET", url: "/api/drive/config" })).json()).toEqual({ configured: true, clientId: "env-id", source: "env", redirect: null });
  });

  it("saves and surfaces a redirect override, and clears it with the creds", async () => {
    const store = createStore(":memory:");
    const app = await buildReal(null, store);
    await app.inject({ method: "POST", url: "/api/drive/config", payload: { clientId: "cid", clientSecret: "sec" } });
    await app.inject({ method: "POST", url: "/api/drive/redirect", payload: { redirect: "https://hub.example.com/api/drive/callback" } });
    expect((await app.inject({ method: "GET", url: "/api/drive/config" })).json())
      .toEqual({ configured: true, clientId: "cid", source: "settings", redirect: "https://hub.example.com/api/drive/callback" });

    // Empty string clears the override (back to origin-derived).
    await app.inject({ method: "POST", url: "/api/drive/redirect", payload: { redirect: "" } });
    expect((await app.inject({ method: "GET", url: "/api/drive/config" })).json().redirect).toBeNull();

    // Removing the creds also drops the override.
    await app.inject({ method: "POST", url: "/api/drive/redirect", payload: { redirect: "https://hub.example.com/api/drive/callback" } });
    await app.inject({ method: "DELETE", url: "/api/drive/config" });
    expect((await app.inject({ method: "GET", url: "/api/drive/config" })).json().redirect).toBeNull();
  });

  it("renames a connected Drive (label), and an empty label falls back to the email", async () => {
    const store = createStore(":memory:");
    const acc = store.upsertDriveAccount({ email: "me@x.com", name: null, picture: null, refreshToken: "r", accessToken: "a", expiry: 1, scope: "drive" });
    const app = await buildReal(null, store);
    await app.inject({ method: "POST", url: "/api/drive/config", payload: { clientId: "cid", clientSecret: "sec" } });

    expect((await app.inject({ method: "PATCH", url: `/api/drive/accounts/${acc.id}`, payload: { label: "Work" } })).statusCode).toBe(200);
    expect(store.listDriveAccounts()[0].label).toBe("Work");

    await app.inject({ method: "PATCH", url: `/api/drive/accounts/${acc.id}`, payload: { label: "  " } });
    expect(store.listDriveAccounts()[0].label).toBeNull();
  });
});
