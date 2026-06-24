import { describe, it, expect, beforeEach } from "vitest";
import { createSessionsController, type SessionsController } from "./sessions.js";

// A stand-in for a ws WebSocket: records frames sent and whether it was closed.
function fakeSocket() {
  return {
    sent: [] as any[],
    closed: false as boolean,
    send(d: string) { this.sent.push(JSON.parse(d)); },
    close(_code?: number, _reason?: string) { this.closed = true; },
  };
}

let ctl: SessionsController;
beforeEach(() => { ctl = createSessionsController(); });

describe("sessions: open → pending join", () => {
  it("creates a pending session, fires onJoinRequest, and lists it", () => {
    const seen: any[] = [];
    ctl.onJoinRequest((s) => seen.push(s));
    const sock = fakeSocket();
    const s = ctl.open("ak_1", "Bob", sock as any);
    expect(s.sessionId).toMatch(/^ses_/);
    expect(s.keyId).toBe("ak_1");
    expect(s.name).toBe("Bob");
    expect(s.status).toBe("pending");
    expect(seen).toEqual([s]);
    expect(ctl.list()).toContainEqual(s);
  });

  it("falls back to 'Guest' when the label is empty", () => {
    const s = ctl.open("ak_1", "", fakeSocket() as any);
    expect(s.name).toBe("Guest");
  });
});

describe("sessions: admit / decline", () => {
  it("admit flips status and sends {type:'admitted'} to the teammate", () => {
    const sock = fakeSocket();
    const s = ctl.open("ak_1", "Bob", sock as any);
    ctl.admit(s.sessionId);
    expect(ctl.list().find((x) => x.sessionId === s.sessionId)?.status).toBe("admitted");
    expect(sock.sent).toContainEqual({ type: "admitted" });
  });

  it("admit fires onAdmit with the session (so the gateway can join them to the hub now)", () => {
    const admitted: any[] = [];
    ctl.onAdmit((s) => admitted.push(s));
    const s = ctl.open("ak_1", "Bob", fakeSocket() as any);
    expect(admitted).toHaveLength(0); // not yet — still pending
    ctl.admit(s.sessionId);
    expect(admitted).toHaveLength(1);
    expect(admitted[0].sessionId).toBe(s.sessionId);
    expect(admitted[0].status).toBe("admitted");
  });

  it("admit on an unknown session fires neither onChange nor onAdmit", () => {
    let changes = 0; const admitted: any[] = [];
    ctl.onChange(() => { changes++; });
    ctl.onAdmit((s) => admitted.push(s));
    ctl.admit("ses_nope");
    expect(changes).toBe(0);
    expect(admitted).toHaveLength(0);
  });

  it("decline notifies, closes the socket, and drops the session", () => {
    const sock = fakeSocket();
    const s = ctl.open("ak_1", "Bob", sock as any);
    ctl.decline(s.sessionId);
    expect(sock.sent).toContainEqual({ type: "declined" });
    expect(sock.closed).toBe(true);
    expect(ctl.list()).toHaveLength(0);
  });
});

describe("sessions: kick / kill", () => {
  it("kick closes every socket for that session's key and drops the session", () => {
    const term = fakeSocket();
    ctl.attach("ak_1", term as any);
    const presence = fakeSocket();
    const s = ctl.open("ak_1", "Bob", presence as any); // open auto-registers the presence socket
    ctl.kick(s.sessionId);
    expect(term.closed).toBe(true);
    expect(presence.closed).toBe(true);
    expect(ctl.list()).toHaveLength(0);
  });

  it("killKey closes ALL sockets for the key and drops its sessions", () => {
    const a = fakeSocket(); const b = fakeSocket();
    ctl.attach("ak_1", a as any);
    ctl.attach("ak_1", b as any);
    const s = ctl.open("ak_1", "Bob", fakeSocket() as any);
    ctl.killKey("ak_1");
    expect(a.closed).toBe(true);
    expect(b.closed).toBe(true);
    expect(ctl.list().find((x) => x.sessionId === s.sessionId)).toBeUndefined();
  });

  it("killKey only touches the target key's sockets", () => {
    const a = fakeSocket(); const b = fakeSocket();
    ctl.attach("ak_A", a as any);
    ctl.attach("ak_B", b as any);
    ctl.killKey("ak_A");
    expect(a.closed).toBe(true);
    expect(b.closed).toBe(false);
  });

  it("a detached socket is no longer closed by killKey", () => {
    const a = fakeSocket();
    ctl.attach("ak_1", a as any);
    ctl.detach("ak_1", a as any);
    ctl.killKey("ak_1");
    expect(a.closed).toBe(false);
  });
});

describe("sessions: drop + onChange", () => {
  it("drop removes a session without closing or framing its socket", () => {
    const sock = fakeSocket();
    const s = ctl.open("ak_1", "Bob", sock as any);
    ctl.drop(s.sessionId);
    expect(ctl.list()).toHaveLength(0);
    expect(sock.closed).toBe(false);
    expect(sock.sent).toHaveLength(0);
  });

  it("onChange fires on every roster mutation (open, admit, kick)", () => {
    let n = 0;
    ctl.onChange(() => { n++; });
    const s = ctl.open("ak_1", "Bob", fakeSocket() as any); // +1
    ctl.admit(s.sessionId);                                  // +1
    ctl.kick(s.sessionId);                                   // +1
    expect(n).toBe(3);
  });
});

describe("sessions: remembers admitted keys (no re-prompt on reconnect)", () => {
  it("re-opens an already-admitted key straight to admitted, raising no new join request", () => {
    const seen: any[] = [];
    ctl.onJoinRequest((s) => seen.push(s));
    const first = ctl.open("ak_1", "Bob", fakeSocket() as any);
    expect(seen).toHaveLength(1);          // first arrival prompts the admin
    ctl.admit(first.sessionId);
    ctl.drop(first.sessionId);             // their socket closed (refresh / network blip)
    const again = ctl.open("ak_1", "Bob", fakeSocket() as any);
    expect(again.status).toBe("admitted"); // reconnect is admitted automatically
    expect(seen).toHaveLength(1);          // and does NOT re-prompt the admin
  });

  it("forgets the key on kick, so a later reconnect is pending again", () => {
    const first = ctl.open("ak_1", "Bob", fakeSocket() as any);
    ctl.admit(first.sessionId);
    ctl.kick(first.sessionId);
    const again = ctl.open("ak_1", "Bob", fakeSocket() as any);
    expect(again.status).toBe("pending");
  });
});
