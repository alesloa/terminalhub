import { setToken } from "../api/client";

// Consume a temp access link on boot: `?secret=<secret>&room=<ws_id>` (also accepts `?token=`).
// Stash the secret as the bearer token and remember the room to auto-open, then STRIP the params from
// the URL via history.replaceState so the secret doesn't linger in the address bar / history / a
// shared screenshot. Runs before React renders so AccessGate's first probe already carries the token.
// Returns true when a link was present (only the owner/manual visitors arrive without one).
export function consumeAccessLink(): boolean {
  try {
    const p = new URLSearchParams(location.search);
    const secret = p.get("secret") ?? p.get("token");
    const room = p.get("room");
    if (secret) {
      setToken(secret);
      // Mark this tab as "arrived via a temp link" so the AdmissionGate holds it at a waiting curtain
      // until the host accepts. Survives refresh (sessionStorage) but not a brand-new tab/visit.
      try { sessionStorage.setItem("tr.viaLink", "1"); } catch { /* private mode */ }
    }
    if (room) sessionStorage.setItem("tr.pendingRoom", room);
    if (secret || room) {
      p.delete("secret"); p.delete("token"); p.delete("room");
      const qs = p.toString();
      history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : "") + location.hash);
      return true;
    }
  } catch { /* private mode / malformed URL — ignore */ }
  return false;
}
