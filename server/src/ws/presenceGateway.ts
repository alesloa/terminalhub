import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { authorizeWs } from "./wsAuth.js";
import type { Config } from "../config.js";
import { createPresenceHub, type AwarenessSocket } from "../presence/hub.js";

// The slice of a ws WebSocket this gateway holds onto for admin broadcasts.
interface AdminSocket {
  readyState: number;
  OPEN: number;
  send(data: string): void;
  on(event: string, listener: (...args: any[]) => void): unknown;
}

// `/ws/presence` — the multiplayer foundation. Two roles, by principal:
//   • main (owner) → an ADMIN socket. Gets the roster + a `joinRequest` whenever a teammate arrives,
//     and may send `admit` / `decline` / `kick`.
//   • key (teammate) → arrives PENDING. We register the session (raising a join request to admins)
//     and hold; the admin's admit/decline (or a kill) pushes the matching frame and/or closes it.
// Subsystem B (live awareness) rides the SAME socket: every admitted participant — both loopback owners
// AND admitted teammates — is a hub "peer" with an id/name/colour, and `cursor` frames are relayed to
// the others so each browser can draw the others' live cursors. Two browsers on localhost are both
// `main`, so cursor sharing works owner-to-owner with no link involved.
export async function presenceGateway(app: FastifyInstance, ctx: AppContext, config: Config) {
  const admins = new Set<AdminSocket>();
  const hub = createPresenceHub();

  function broadcast(obj: unknown): void {
    const frame = JSON.stringify(obj);
    for (const a of admins) {
      if (a.readyState !== a.OPEN) continue;
      try { a.send(frame); } catch { /* dropped frame */ }
    }
  }
  // Fan a cursor frame out to the OTHER participants in canvas-space coords. Numbers only — drop junk.
  function relayCursor(from: AwarenessSocket, id: string, msg: any): void {
    if (typeof msg.x !== "number" || typeof msg.y !== "number") return;
    hub.relayFrom(from, {
      type: "cursor",
      from: id,
      space: typeof msg.space === "string" ? msg.space : null,
      x: msg.x,
      y: msg.y,
    });
  }
  // Fan a workspace-card move out to EVERY other participant (incl. the owner) — card positions are
  // shared canvas state that tracks BOTH ways, so an unlocked teammate moving a card reaches the host
  // too. Sanitize to {id,x,y}; drop anything malformed.
  function relayCards(from: AwarenessSocket, msg: any): void {
    if (!Array.isArray(msg.cards)) return;
    const cards = msg.cards
      .filter((c: any) => c && typeof c.id === "string" && typeof c.x === "number" && typeof c.y === "number")
      .map((c: any) => ({ id: c.id, x: c.x, y: c.y }));
    if (cards.length === 0) return;
    hub.relayFrom(from, { type: "cards", cards });
  }
  // A just-admitted teammate must join the awareness hub immediately — not lazily on their first cursor.
  // A locked/mirror spectator never sends a cursor, so without this they'd be admitted yet never a hub
  // (mirror) peer, and the owner's `view` frames would never reach them. The key handler registers its
  // socket's join fn here under its sessionId; admit looks it up and runs it.
  const joinOnAdmit = new Map<string, () => void>(); // sessionId → join-this-socket-to-the-hub
  ctx.sessions.onAdmit((session) => { joinOnAdmit.get(session.sessionId)?.(); });
  // A teammate raised a pending join → prompt every admin (center-screen Accept/Decline).
  ctx.sessions.onJoinRequest((session) => broadcast({ type: "joinRequest", session }));
  // Any roster mutation (join, admit, decline, kick, kill, disconnect) → push the fresh roster.
  ctx.sessions.onChange(() => broadcast({ type: "roster", sessions: ctx.sessions.list() }));

  app.get("/ws/presence", { websocket: true }, (socket, req) => {
    const url = new URL(req.url, "http://localhost");
    const principal = authorizeWs(ctx, config, socket, req, url.searchParams.get("token"));
    if (!principal) return;
    const aw = socket as unknown as AwarenessSocket;

    if (principal.kind === "main") {
      const admin = socket as unknown as AdminSocket;
      admins.add(admin);
      const me = hub.join(aw, "Host"); // an owner is admitted at once → joins the awareness layer now
      try {
        socket.send(JSON.stringify({ type: "hello", role: "main" }));
        socket.send(JSON.stringify({ type: "welcome", self: me }));
        socket.send(JSON.stringify({ type: "roster", sessions: ctx.sessions.list() }));
      } catch { /* socket already gone */ }
      hub.broadcast({ type: "peers", peers: hub.list() }); // tell everyone (incl. me) the fresh roster
      socket.on("message", (raw: Buffer) => {
        let msg: any;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (msg.type === "admit" && typeof msg.sessionId === "string") {
          ctx.sessions.admit(msg.sessionId);
        } else if (msg.type === "decline" && typeof msg.sessionId === "string") {
          const sess = ctx.sessions.list().find((s) => s.sessionId === msg.sessionId);
          ctx.sessions.decline(msg.sessionId);
          if (sess) { ctx.store.revokeAccessKey(sess.keyId); ctx.sessions.killKey(sess.keyId); }
        } else if (msg.type === "kick" && typeof msg.sessionId === "string") {
          ctx.sessions.kick(msg.sessionId);
        } else if (msg.type === "cursor") {
          relayCursor(aw, me.id, msg);
        } else if (msg.type === "cards") {
          relayCards(aw, msg);
        } else if (msg.type === "view" && msg.state && typeof msg.state === "object") {
          // Presentation mirroring: the owner's UI nav (active space, open rooms, fullscreen, open
          // panels) is fanned out to the mirror-flagged viewers only. The owner is the source of truth;
          // viewers just apply it. Opaque `state` — the web owns its shape.
          hub.relayMirror(aw, { type: "view", state: msg.state });
        }
      });
      socket.on("close", () => {
        admins.delete(admin);
        hub.leave(aw);
        hub.broadcast({ type: "peers", peers: hub.list() });
      });
      return;
    }

    // key principal — a teammate. authorizeWs already attached the socket for kill; open the session
    // (PENDING) so admins are prompted, and forget it when their socket closes.
    const label = ctx.store.listAccessKeys().find((k) => k.id === principal.keyId)?.label ?? "";
    const session = ctx.sessions.open(principal.keyId, label, socket);

    // A teammate joins the awareness layer only once ADMITTED. ensureJoined() lazily adds them — at open
    // if they reconnect already-admitted, otherwise on their first cursor after the host accepts — then
    // announces the refreshed peer roster so everyone (including them) gets names + colours.
    const ensureJoined = (): string | null => {
      const sess = ctx.sessions.list().find((s) => s.sessionId === session.sessionId);
      if (!sess || sess.status !== "admitted") return null;
      if (!hub.has(aw)) {
        // A mirror-flagged viewer joins the awareness layer as a mirror peer, so the owner's `view`
        // frames reach them (hub.relayMirror filters on this).
        const p = hub.join(aw, label || "Guest", principal.mirror);
        try { socket.send(JSON.stringify({ type: "welcome", self: p })); } catch { /* gone */ }
        hub.broadcast({ type: "peers", peers: hub.list() });
      }
      return hub.idOf(aw) ?? null;
    };
    // Let admit() join this socket to the hub the instant the host accepts (see joinOnAdmit above).
    joinOnAdmit.set(session.sessionId, ensureJoined);

    try {
      // Tell the viewer's client whether this link mirrors the owner's view and/or locks their input,
      // so it can follow the owner's nav and/or drop into passive-spectator mode.
      socket.send(JSON.stringify({ type: "hello", role: "key", mirror: principal.mirror, lock: principal.lock }));
      // A reconnecting, already-admitted key comes back admitted with no fresh prompt — tell it so its
      // "waiting for host" curtain lifts immediately instead of hanging until a (never-coming) admit.
      if (session.status === "admitted") socket.send(JSON.stringify({ type: "admitted" }));
    } catch { /* gone */ }
    if (session.status === "admitted") ensureJoined();

    socket.on("message", (raw: Buffer) => {
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === "cursor") {
        const id = ensureJoined();
        if (id) relayCursor(aw, id, msg);
      } else if (msg.type === "cards" && !principal.lock) {
        // A locked viewer is a passive spectator — never let them mutate the shared canvas (defense in
        // depth; the client's ViewerLock already blocks the drag). An unlocked teammate's moves relay.
        if (ensureJoined()) relayCards(aw, msg);
      }
    });
    socket.on("close", () => {
      joinOnAdmit.delete(session.sessionId);
      ctx.sessions.drop(session.sessionId);
      hub.leave(aw);
      hub.broadcast({ type: "peers", peers: hub.list() });
    });
  });
}
