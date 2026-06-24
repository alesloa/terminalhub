import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { getToken } from "../api/client";
import { usePresence } from "../store/presence";
import type { Workspace } from "../api/types";

// Apply a peer's workspace-card moves to the local query cache so the cards jump/track to the new spots
// immediately (shared canvas state, both ways). The mover also persists to the DB, so a later refetch
// reconciles to the same values — this just removes the round-trip lag on the watcher's screen.
function patchCardPositions(qc: QueryClient, cards: { id: string; x: number; y: number }[]): void {
  const moved = new Map(cards.map((c) => [c.id, c]));
  qc.setQueryData<{ workspaces: Workspace[] }>(["workspaces"], (old) => {
    if (!old) return old;
    let changed = false;
    const workspaces = old.workspaces.map((w) => {
      const c = moved.get(w.id);
      if (c && (w.x !== c.x || w.y !== c.y)) { changed = true; return { ...w, x: c.x, y: c.y }; }
      return w;
    });
    return changed ? { ...old, workspaces } : old;
  });
}

/**
 * The single `/ws/presence` connection (mounted once, at the AdmissionGate). It drives the admission
 * curtain for a teammate and feeds the owner's join prompts + live roster:
 *   • hello → role; admitted/declined/kicked → this browser's admission state
 *   • joinRequest → a pending teammate to Accept/Decline (owner)
 *   • roster → refresh the manager's key/roster query, and prune stale prompts
 * Reconnects with linear backoff while still in play; a terminal `declined`/`kicked` stops retrying
 * (the teammate must use the link again to retry) so a kicked guest can't auto-rejoin and re-spam.
 */
export function usePresenceSocket(): void {
  const qc = useQueryClient();
  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let attempt = 0;

    const stop = () => { closed = true; if (retry) clearTimeout(retry); try { ws?.close(); } catch { /* already closed */ } };

    const connect = () => {
      if (closed) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const tok = getToken();
      ws = new WebSocket(`${proto}://${location.host}/ws/presence${tok ? `?token=${encodeURIComponent(tok)}` : ""}`);
      ws.onopen = () => {
        attempt = 0;
        // Expose a cursor sender for the canvas. The closure reads the live `ws` (reassigned on
        // reconnect), so it always targets the current socket; frames are dropped while not OPEN.
        usePresence.getState().setSendCursor((c) => {
          if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "cursor", ...c }));
        });
        // Owner-side: broadcast my view to mirror viewers (the server relays only to mirror-flagged keys).
        usePresence.getState().setSendView((state) => {
          if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "view", state }));
        });
        // Shared canvas: broadcast a card move to every participant (the server relays it to all peers).
        usePresence.getState().setSendCards((cards) => {
          if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "cards", cards }));
        });
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          const p = usePresence.getState();
          switch (msg.type) {
            case "hello": p.setHello(msg.role, { mirror: msg.mirror, lock: msg.lock }); break;
            case "welcome": if (msg.self?.id) p.setSelf(msg.self.id); break;
            case "peers": if (Array.isArray(msg.peers)) p.setPeers(msg.peers); break;
            case "cursor": if (typeof msg.from === "string") p.setCursor(msg.from, { space: msg.space ?? null, x: msg.x, y: msg.y }); break;
            case "cards": if (Array.isArray(msg.cards)) patchCardPositions(qc, msg.cards); break;
            case "view": if (msg.state && typeof msg.state === "object") p.setViewState(msg.state); break;
            case "admitted": p.setAdmission("admitted"); break;
            case "declined": p.setAdmission("declined"); stop(); break;
            case "kicked": p.setAdmission("kicked"); stop(); break;
            case "joinRequest": if (msg.session) p.addJoinRequest(msg.session); break;
            case "roster": {
              qc.invalidateQueries({ queryKey: ["accessKeys"] });
              const pending = new Set<string>((msg.sessions ?? []).filter((s: any) => s.status === "pending").map((s: any) => s.sessionId));
              p.keepJoinRequests(pending);
              break;
            }
          }
        } catch { /* ignore malformed frame */ }
      };
      ws.onclose = () => {
        if (closed) return;
        attempt++;
        retry = setTimeout(connect, Math.min(1000 * attempt, 5000)); // linear backoff, capped at 5s
      };
    };
    connect();

    return () => { closed = true; if (retry) clearTimeout(retry); ws?.close(); usePresence.getState().reset(); };
  }, [qc]);
}
