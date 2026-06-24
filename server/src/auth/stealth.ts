// "Stealth" curtain for exposed deployments. When TERMINALHUB_REVEAL is set (e.g. "sonos=1169"),
// a remote visitor who hits the app without that query param gets a blank page — no UI, no
// assets, no hint anything is here. The param only lifts the curtain; the token is still the
// real lock (see auth/guard.ts). Loopback and unconfigured stealth always serve the real page.

/** Parse "name=value" reveal config into its parts; null/empty/malformed → null. */
export function parseReveal(reveal: string | null | undefined): { name: string; value: string } | null {
  if (!reveal) return null;
  const i = reveal.indexOf("=");
  if (i <= 0) return null; // need a non-empty name before the first "="
  return { name: reveal.slice(0, i), value: reveal.slice(i + 1) };
}

/** True when the reveal flag is configured and present (with the right value) in the query string. */
export function revealPresent(reveal: string | null | undefined, queryString: string): boolean {
  const r = parseReveal(reveal);
  if (!r) return false;
  return new URLSearchParams(queryString).get(r.name) === r.value;
}

/** True for SPA navigations (extensionless paths); false for built assets and API/WS routes. */
export function isDocumentPath(path: string): boolean {
  if (path.startsWith("/api") || path.startsWith("/ws")) return false;
  const last = path.split("/").pop() ?? "";
  return !last.includes(".");
}

/**
 * Decide whether an HTML document request should be served blank (curtain down). Blank only when
 * stealth is configured, the request is exposed (remote/proxied), and the reveal flag is absent.
 */
export function shouldServeBlank(opts: { reveal: string | null; exposed: boolean; queryString: string }): boolean {
  if (!opts.reveal) return false; // feature off
  if (!opts.exposed) return false; // loopback sees everything
  return !revealPresent(opts.reveal, opts.queryString);
}
