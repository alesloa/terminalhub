// The HLS proxy's manifest rewriter. Most IPTV streams (a) lack CORS headers and (b) require a
// specific Referer/User-Agent — a browser can set neither, so playback dies. The server fetches
// upstream with the right headers and re-serves with CORS; for .m3u8 manifests every child URI
// (variant playlists, segments, encryption keys, init maps) is rewritten to route back through
// /api/tv/proxy too, carrying the same referrer/user-agent. hls.js then just follows them.

/** Build a /api/tv/proxy URL for an absolute upstream URL, threading optional ref/ua headers. */
export function proxyUrl(absUrl: string, ref?: string | null, ua?: string | null): string {
  let out = "/api/tv/proxy?url=" + encodeURIComponent(absUrl);
  if (ref) out += "&ref=" + encodeURIComponent(ref);
  if (ua) out += "&ua=" + encodeURIComponent(ua);
  return out;
}

/**
 * Rewrite an .m3u8 manifest so every child URI points back at the proxy. `baseUrl` is the manifest's
 * own (final, post-redirect) URL, used to resolve relative URIs to absolute. Comment/tag lines pass
 * through untouched except for the `URI="…"` attribute inside EXT-X-KEY / EXT-X-MEDIA / EXT-X-MAP.
 */
export function rewriteManifest(text: string, baseUrl: string, ref?: string | null, ua?: string | null): string {
  const wrap = (raw: string) => proxyUrl(new URL(raw, baseUrl).toString(), ref, ua);
  return text
    .split(/\r?\n/)
    .map((line) => {
      const l = line.trim();
      if (l === "") return line;
      if (l.startsWith("#")) {
        // Only tags that embed a resource reference (key/media/map) get their URI rewritten.
        return line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${wrap(uri)}"`);
      }
      return wrap(l);
    })
    .join("\n");
}
