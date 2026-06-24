import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createNotifyBus, type Notification } from "../notify/bus.js";
import { createPendingNotifier } from "../notify/pending.js";
import { createStore } from "../db/store.js";
import { notifyRoutes } from "./notify.js";

function build() {
  const notify = createNotifyBus();
  const received: Notification[] = [];
  // The route fires a *pending* "notification" frame (its fields sit at the top level).
  notify.subscribe((f) => { if (f.type === "notification") received.push(f); });
  const store = createStore(":memory:");
  const pending = createPendingNotifier({ store, notify });
  const ctx = { notify, store, pending } as any;
  const app = Fastify();
  app.register(async (a) => notifyRoutes(a, ctx));
  return { app, received, pending };
}

describe("notify route", () => {
  let h: ReturnType<typeof build>;
  beforeEach(() => { h = build(); });
  afterEach(() => { h.pending.stop(); }); // cancel the grace-window timers

  it("publishes a notification and returns ok + id", async () => {
    const res = await h.app.inject({ method: "POST", url: "/api/notify", payload: { text: "Build finished" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().id).toMatch(/^pn_/); // a pending toast id (it persists only if you ignore it)
    expect(h.received).toHaveLength(1);
    expect(h.received[0].text).toBe("Build finished");
  });

  it("defaults level to info and speak to true", async () => {
    await h.app.inject({ method: "POST", url: "/api/notify", payload: { text: "hi" } });
    expect(h.received[0].level).toBe("info");
    expect(h.received[0].speak).toBe(true);
  });

  it("derives workspaceId + terminalId from a tmux session name", async () => {
    await h.app.inject({ method: "POST", url: "/api/notify", payload: { text: "done", session: "tr_ws_abc_tm_xyz" } });
    expect(h.received[0].workspaceId).toBe("ws_abc");
    expect(h.received[0].terminalId).toBe("tm_xyz");
  });

  it("carries the chosen voice and level through", async () => {
    await h.app.inject({ method: "POST", url: "/api/notify", payload: { text: "uh oh", level: "error", voice: "Daniel", speak: false } });
    expect(h.received[0]).toMatchObject({ level: "error", voice: "Daniel", speak: false });
  });

  it("ignores a non-Terminal Hub session name (no target, still delivers)", async () => {
    await h.app.inject({ method: "POST", url: "/api/notify", payload: { text: "hi", session: "some-other-shell" } });
    expect(h.received[0].workspaceId).toBeUndefined();
    expect(h.received[0].terminalId).toBeUndefined();
  });

  it("rejects an empty message", async () => {
    const res = await h.app.inject({ method: "POST", url: "/api/notify", payload: { text: "" } });
    expect(res.statusCode).toBe(400);
    expect(h.received).toHaveLength(0);
  });
});
