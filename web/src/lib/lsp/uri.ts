// file:// URI ⇄ absolute path. macOS/Linux only (Terminal Hub's targets) — no Windows drive handling.

/** Absolute POSIX path → `file://` URI. encodeURI keeps `/` and `:`, escapes spaces etc. */
export function pathToFileUri(path: string): string {
  return "file://" + encodeURI(path).replace(/[?#]/g, (c) => encodeURIComponent(c));
}

/** `file://[host]/path` → decoded absolute path. Tolerates a missing leading slash / authority. */
export function fileUriToPath(uri: string): string {
  let p = uri;
  if (p.startsWith("file://")) p = p.slice("file://".length);
  // file:///path → empty authority, p starts with "/". A rare file://host/path → drop the host.
  if (!p.startsWith("/")) { const slash = p.indexOf("/"); p = slash >= 0 ? p.slice(slash) : "/" + p; }
  try { return decodeURIComponent(p); } catch { return p; }
}

/** Last path segment (the tab title), e.g. "/a/b/index.d.ts" → "index.d.ts". */
export function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || trimmed;
}

/** True when `path` lives outside the workspace `root` (a library / node_modules file). Drives the
 *  read-only flag so go-to-def into a dependency can't be edited. */
export function isExternalTo(path: string, root: string): boolean {
  const r = root.replace(/\/+$/, "");
  return !(path === r || path.startsWith(r + "/"));
}
