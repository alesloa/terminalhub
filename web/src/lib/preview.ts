// Localhost-preview URL resolution — the ONE rule that decides direct-vs-proxy, shared by the
// Localhost window's iframes and the terminal-link bridge so they always agree.
//
// Loopback access (you're on the same machine: localhost / 127.x / ::1) → the browser shares the
// host's network, so target the dev server DIRECTLY. Remote access (LAN IP, VPS IP, tunnel domain)
// → the host's localhost is unreachable from your browser, so go through terminalhub's reverse proxy.

const HOST_RE = /^127(?:\.\d{1,3}){3}$/;

/** Is the page being served from a loopback address (so the host's localhost == the viewer's)? */
export function isLoopbackHost(host: string = typeof window !== "undefined" ? window.location.hostname : ""): boolean {
  const h = host.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  return h === "localhost" || h === "::1" || h === "127.0.0.1" || HOST_RE.test(h) || h.endsWith(".localhost");
}

/** Resolve a preview target to a URL: direct on loopback, the same-origin proxy path when remote. */
export function resolvePreviewUrl(port: number, path = "/"): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return isLoopbackHost() ? `http://localhost:${port}${p}` : `/api/preview/${port}${p}`;
}

/** Make a resolved preview URL absolute, so it can be opened in a separate Chrome/Firefox tab. */
export function absolutePreviewUrl(port: number, path = "/"): string {
  const u = resolvePreviewUrl(port, path);
  return u.startsWith("/") ? `${window.location.origin}${u}` : u;
}

/** Pull {port, path} out of a host-local URL (what an agent prints), or null if it isn't one. A port
 *  is required — a bare `http://localhost` has no server to preview. */
export function parseLocalhostUrl(raw: string): { port: number; path: string } | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!(host === "localhost" || host === "::1" || host === "127.0.0.1" || HOST_RE.test(host) || host === "0.0.0.0")) return null;
  const port = Number(u.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { port, path: u.pathname + u.search + u.hash };
}
