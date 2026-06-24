// Where shareable links point. Defaults to the address you're currently on — which is already the
// public one when you reach Terminal Hub through your tunnel. Only when you're on localhost / your LAN
// do you need to paste your public (tunnel) URL so a teammate across the world can actually reach it.
const SHARE_BASE_KEY = "tr.shareBaseUrl";

export function loadShareBase(): string {
  try {
    const saved = localStorage.getItem(SHARE_BASE_KEY);
    if (saved && saved.trim()) return saved.trim();
  } catch { /* private mode */ }
  return location.origin;
}

export function saveShareBase(base: string): void {
  try { localStorage.setItem(SHARE_BASE_KEY, base.trim().replace(/\/+$/, "")); } catch { /* private mode */ }
}

// True when an origin is only reachable from this machine or the local network — so a generated link
// would NOT work for someone off your network. Drives the "paste your public URL" warning.
export function isLocalOrigin(origin: string): boolean {
  try {
    const h = new URL(origin).hostname;
    if (h === "localhost" || h.endsWith(".local") || h === "::1" || h === "0.0.0.0") return true;
    if (/^127\./.test(h)) return true;          // loopback
    if (/^10\./.test(h)) return true;           // private class A
    if (/^192\.168\./.test(h)) return true;     // private class C
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true; // private class B
    return false;
  } catch { return false; }
}

// Build the shareable URL: `<base>/?room=<ws>&secret=<secret>` (room omitted = land on the canvas).
export function buildAccessLink(base: string, secret: string, workspaceId: string | null): string {
  const b = base.trim().replace(/\/+$/, "");
  const p = new URLSearchParams();
  if (workspaceId) p.set("room", workspaceId);
  p.set("secret", secret);
  return `${b}/?${p.toString()}`;
}
