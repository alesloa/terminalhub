// Thin client for a Yopass-compatible "onetime" instance. The browser no longer talks to it
// directly; the server proxies config/create/burn so the onetime host is configured in one place
// (ONETIME_BASE) and the encryption happens here via gpg, never in the web bundle.

export interface OnetimeCreateBody {
  message: string; // ASCII-armored ciphertext
  expiration: number;
  one_time: boolean;
  views?: number;
  creator_burn_only: boolean;
}

export async function onetimeConfig(base: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${base}/config`);
  if (!r.ok) throw new Error(`onetime /config HTTP ${r.status}`);
  return (await r.json()) as Record<string, unknown>;
}

export async function onetimeCreate(base: string, body: OnetimeCreateBody): Promise<{ id: string; burnToken?: string }> {
  const r = await fetch(`${base}/create/secret`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await r.json().catch(() => ({}))) as { message?: string; burn_token?: string };
  if (!r.ok) throw new Error(data.message || `onetime HTTP ${r.status}`);
  return { id: String(data.message), burnToken: data.burn_token };
}

export async function onetimeBurn(base: string, id: string, burnToken?: string): Promise<boolean> {
  const r = await fetch(`${base}/secret/${encodeURIComponent(id)}`, {
    method: "DELETE",
    ...(burnToken ? { headers: { "X-Yopass-Burn-Token": burnToken } } : {}),
  });
  return r.status === 204 || r.status === 404; // gone now, or already gone — both count as burned
}
