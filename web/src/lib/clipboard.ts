// Robust copy: the async Clipboard API needs a secure context (https / localhost) — on a plain-http
// LAN address (http://192.168.x.x) navigator.clipboard is undefined, so every copy silently no-ops.
// Fall back to a hidden textarea + execCommand, which still works over insecure http. Focus is
// restored afterwards so terminal copy-on-select doesn't blur xterm.
export async function copyText(text: string): Promise<boolean> {
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; } } catch { /* fall through */ }
  try {
    const active = document.activeElement as HTMLElement | null;
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    active?.focus?.();
    return ok;
  } catch { return false; }
}
