// Guard for the /api/tv/proxy fetch target: only absolute http(s) URLs may be fetched on the user's
// behalf. Rejects file:/ftp:/data: (local-resource exfil), relative paths, and anything unparseable.
export function isProxyableUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
