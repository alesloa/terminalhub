// Live-awareness relay for `/ws/presence` (Subsystem B). Every admitted participant — the owner(s) on
// loopback AND admitted key teammates — is a "peer" with a stable id, display name, and colour. The hub
// just fans frames out: `broadcast` to everyone (peer roster changes), `relayFrom` to everyone-but-sender
// (cursor moves). It holds NO positions itself — cursors are ephemeral and flow straight through.

export interface AwarenessSocket {
  send(data: string): void;
}

export interface Peer {
  id: string;
  name: string;
  color: string;
}

export interface PresenceHub {
  join(socket: AwarenessSocket, name: string, mirror?: boolean): Peer; // idempotent per socket
  has(socket: AwarenessSocket): boolean;
  idOf(socket: AwarenessSocket): string | undefined;
  leave(socket: AwarenessSocket): void;
  list(): Peer[];
  broadcast(frame: unknown): void; // to ALL participants
  relayFrom(socket: AwarenessSocket, frame: unknown): void; // to all EXCEPT the sender
  relayMirror(socket: AwarenessSocket, frame: unknown): void; // to mirror-flagged viewers only (excl sender)
}

// Distinct, high-contrast cursor colours handed out in order so two people are never the same hue.
const COLORS = ["#f43f5e", "#3b82f6", "#22c55e", "#a855f7", "#f59e0b", "#06b6d4", "#ec4899", "#84cc16"];

export function createPresenceHub(opts: { nextId?: () => string } = {}): PresenceHub {
  let n = 0;
  const nextId = opts.nextId ?? (() => `pp_${(++n).toString(36)}${Math.random().toString(36).slice(2, 6)}`);
  const peers = new Map<AwarenessSocket, Peer>(); // insertion order = colour order
  const mirrors = new Set<AwarenessSocket>(); // sockets that should receive the owner's mirrored view
  let lastView: unknown | null = null; // host's last mirrored view — replayed to a mirror viewer on join
  let colorN = 0;

  const send = (s: AwarenessSocket, frame: unknown) => {
    try { s.send(JSON.stringify(frame)); } catch { /* socket already gone */ }
  };

  return {
    join(socket, name, mirror = false) {
      const existing = peers.get(socket);
      if (existing) return existing;
      const peer: Peer = { id: nextId(), name: name || "Guest", color: COLORS[colorN++ % COLORS.length] };
      peers.set(socket, peer);
      if (mirror) {
        mirrors.add(socket);
        // Late-joiner snapshot: a mirror viewer who (re)connects after the host already broadcast gets
        // the host's CURRENT view at once, instead of sitting on stale local state until the host next
        // happens to re-broadcast. This is why a guest refresh converges to what the host has open now.
        if (lastView) send(socket, lastView);
      }
      return peer;
    },
    has: (socket) => peers.has(socket),
    idOf: (socket) => peers.get(socket)?.id,
    leave: (socket) => { peers.delete(socket); mirrors.delete(socket); },
    list: () => [...peers.values()],
    broadcast(frame) { for (const s of peers.keys()) send(s, frame); },
    relayFrom(socket, frame) { for (const s of peers.keys()) if (s !== socket) send(s, frame); },
    relayMirror(socket, frame) {
      lastView = frame; // cache so a viewer who joins later still converges to the host's current view
      for (const s of mirrors) if (s !== socket) send(s, frame);
    },
  };
}
