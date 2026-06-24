import { describe, it, expect, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import WebSocket from "ws";
import { createStore } from "../db/store.js";
import { createSessionsController } from "../presence/sessions.js";
import { presenceGateway } from "./presenceGateway.js";
import type { AppContext } from "../context.js";
import type { Config } from "../config.js";

// Real /ws/presence endpoint over a live socket so a test can drive the FULL auth → admission → hub
// relay path with real WebSocket clients (app.inject can't do WS upgrades). This is the seam that was
// previously untested: a locked, mirror-on key only ever joins the hub via the onAdmit hook (a locked
// spectator never sends a cursor), so this is the exact path the owner's `view` frames must survive.
async function startGateway() {
  const app = Fastify();
  await app.register(websocket);
  const store = createStore(":memory:");
  const sessions = createSessionsController();
  const ctx = { store, sessions } as unknown as AppContext;
  const config = { token: "main-token" } as unknown as Config;
  await presenceGateway(app, ctx, config);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { app, ctx, store, url: `ws://127.0.0.1:${port}/ws/presence` };
}

interface Waiter { match: (m: any) => boolean; resolve: (m: any) => void; reject: (e: Error) => void; }

// A WebSocket client that buffers EVERY frame from creation (the server sends hello/welcome
// synchronously on connect, so a listener attached after "open" would miss them).
interface Client {
  send(o: unknown): void;
  close(): void;
  next(match: (m: any) => boolean, ms?: number): Promise<any>;     // resolve with the next/buffered matching frame
  none(match: (m: any) => boolean, ms?: number): Promise<void>;    // assert no such frame arrives within ms
}

function open(url: string, headers?: Record<string, string>): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, headers ? { headers } : undefined);
    const inbox: any[] = [];
    const waiters: Waiter[] = [];
    ws.on("message", (raw: any) => {
      let m: any;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      inbox.push(m);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].match(m)) { waiters[i].resolve(m); waiters.splice(i, 1); }
      }
    });
    const client: Client = {
      send: (o) => ws.send(JSON.stringify(o)),
      close: () => ws.close(),
      next: (match, ms = 2000) => new Promise((res, rej) => {
        const found = inbox.find(match);
        if (found) return res(found);
        const w: Waiter = { match, resolve: res, reject: rej };
        waiters.push(w);
        setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); rej(new Error("timed out waiting for frame")); } }, ms);
      }),
      none: (match, ms = 300) => new Promise((res, rej) => {
        if (inbox.find(match)) return rej(new Error("frame already arrived that should not have"));
        const w: Waiter = { match, resolve: () => rej(new Error("received a frame that should not have arrived")), reject: rej };
        waiters.push(w);
        setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); res(); }, ms);
      }),
    };
    ws.once("open", () => resolve(client));
    ws.once("error", reject);
  });
}

describe("presence gateway: view mirroring to an admitted key", () => {
  let app: FastifyInstance | null = null;
  afterEach(async () => { await app?.close(); app = null; });

  it("delivers the owner's `view` frame to an admitted locked+mirror key (the user's exact link shape)", async () => {
    const g = await startGateway();
    app = g.app;
    const key = g.ctx.store.createAccessKey({ label: "ss", mirror: true, lock: true });

    const main = await open(g.url); // loopback → owner (role main)
    await main.next((m) => m.type === "hello" && m.role === "main");

    // A teammate arrives exposed (forwarded, non-loopback) with the key secret → key principal.
    const guest = await open(`${g.url}?token=${encodeURIComponent(key.secret)}`, { "x-forwarded-for": "203.0.113.7" });
    const hello = await guest.next((m) => m.type === "hello");
    expect(hello).toMatchObject({ role: "key", mirror: true, lock: true });

    // Owner is prompted; accept using the sessionId from the joinRequest.
    const jr = await main.next((m) => m.type === "joinRequest");
    main.send({ type: "admit", sessionId: jr.session.sessionId });
    await guest.next((m) => m.type === "admitted");

    // Owner opens the Files window. The mirrored `view` MUST reach the locked guest — even though a
    // locked spectator never sends a cursor, so onAdmit is their ONLY hub-join (and mirror-set) path.
    const waiter = guest.next((m) => m.type === "view");
    main.send({ type: "view", state: { activeSpaceId: "sp_1", rooms: [], panels: [{ id: "files", rect: null }], monitor: false, localhost: false } });
    const view = await waiter;
    expect(view.state).toMatchObject({ activeSpaceId: "sp_1", panels: [{ id: "files" }] });

    main.close();
    guest.close();
  });

  it("does NOT deliver `view` to an admitted key whose link has mirror off", async () => {
    const g = await startGateway();
    app = g.app;
    const key = g.ctx.store.createAccessKey({ label: "free", mirror: false, lock: false });

    const main = await open(g.url);
    await main.next((m) => m.type === "hello" && m.role === "main");

    const guest = await open(`${g.url}?token=${encodeURIComponent(key.secret)}`, { "x-forwarded-for": "203.0.113.8" });
    await guest.next((m) => m.type === "hello");
    const jr = await main.next((m) => m.type === "joinRequest");
    main.send({ type: "admit", sessionId: jr.session.sessionId });
    await guest.next((m) => m.type === "admitted");
    // A non-mirror key must join the hub first (so it's a real peer) — send a cursor to force ensureJoined.
    guest.send({ type: "cursor", space: "sp_1", x: 1, y: 1 });
    await main.next((m) => m.type === "cursor"); // the cursor relayed → guest is now a live hub peer

    const noView = guest.none((m) => m.type === "view");
    main.send({ type: "view", state: { activeSpaceId: "sp_1", rooms: [], panels: [], monitor: false, localhost: false } });
    await noView;

    main.close();
    guest.close();
  });
});
