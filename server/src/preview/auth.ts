import { authorize } from "../auth/guard.js";

// The cookie that proves a browser already authenticated for previews. An <iframe> can't attach a
// Bearer header, and the framed app's own sub-resource + HMR-WebSocket requests won't carry a
// ?token= either — so a cookie is the only credential that rides along on every preview request.
// Minted (HttpOnly) by POST /api/preview-session after a normal Bearer-authed call. Scoped to
// /api/preview so it's sent for proxy requests only.
export const PREVIEW_COOKIE = "tr_preview";

/** Read one cookie's value out of a raw Cookie header. Returns undefined when absent. */
export function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export interface PreviewAuthInput {
  remoteAddr: string | undefined;
  authorization: string | undefined; // Authorization header
  cookie: string | undefined;        // raw Cookie header
  queryToken: string | undefined;    // ?token= on the request
  forwarded: boolean;                // tunnel/proxy headers present
  token: string | null;              // configured token
}

/**
 * Authorize a preview proxy request. Loopback stays relaxed (existing model); exposed requests must
 * present the token via — in priority order — the Authorization header, the preview cookie, or
 * ?token=. Delegates the loopback/exposed/token decision to the shared `authorize`.
 */
export function previewAuthorized(i: PreviewAuthInput): boolean {
  const bearer = i.authorization?.replace(/^Bearer\s+/i, "").trim();
  const provided = bearer || readCookie(i.cookie, PREVIEW_COOKIE) || i.queryToken;
  return authorize({
    remoteAddr: i.remoteAddr,
    header: provided ? `Bearer ${provided}` : undefined,
    forwarded: i.forwarded,
    token: i.token,
  });
}
