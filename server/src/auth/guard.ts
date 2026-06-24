export function isLoopback(addr: string | undefined): boolean {
  if (!addr) return false;
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1" || addr.startsWith("127.");
}

/** Derive the `forwarded` flag from raw request headers.
 *  Returns true only when the real originating client is non-loopback:
 *  - Cloudflare tunnel sets CF-Connecting-IP (always a real remote IP)
 *  - A proxy (including Vite's dev proxy with xfwd:true) sets x-forwarded-for,
 *    but we treat it as loopback when the forwarded IP itself is loopback —
 *    so `localhost → Vite → server` is still treated as a local request. */
export function isForwardedRequest(headers: Record<string, string | string[] | undefined>): boolean {
  if (headers["cf-connecting-ip"]) return true;
  const xff = headers["x-forwarded-for"];
  const raw = Array.isArray(xff) ? xff[0] : xff;
  if (!raw) return false;
  return !isLoopback(raw.split(",")[0]?.trim());
}

export interface AuthInput {
  remoteAddr: string | undefined;
  header: string | undefined;   // Authorization header
  forwarded: boolean;           // true if tunnel/proxy headers present (CF-Connecting-IP etc.)
  token: string | null;         // configured token
}

/** A request is "exposed" if it came through a tunnel/proxy or from a non-loopback address. */
export function authorize(i: AuthInput): boolean {
  const exposed = i.forwarded || !isLoopback(i.remoteAddr);
  if (!exposed) return true; // loopback = relaxed
  if (!i.token) return false; // exposed requires a configured token
  const provided = i.header?.replace(/^Bearer\s+/i, "").trim();
  return provided === i.token;
}
