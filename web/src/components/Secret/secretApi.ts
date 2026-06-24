// The "burnable secret link" feature. Encryption no longer happens in the browser: the plaintext
// and a freshly-generated key are sent to the Terminal Hub server, which symmetric-encrypts with
// the host's gpg (spawned, arms-length — so no crypto library ships in this bundle) and forwards
// only the ciphertext to the configured onetime/Yopass instance. The onetime host is set
// server-side via ONETIME_BASE; when it is unset the feature reports itself disabled.

// 22-char URL-safe key, drawn from a crypto-strong RNG with rejection sampling to avoid modulo bias.
const KEY_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function randomIndex(max: number): number {
  const byte = new Uint8Array(1);
  const limit = Math.floor(256 / max) * max;
  do {
    crypto.getRandomValues(byte);
  } while (byte[0] >= limit);
  return byte[0] % max;
}
export function randomKey(): string {
  let out = "";
  for (let i = 0; i < 22; i++) out += KEY_ALPHABET[randomIndex(KEY_ALPHABET.length)];
  return out;
}

// Instance config (subset). Optional fields are present only when the server enables that feature,
// so the form gates the matching control on them rather than guessing a bound.
export interface OnetimeConfig {
  enabled: boolean; // false when ONETIME_BASE isn't set — the feature is unavailable
  DEFAULT_EXPIRY: number; // which expiry preset starts selected
  FORCE_ONETIME_SECRETS: boolean; // server forces one-time regardless of the view control
  MAX_VIEWS?: number; // present & > 1 → view-limit control is offered, capped here
  MIN_EXPIRATION?: number; // present with MAX_EXPIRATION → custom expiry is offered
  MAX_EXPIRATION?: number;
  PUBLIC_URL?: string; // share-link base, supplied by the server
}

/** Ask the server for the onetime instance config (and whether the feature is configured at all).
 *  On failure or when unconfigured, degrade to a disabled, presets-only config. */
export async function fetchOnetimeConfig(): Promise<OnetimeConfig> {
  const fallback: OnetimeConfig = { enabled: false, DEFAULT_EXPIRY: 3600, FORCE_ONETIME_SECRETS: false };
  let body: { enabled?: boolean; base?: string; config?: Record<string, unknown> } = {};
  try {
    const r = await fetch("/api/secret/config");
    if (r.ok) body = await r.json();
  } catch {
    return fallback; // server unreachable
  }
  if (!body.enabled) return fallback;
  const d = body.config ?? {};
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  return {
    enabled: true,
    DEFAULT_EXPIRY: num(d.DEFAULT_EXPIRY) ?? 3600,
    FORCE_ONETIME_SECRETS: d.FORCE_ONETIME_SECRETS === true,
    MAX_VIEWS: num(d.MAX_VIEWS),
    MIN_EXPIRATION: num(d.MIN_EXPIRATION),
    MAX_EXPIRATION: num(d.MAX_EXPIRATION),
    PUBLIC_URL: body.base,
  };
}

export interface CreateBody {
  message: string; // plaintext — the server encrypts it before anything leaves the host
  key: string; // symmetric key the server encrypts under (and which rides in the share fragment)
  expiration: number;
  one_time: boolean;
  views?: number;
  creator_burn_only: boolean;
}

export interface CreateResult {
  id: string;
  // Returned only for creator_burn_only links — the only way to burn the link later, so it is
  // kept in this browser and never put in the share URL.
  burnToken?: string;
}

/** Send the plaintext + key to the server, which encrypts and stores it. Throws with the server's
 *  message on a non-2xx response. */
export async function postSecret(body: CreateBody): Promise<CreateResult> {
  const r = await fetch("/api/secret", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await r.json().catch(() => ({}))) as { id?: string; burnToken?: string; error?: string };
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return { id: String(data.id), burnToken: data.burnToken };
}

/** Share URL. The one-click form embeds the key in the fragment (the onetime host never sees it);
 *  when the user supplied their own key we omit it so the key can be shared out-of-band. */
export function shareUrl(base: string | undefined, id: string, key?: string): string {
  const b = (base || "").replace(/\/$/, "");
  return key ? `${b}/#/s/${id}/${key}` : `${b}/#/s/${id}`;
}

/** Destroy ("burn") a link early via the server proxy. For creator-only links send the burn token;
 *  anyone-burn links need none. 204 = gone now, 404 = already gone — both count as destroyed. */
export async function burnSecret(id: string, burnToken?: string): Promise<boolean> {
  const r = await fetch(`/api/secret/${encodeURIComponent(id)}`, {
    method: "DELETE",
    ...(burnToken ? { headers: { "X-Yopass-Burn-Token": burnToken } } : {}),
  });
  return r.status === 204 || r.status === 404;
}
