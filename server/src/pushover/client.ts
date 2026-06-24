import type { Store } from "../db/store.js";

// Pushover client. POSTs to the public Pushover API (https://pushover.net/api). Token + user key are
// read from settings on every call, so updating them in Settings takes effect without a restart.
// Everything is best-effort: a send NEVER throws — a down/erroring Pushover must not break a
// scheduler tick — it returns { ok:false, errors } instead. Quota headers are captured for the
// notification center's monthly-usage readout. Keys are secrets and live server-side only.

const BASE = "https://api.pushover.net/1";

export interface PushoverQuota { limit: number; remaining: number; reset: number }

export interface PushoverSendOpts {
  message: string;
  title?: string;
  priority?: number;        // -2..2; 2 (emergency) requires retry+expire (defaulted below)
  retry?: number;           // seconds between emergency re-alerts (min 30)
  expire?: number;          // seconds to keep retrying an emergency (max 10800)
  imageBase64?: string;     // attachment image, base64 (no data: prefix)
  imageType?: string;       // attachment MIME, e.g. "image/png"
}

export interface PushoverSendResult {
  ok: boolean;
  errors: string[];
  quota: PushoverQuota | null;
  request?: string;
  receipt?: string;         // present for emergency (priority 2) sends
}

export interface PushoverController {
  isConfigured(): boolean;
  send(opts: PushoverSendOpts): Promise<PushoverSendResult>;
  validate(): Promise<{ ok: boolean; errors: string[] }>;
  quota(): Promise<PushoverQuota | null>;
}

function readQuota(headers: { get(name: string): string | null }): PushoverQuota | null {
  const limit = headers.get("X-Limit-App-Limit");
  const remaining = headers.get("X-Limit-App-Remaining");
  const reset = headers.get("X-Limit-App-Reset");
  if (limit == null || remaining == null || reset == null) return null;
  return { limit: Number(limit), remaining: Number(remaining), reset: Number(reset) };
}

function errorsOf(body: any, status: number): string[] {
  if (Array.isArray(body?.errors) && body.errors.length) return body.errors.map(String);
  return [`Pushover request failed (HTTP ${status})`];
}

export function createPushoverController(store: Store): PushoverController {
  const creds = () => {
    const s = store.getSettings();
    return { token: s.pushoverToken, user: s.pushoverUser };
  };

  return {
    isConfigured() {
      const { token, user } = creds();
      return Boolean(token && user);
    },

    async send(opts) {
      const { token, user } = creds();
      if (!token || !user) return { ok: false, errors: ["Pushover is not configured"], quota: null };

      const params = new URLSearchParams();
      params.set("token", token);
      params.set("user", user);
      params.set("message", opts.message);
      if (opts.title) params.set("title", opts.title);
      if (opts.priority != null) {
        params.set("priority", String(opts.priority));
        if (opts.priority === 2) {
          // Emergency priority must carry retry + expire. Clamp to Pushover's documented bounds.
          params.set("retry", String(Math.max(30, opts.retry ?? 60)));
          params.set("expire", String(Math.min(10800, opts.expire ?? 3600)));
        }
      }
      if (opts.imageBase64) {
        params.set("attachment_base64", opts.imageBase64);
        params.set("attachment_type", opts.imageType || "image/png");
      }

      try {
        const r = await fetch(`${BASE}/messages.json`, { method: "POST", body: params });
        const quota = readQuota(r.headers);
        const body: any = await r.json().catch(() => ({}));
        if (r.ok && body?.status === 1) {
          return { ok: true, errors: [], quota, request: body.request, receipt: body.receipt };
        }
        return { ok: false, errors: errorsOf(body, r.status), quota };
      } catch (e) {
        return { ok: false, errors: [(e as Error).message], quota: null };
      }
    },

    async validate() {
      const { token, user } = creds();
      if (!token || !user) return { ok: false, errors: ["Pushover is not configured"] };
      const params = new URLSearchParams({ token, user });
      try {
        const r = await fetch(`${BASE}/users/validate.json`, { method: "POST", body: params });
        const body: any = await r.json().catch(() => ({}));
        if (r.ok && body?.status === 1) return { ok: true, errors: [] };
        return { ok: false, errors: errorsOf(body, r.status) };
      } catch (e) {
        return { ok: false, errors: [(e as Error).message] };
      }
    },

    async quota() {
      const { token } = creds();
      if (!token) return null;
      try {
        const r = await fetch(`${BASE}/apps/limits.json?token=${encodeURIComponent(token)}`, { method: "GET" });
        const body: any = await r.json().catch(() => ({}));
        if (r.ok && typeof body?.limit === "number") {
          return { limit: body.limit, remaining: body.remaining, reset: body.reset };
        }
        return null;
      } catch {
        return null;
      }
    },
  };
}
