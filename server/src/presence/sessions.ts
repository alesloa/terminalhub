// In-memory registry of live teammate connections and their admission state. Ephemeral ONLY (like
// tmux bell flags — never SQLite): it tracks which sockets belong to which access key so the admin
// can disconnect them, and holds the pending/admitted state for the admission flow. A server restart
// clears it; teammates re-arrive through their link and re-raise a pending join.

// The slice of a ws WebSocket this controller needs. Real `@fastify/websocket` sockets satisfy it.
export interface PresenceSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface PresenceSession {
  sessionId: string;          // ses_* — one per /ws/presence connection
  keyId: string;              // the access key this teammate arrived on
  name: string;               // key label (falls back to "Guest")
  status: "pending" | "admitted";
  // Subsystem B extends this with: activeSpaceId, openRooms, cursor, selection, color…
}

export interface SessionsController {
  attach(keyId: string, socket: PresenceSocket): void;            // register any gateway socket (for kill)
  detach(keyId: string, socket: PresenceSocket): void;
  open(keyId: string, name: string, presenceSocket: PresenceSocket): PresenceSession; // a presence join → pending
  admit(sessionId: string): void;                                 // → admitted; tell the teammate
  decline(sessionId: string): void;                               // notify + close + drop the session
  kick(sessionId: string): void;                                  // disconnect that teammate now (key stays valid)
  killKey(keyId: string): void;                                   // close ALL sockets for a key, drop its sessions
  drop(sessionId: string): void;                                  // teammate's socket closed — forget the session (no frame)
  list(): PresenceSession[];                                      // roster for the admin
  onJoinRequest(cb: (s: PresenceSession) => void): void;          // fired when a teammate raises a pending join
  onChange(cb: () => void): void;                                 // fired after any roster mutation (push roster to admins)
  onAdmit(cb: (s: PresenceSession) => void): void;                // fired when a session is admitted (join them to the hub now)
}

let seq = 0;
function sid(): string {
  return "ses_" + (++seq).toString(36) + Math.random().toString(36).slice(2, 6);
}

function sendJson(socket: PresenceSocket | undefined, obj: unknown): void {
  if (!socket) return;
  try { socket.send(JSON.stringify(obj)); } catch { /* socket already gone */ }
}

export function createSessionsController(): SessionsController {
  const socketsByKey = new Map<string, Set<PresenceSocket>>();     // keyId → every live socket, for kill
  const sessions = new Map<string, PresenceSession>();             // sessionId → session
  const presenceSocketBySession = new Map<string, PresenceSocket>(); // sessionId → its presence socket
  const admittedKeys = new Set<string>();                            // keys already let in — reconnects skip the prompt
  const joinCbs: Array<(s: PresenceSession) => void> = [];
  const changeCbs: Array<() => void> = [];
  const admitCbs: Array<(s: PresenceSession) => void> = [];

  function emitChange(): void {
    for (const cb of changeCbs) { try { cb(); } catch { /* listener threw; ignore */ } }
  }

  function attach(keyId: string, socket: PresenceSocket): void {
    let set = socketsByKey.get(keyId);
    if (!set) { set = new Set(); socketsByKey.set(keyId, set); }
    set.add(socket);
  }
  function detach(keyId: string, socket: PresenceSocket): void {
    const set = socketsByKey.get(keyId);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) socketsByKey.delete(keyId);
  }

  // Tell every session on this key it's over, then close all of the key's sockets and forget them.
  // Shared by kick (per session → resolve its key) and killKey (the whole key).
  function teardownKey(keyId: string, frame: { type: string }): void {
    for (const [sessionId, sess] of sessions) {
      if (sess.keyId !== keyId) continue;
      sendJson(presenceSocketBySession.get(sessionId), frame);
      presenceSocketBySession.delete(sessionId);
      sessions.delete(sessionId);
    }
    const set = socketsByKey.get(keyId);
    if (set) {
      for (const sock of set) { try { sock.close(1000, frame.type); } catch { /* already closed */ } }
      socketsByKey.delete(keyId);
    }
    admittedKeys.delete(keyId); // a kicked/killed key must re-request admission on its next visit
    emitChange();
  }

  return {
    attach,
    detach,
    open(keyId, name, presenceSocket) {
      // A key already admitted this server-run skips the prompt and reconnects straight to admitted —
      // so a teammate's refresh/blip doesn't re-spam the host. Cleared on kick/revoke/restart.
      const status: PresenceSession["status"] = admittedKeys.has(keyId) ? "admitted" : "pending";
      const session: PresenceSession = { sessionId: sid(), keyId, name: name || "Guest", status };
      sessions.set(session.sessionId, session);
      presenceSocketBySession.set(session.sessionId, presenceSocket);
      attach(keyId, presenceSocket); // so kill/killKey closes the presence socket too
      if (status === "pending") {
        for (const cb of joinCbs) { try { cb(session); } catch { /* listener threw; ignore */ } }
      }
      emitChange();
      return session;
    },
    admit(sessionId) {
      const s = sessions.get(sessionId);
      if (!s) return;
      s.status = "admitted";
      admittedKeys.add(s.keyId);
      sendJson(presenceSocketBySession.get(sessionId), { type: "admitted" });
      emitChange();
      // After the roster push: let the gateway join this teammate to the awareness hub right now, so a
      // mirror viewer who never moves their mouse (e.g. a locked spectator) still becomes a mirror peer
      // and receives the owner's `view` frames. Without this they'd only join on their first cursor/cards.
      for (const cb of admitCbs) { try { cb(s); } catch { /* listener threw; ignore */ } }
    },
    decline(sessionId) {
      const s = sessions.get(sessionId);
      if (!s) return;
      const sock = presenceSocketBySession.get(sessionId);
      sendJson(sock, { type: "declined" });
      detach(s.keyId, sock!);
      admittedKeys.delete(s.keyId);
      presenceSocketBySession.delete(sessionId);
      sessions.delete(sessionId);
      try { sock?.close(1000, "declined"); } catch { /* already closed */ }
      emitChange();
    },
    kick(sessionId) {
      const s = sessions.get(sessionId);
      if (!s) return;
      teardownKey(s.keyId, { type: "kicked" });
    },
    killKey(keyId) {
      teardownKey(keyId, { type: "kicked" });
    },
    drop(sessionId) {
      const s = sessions.get(sessionId);
      if (!s) return;
      const sock = presenceSocketBySession.get(sessionId);
      if (sock) detach(s.keyId, sock);
      presenceSocketBySession.delete(sessionId);
      sessions.delete(sessionId);
      emitChange();
    },
    list() {
      return [...sessions.values()];
    },
    onJoinRequest(cb) {
      joinCbs.push(cb);
    },
    onChange(cb) {
      changeCbs.push(cb);
    },
    onAdmit(cb) {
      admitCbs.push(cb);
    },
  };
}
