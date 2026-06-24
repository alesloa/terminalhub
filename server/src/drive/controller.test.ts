import { describe, it, expect, vi, afterEach } from "vitest";
import { createDriveController } from "./controller.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// Creds resolve through the store now; a store mock reports configured so `config()` is non-null and
// the HTTP methods build their OAuth. `makeOAuth` is stubbed so the fake oauth drives token refresh.
const withCreds = (extra: Record<string, any>) => ({
  getDriveCredentials: vi.fn(() => ({ clientId: "cid", clientSecret: "sec" })),
  ...extra,
} as any);

describe("drive controller", () => {
  it("refreshes an expired token then lists a folder", async () => {
    const store = withCreds({
      getDriveAccount: vi.fn(() => ({ id: "da_1", refreshToken: "r", accessToken: "old", expiry: 1, scope: "drive" })),
      updateDriveTokens: vi.fn(),
    });
    const oauth = { refresh: vi.fn(async () => ({ accessToken: "fresh", expiry: Date.now() + 9e5 })) } as any;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ files: [
      { id: "1", name: "Sub", mimeType: "application/vnd.google-apps.folder" },
    ] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const ctrl = createDriveController({ store, envGoogle: null, makeOAuth: () => oauth });
    const entries = await ctrl.listFolder("da_1", { root: "myDrive" });

    expect(oauth.refresh).toHaveBeenCalledWith("r");           // expiry=1 is in the past
    expect(store.updateDriveTokens).toHaveBeenCalledWith("da_1", { accessToken: "fresh", expiry: expect.any(Number) });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer fresh");
    expect(entries).toEqual([expect.objectContaining({ id: "1", type: "dir" })]);
  });

  it("reuses a still-valid access token without refreshing", async () => {
    const store = withCreds({
      getDriveAccount: vi.fn(() => ({ id: "da_1", refreshToken: "r", accessToken: "valid", expiry: Date.now() + 9e5, scope: "drive" })),
      updateDriveTokens: vi.fn(),
    });
    const oauth = { refresh: vi.fn() } as any;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ files: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const ctrl = createDriveController({ store, envGoogle: null, makeOAuth: () => oauth });
    await ctrl.listFolder("da_1", { root: "myDrive" });
    expect(oauth.refresh).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer valid");
  });

  it("getBytes exports a native doc to PDF and downloads a binary raw", async () => {
    const store = withCreds({
      getDriveAccount: vi.fn(() => ({ id: "da_1", refreshToken: "r", accessToken: "valid", expiry: Date.now() + 9e5, scope: "drive" })),
      updateDriveTokens: vi.fn(),
    });
    const oauth = { refresh: vi.fn() } as any;

    // 1st call = metadata (native doc), 2nd = export bytes.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ mimeType: "application/vnd.google-apps.document" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const ctrl = createDriveController({ store, envGoogle: null, makeOAuth: () => oauth });
    const out = await ctrl.getBytes("da_1", "f1");
    expect(out.mimeType).toBe("application/pdf");
    expect([...out.buffer]).toEqual([1, 2, 3]);
    expect(decodeURIComponent(fetchMock.mock.calls[1][0])).toContain("/export?mimeType=application/pdf");

    // Binary file: metadata says a real mime, second call is alt=media.
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ mimeType: "application/pdf" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([9]), { status: 200 }));
    const raw = await ctrl.getBytes("da_1", "f2");
    expect(raw.mimeType).toBe("application/pdf");
    expect(fetchMock.mock.calls[3][0]).toContain("alt=media");
  });

  it("throws on a non-ok Drive response", async () => {
    const store = withCreds({
      getDriveAccount: vi.fn(() => ({ id: "da_1", refreshToken: "r", accessToken: "valid", expiry: Date.now() + 9e5, scope: "drive" })),
      updateDriveTokens: vi.fn(),
    });
    const oauth = { refresh: vi.fn() } as any;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 403 })));
    const ctrl = createDriveController({ store, envGoogle: null, makeOAuth: () => oauth });
    await expect(ctrl.listFolder("da_1", { root: "myDrive" })).rejects.toThrow(/drive 403/);
  });

  // --- creds resolution: settings → env → null ---
  it("config() resolves settings creds first, then env, else null", () => {
    const noCreds = { getDriveAccount: vi.fn(), updateDriveTokens: vi.fn(), getDriveCredentials: vi.fn(() => null) } as any;
    expect(createDriveController({ store: noCreds, envGoogle: null }).config()).toBeNull();

    const env = { clientId: "envid", clientSecret: "envsec", redirect: "https://h/api/drive/callback" };
    expect(createDriveController({ store: noCreds, envGoogle: env }).config()).toEqual(env);

    const settings = { getDriveAccount: vi.fn(), updateDriveTokens: vi.fn(), getDriveCredentials: vi.fn(() => ({ clientId: "sid", clientSecret: "ssec" })) } as any;
    // Settings win over env; redirect is still inherited from env (operators set it there).
    expect(createDriveController({ store: settings, envGoogle: env }).config())
      .toEqual({ clientId: "sid", clientSecret: "ssec", redirect: env.redirect });
  });

  it("throws 'not configured' when no creds resolve", async () => {
    const store = { getDriveAccount: vi.fn(() => ({ id: "da_1", refreshToken: "r", accessToken: null, expiry: null, scope: "drive" })), updateDriveTokens: vi.fn(), getDriveCredentials: vi.fn(() => null) } as any;
    vi.stubGlobal("fetch", vi.fn());
    const ctrl = createDriveController({ store, envGoogle: null });
    await expect(ctrl.listFolder("da_1", { root: "myDrive" })).rejects.toThrow(/not configured/);
  });

  // --- write methods (Phase 3) ---
  const validStore = () => withCreds({
    getDriveAccount: vi.fn(() => ({ id: "da_1", refreshToken: "r", accessToken: "valid", expiry: Date.now() + 9e5, scope: "drive" })),
    updateDriveTokens: vi.fn(),
  });
  const oauthNoRefresh = () => ({ refresh: vi.fn() } as any);
  const mkCtrl = (oauth: any) => createDriveController({ store: validStore(), envGoogle: null, makeOAuth: () => oauth });

  it("mkdir POSTs a folder under the parent", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "newfolder" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const ctrl = mkCtrl(oauthNoRefresh());
    const out = await ctrl.mkdir("da_1", "parent1", "Reports");
    expect(out).toEqual({ id: "newfolder" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/files?");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body).toEqual({ name: "Reports", mimeType: "application/vnd.google-apps.folder", parents: ["parent1"] });
  });

  it("rename PATCHes the name", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "f1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const ctrl = mkCtrl(oauthNoRefresh());
    await ctrl.rename("da_1", "f1", "new-name.txt");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/files/f1?");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ name: "new-name.txt" });
  });

  it("move PATCHes addParents / removeParents", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "f1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const ctrl = mkCtrl(oauthNoRefresh());
    await ctrl.move("da_1", "f1", "dest", "src");
    const [url, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("PATCH");
    expect(url).toContain("addParents=dest");
    expect(url).toContain("removeParents=src");
  });

  it("remove trashes (PATCH trashed:true), not a permanent delete", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "f1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const ctrl = mkCtrl(oauthNoRefresh());
    await ctrl.remove("da_1", "f1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("PATCH"); // NOT DELETE — trash is recoverable
    expect(url).toContain("/files/f1?");
    expect(JSON.parse(init.body)).toEqual({ trashed: true });
  });

  it("upload multipart-POSTs bytes with the inferred mime", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "up1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const ctrl = mkCtrl(oauthNoRefresh());
    const out = await ctrl.upload("da_1", "parent1", "note.txt", Buffer.from("hello"));
    expect(out).toEqual({ id: "up1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/upload/drive/v3/files?uploadType=multipart");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toMatch(/^multipart\/related; boundary=/);
    const body = (init.body as Buffer).toString();
    expect(body).toContain("Content-Type: text/plain"); // inferred from .txt
    expect(body).toContain("hello");
  });

  it("upload throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    const ctrl = mkCtrl(oauthNoRefresh());
    await expect(ctrl.upload("da_1", "p", "x.bin", Buffer.from([1]))).rejects.toThrow(/drive 500/);
  });

  it("updateContent media-PATCHes new bytes to an existing file (id + parents unchanged)", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "f1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const ctrl = mkCtrl(oauthNoRefresh());
    const out = await ctrl.updateContent("da_1", "f1", Buffer.from("edited"), "text/plain");
    expect(out).toEqual({ id: "f1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/upload/drive/v3/files/f1?uploadType=media");
    expect(init.method).toBe("PATCH"); // updates content in place — never creates a new file
    expect(init.headers["Content-Type"]).toBe("text/plain");
    expect((init.body as Buffer).toString()).toBe("edited");
  });

  it("updateContent throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 403 })));
    const ctrl = mkCtrl(oauthNoRefresh());
    await expect(ctrl.updateContent("da_1", "f1", Buffer.from("x"))).rejects.toThrow(/drive 403/);
  });
});
