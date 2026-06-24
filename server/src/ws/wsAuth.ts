import type { FastifyRequest } from "fastify";
import type { AppContext } from "../context.js";
import type { Config } from "../config.js";
import { isForwardedRequest } from "../auth/guard.js";
import { resolvePrincipal, type Principal } from "../auth/access.js";

// The slice of a ws WebSocket a gateway upgrade hands us. The real `@fastify/websocket` socket
// satisfies it (and is assignable to PresenceSocket for the kill registry).
interface WsLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: string, listener: (...args: any[]) => void): unknown;
}

// Shared WS-upgrade auth for every gateway. Mirrors the REST preHandler: loopback/main-token → owner,
// a valid access-key secret (Authorization header or ?token=) → key principal. On a key principal we
// register the socket with ctx.sessions so the admin's kill closes it; on close we detach it.
// Returns the Principal, or null after closing the socket 1008 when unauthorized.
export function authorizeWs(
  ctx: AppContext,
  config: Config,
  socket: WsLike,
  req: FastifyRequest,
  queryToken: string | null,
): Principal | null {
  const principal = resolvePrincipal(ctx, config, {
    remoteAddr: req.ip,
    header: req.headers["authorization"] ?? (queryToken ? `Bearer ${queryToken}` : undefined),
    forwarded: isForwardedRequest(req.headers as Record<string, string | string[] | undefined>),
  });
  if (!principal) { socket.close(1008, "unauthorized"); return null; }
  if (principal.kind === "key") {
    const keyId = principal.keyId;
    ctx.sessions.attach(keyId, socket);
    socket.on("close", () => ctx.sessions.detach(keyId, socket));
  }
  return principal;
}
