import { describe, it, expect } from "vitest";
import { createPresenceHub, type AwarenessSocket } from "./hub.js";

// A socket stand-in that records every frame it was sent.
function fakeSocket() {
  const sent: any[] = [];
  const socket: AwarenessSocket = { send: (d) => sent.push(JSON.parse(d)) };
  return { socket, sent };
}

// Deterministic ids so colour/id assignment is assertable.
const ids = () => { let n = 0; return () => `p${++n}`; };

describe("presence hub (awareness participants)", () => {
  it("assigns each participant a stable id and a distinct colour", () => {
    const hub = createPresenceHub({ nextId: ids() });
    const a = hub.join(fakeSocket().socket, "Host");
    const b = hub.join(fakeSocket().socket, "Bill");
    expect(a.id).toBe("p1");
    expect(b.id).toBe("p2");
    expect(a.color).not.toBe(b.color);
    expect(a.name).toBe("Host");
    expect(b.name).toBe("Bill");
  });

  it("join is idempotent per socket", () => {
    const hub = createPresenceHub({ nextId: ids() });
    const s = fakeSocket().socket;
    const first = hub.join(s, "Host");
    const again = hub.join(s, "Host");
    expect(again).toEqual(first);
    expect(hub.list()).toHaveLength(1);
  });

  it("falls back to Guest for a blank name", () => {
    const hub = createPresenceHub({ nextId: ids() });
    expect(hub.join(fakeSocket().socket, "").name).toBe("Guest");
  });

  it("list() reflects joins and leaves; has()/idOf() track membership", () => {
    const hub = createPresenceHub({ nextId: ids() });
    const a = fakeSocket().socket, b = fakeSocket().socket;
    hub.join(a, "Host"); hub.join(b, "Bill");
    expect(hub.list().map((p) => p.name)).toEqual(["Host", "Bill"]);
    expect(hub.has(a)).toBe(true);
    expect(hub.idOf(a)).toBe("p1");
    hub.leave(a);
    expect(hub.has(a)).toBe(false);
    expect(hub.list().map((p) => p.name)).toEqual(["Bill"]);
  });

  it("broadcast() sends a frame to every participant, including the originator", () => {
    const hub = createPresenceHub({ nextId: ids() });
    const a = fakeSocket(), b = fakeSocket();
    hub.join(a.socket, "Host"); hub.join(b.socket, "Bill");
    hub.broadcast({ type: "peers", peers: hub.list() });
    expect(a.sent.at(-1)).toMatchObject({ type: "peers" });
    expect(b.sent.at(-1)).toMatchObject({ type: "peers" });
  });

  it("relayFrom() sends to all OTHER participants but never echoes to the sender", () => {
    const hub = createPresenceHub({ nextId: ids() });
    const a = fakeSocket(), b = fakeSocket(), c = fakeSocket();
    hub.join(a.socket, "Host"); hub.join(b.socket, "Bill"); hub.join(c.socket, "Cara");
    hub.relayFrom(a.socket, { type: "cursor", from: "p1", x: 10, y: 20 });
    expect(a.sent).toHaveLength(0);
    expect(b.sent.at(-1)).toMatchObject({ type: "cursor", from: "p1", x: 10, y: 20 });
    expect(c.sent.at(-1)).toMatchObject({ type: "cursor", from: "p1", x: 10, y: 20 });
  });

  it("relayMirror() reaches only mirror-flagged viewers, never the owner-sender or non-mirror peers", () => {
    const hub = createPresenceHub({ nextId: ids() });
    const owner = fakeSocket();   // the presenter (mirror off — they SEND, never receive)
    const watcher = fakeSocket(); // a mirror viewer — should receive the view
    const free = fakeSocket();    // an admitted teammate who is NOT mirrored — should not
    hub.join(owner.socket, "Host");           // mirror defaults off
    hub.join(watcher.socket, "Watcher", true); // mirror on
    hub.join(free.socket, "Free", false);      // mirror off
    hub.relayMirror(owner.socket, { type: "view", state: { activeSpaceId: "sp_1" } });
    expect(owner.sent).toHaveLength(0);
    expect(watcher.sent.at(-1)).toMatchObject({ type: "view", state: { activeSpaceId: "sp_1" } });
    expect(free.sent).toHaveLength(0);
  });

  it("relayMirror() never echoes back to a mirror viewer who somehow sends one", () => {
    const hub = createPresenceHub({ nextId: ids() });
    const watcher = fakeSocket(), other = fakeSocket();
    hub.join(watcher.socket, "Watcher", true);
    hub.join(other.socket, "Other", true);
    hub.relayMirror(watcher.socket, { type: "view", state: {} });
    expect(watcher.sent).toHaveLength(0);
    expect(other.sent.at(-1)).toMatchObject({ type: "view" });
  });

  it("replays the host's last view to a mirror viewer who joins AFTER it was sent", () => {
    // The late-joiner snapshot: a guest who refreshes (or first connects) after the host has
    // already broadcast must receive the host's current view on join, not sit stale until the
    // host next happens to re-broadcast.
    const hub = createPresenceHub({ nextId: ids() });
    const owner = fakeSocket();
    hub.join(owner.socket, "Host"); // owner present, mirror off
    hub.relayMirror(owner.socket, { type: "view", state: { activeSpaceId: "sp_live" } });

    const latecomer = fakeSocket(); // joins only now, as a mirror viewer
    hub.join(latecomer.socket, "Late", true);
    expect(latecomer.sent.at(-1)).toMatchObject({ type: "view", state: { activeSpaceId: "sp_live" } });
  });

  it("does NOT replay a cached view to a NON-mirror peer who joins later", () => {
    const hub = createPresenceHub({ nextId: ids() });
    const owner = fakeSocket();
    hub.join(owner.socket, "Host");
    hub.relayMirror(owner.socket, { type: "view", state: { activeSpaceId: "sp_live" } });

    const free = fakeSocket();
    hub.join(free.socket, "Free", false); // not mirrored → no snapshot
    expect(free.sent).toHaveLength(0);
  });
});
