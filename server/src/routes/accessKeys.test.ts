import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { createStore } from "../db/store.js";
import { createSessionsController } from "../presence/sessions.js";
import { accessKeyRoutes } from "./accessKeys.js";

function fakeSocket() {
  return {
    sent: [] as any[],
    closed: false,
    send(d: string) { this.sent.push(JSON.parse(d)); },
    close() { this.closed = true; },
  };
}

// Mirror the app's preHandler: stash a principal on every request. `kind` selects owner vs teammate.
function build(kind: "main" | "key" = "main") {
  const store = createStore(":memory:");
  const sessions = createSessionsController();
  const ctx = { store, sessions } as any;
  const app = Fastify();
  app.addHook("preHandler", async (req) => {
    (req as any).principal = kind === "key" ? { kind: "key", keyId: "ak_guest" } : { kind: "main" };
  });
  app.register(async (a) => accessKeyRoutes(a, ctx));
  return { app, ctx, store, sessions };
}

describe("access-key routes: owner-only guard", () => {
  it("returns 403 to a key principal on read and write endpoints", async () => {
    const { app } = build("key");
    expect((await app.inject({ method: "GET", url: "/api/access-keys" })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/access-keys", payload: { label: "x" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: "/api/access-keys/ak_1" })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/access-keys/admit", payload: { sessionId: "s", decision: "accept" } })).statusCode).toBe(403);
  });
});

describe("access-key routes: list + create", () => {
  it("GET returns keys (with secret) and the live session roster", async () => {
    const { app, store, sessions } = build();
    const key = store.createAccessKey({ label: "Bob" });
    sessions.open(key.id, "Bob", fakeSocket() as any);
    const res = await app.inject({ method: "GET", url: "/api/access-keys" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0].secret).toBe(key.secret);
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].name).toBe("Bob");
  });

  it("POST mints a key, returns it with a secret, and persists it", async () => {
    const { app, store } = build();
    const res = await app.inject({ method: "POST", url: "/api/access-keys", payload: { label: "Bob", workspaceId: "ws_1" } });
    expect(res.statusCode).toBe(200);
    const key = res.json().key;
    expect(key.label).toBe("Bob");
    expect(key.workspaceId).toBe("ws_1");
    expect(typeof key.secret).toBe("string");
    expect(store.listAccessKeys().map((k) => k.id)).toContain(key.id);
  });

  it("POST rejects a malformed body", async () => {
    const { app } = build();
    const res = await app.inject({ method: "POST", url: "/api/access-keys", payload: { expiresAt: "soon" } });
    expect(res.statusCode).toBe(400);
  });
});

describe("access-key routes: revoke", () => {
  it("DELETE deletes the key and closes every socket on it", async () => {
    const { app, store, sessions } = build();
    const key = store.createAccessKey({ label: "Bob" });
    const sock = fakeSocket();
    sessions.attach(key.id, sock as any);
    const res = await app.inject({ method: "DELETE", url: `/api/access-keys/${key.id}` });
    expect(res.statusCode).toBe(200);
    expect(store.getValidAccessKey(key.secret)).toBeUndefined();
    expect(sock.closed).toBe(true);
  });
});

describe("access-key routes: kick", () => {
  it("POST /sessions/:sid/kick disconnects that teammate", async () => {
    const { app, store, sessions } = build();
    const key = store.createAccessKey({});
    const term = fakeSocket();
    sessions.attach(key.id, term as any);
    const s = sessions.open(key.id, "Bob", fakeSocket() as any);
    const res = await app.inject({ method: "POST", url: `/api/access-keys/sessions/${s.sessionId}/kick` });
    expect(res.statusCode).toBe(200);
    expect(term.closed).toBe(true);
    expect(sessions.list()).toHaveLength(0);
  });
});

describe("access-key routes: admit", () => {
  it("accept admits the session and leaves the key valid", async () => {
    const { app, store, sessions } = build();
    const key = store.createAccessKey({});
    const s = sessions.open(key.id, "Bob", fakeSocket() as any);
    const res = await app.inject({ method: "POST", url: "/api/access-keys/admit", payload: { sessionId: s.sessionId, decision: "accept" } });
    expect(res.statusCode).toBe(200);
    expect(sessions.list().find((x) => x.sessionId === s.sessionId)?.status).toBe("admitted");
    expect(store.getValidAccessKey(key.secret)?.id).toBe(key.id);
  });

  it("decline drops the session and revokes the key", async () => {
    const { app, store, sessions } = build();
    const key = store.createAccessKey({});
    const s = sessions.open(key.id, "Bob", fakeSocket() as any);
    const res = await app.inject({ method: "POST", url: "/api/access-keys/admit", payload: { sessionId: s.sessionId, decision: "decline" } });
    expect(res.statusCode).toBe(200);
    expect(sessions.list()).toHaveLength(0);
    expect(store.listAccessKeys()).toHaveLength(0);
  });
});
