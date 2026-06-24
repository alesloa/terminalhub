import { authorize } from "./guard.js";
import type { Store } from "../db/store.js";

// A request's identity. `main` = the owner (loopback, or an exposed request carrying the configured
// main token) — full powers including minting/revoking keys. `key` = a teammate arriving through a
// temp access link; full ROOM access, but the access-key routes gate them out of admin actions. A key
// principal also carries the link's presentation flags: `mirror` (the owner's UI nav is pushed to this
// viewer) and `lock` (a passive spectator — mouse + terminal typing disabled).
export type Principal =
  | { kind: "main" }
  | { kind: "key"; keyId: string; mirror: boolean; lock: boolean };

// A locked teammate: their terminal input + UI interaction must be dropped. The owner is never locked.
export function isLockedViewer(p: Principal): boolean {
  return p.kind === "key" && p.lock;
}

export interface AuthRequestInput {
  remoteAddr: string | undefined;
  header: string | undefined; // Authorization header, or a synthesized `Bearer <token>` from ?token=
  forwarded: boolean;
}

// Resolve the principal for a request. A presented access-key secret is checked FIRST: it's always a
// teammate credential (the owner never carries one), so it must win over the loopback-relaxed owner
// shortcut — otherwise a link visitor reaching us through a Cloudflare tunnel + Vite dev proxy (which
// makes the request look loopback, since the proxy is local and the tunnel's real-IP header doesn't
// survive the hop) would silently resolve to a SECOND owner, and mirroring / admission / input-lock
// would never engage. Only if there's no recognized key secret do we fall back to `guard.ts`'s pure
// `authorize()` (loopback relaxed, or an exposed request bearing the matching main token → owner). The
// main token is never a valid key secret, so an owner still resolves to `main` here.
export function resolvePrincipal(
  ctx: { store: Pick<Store, "getValidAccessKey" | "touchAccessKey"> },
  config: { token: string | null },
  i: AuthRequestInput,
): Principal | null {
  const secret = (i.header ?? "").replace(/^Bearer\s+/i, "").trim();
  if (secret) {
    const key = ctx.store.getValidAccessKey(secret);
    if (key) {
      ctx.store.touchAccessKey(key.id);
      return { kind: "key", keyId: key.id, mirror: key.mirror, lock: key.lock };
    }
  }
  if (authorize({ remoteAddr: i.remoteAddr, header: i.header, forwarded: i.forwarded, token: config.token })) {
    return { kind: "main" };
  }
  return null;
}
