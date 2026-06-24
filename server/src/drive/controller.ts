import { toEntry, listQuery, exportMimeFor, mimeForName, LIST_FIELDS, FOLDER_MIME, type DriveRoot } from "./map.js";
import { createOAuth, type OAuth } from "./oauth.js";
import type { Store } from "../db/store.js";
import type { GoogleConfig } from "../config.js";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

type StoreDeps = Pick<Store, "getDriveAccount" | "updateDriveTokens" | "getDriveCredentials" | "getDriveRedirect">;

// All Drive HTTP lives here; token refresh is transparent. Refresh tokens stay server-side — the
// browser only ever sees mapped entries / bytes via the routes.
//
// Creds are resolved at REQUEST time, not boot: settings (DB) first, env fallback, else null — so a
// secret saved through Settings turns the feature on without a restart. `config()` is the single
// source of truth the routes gate on; the HTTP methods below build a per-call OAuth from it.
// `makeOAuth` is injectable so the HTTP tests can drive token refresh without real Google calls.
export function createDriveController(deps: { store: StoreDeps; envGoogle: GoogleConfig | null; makeOAuth?: (g: GoogleConfig) => OAuth }) {
  const { store, envGoogle } = deps;
  const makeOAuth = deps.makeOAuth ?? createOAuth;

  // settings creds → env creds → null. `redirect` is the override: settings (Settings UI) → env →
  // null (then oauth.ts derives it from the request origin). Optional-chained so controller unit
  // tests with a minimal store mock (no getDriveRedirect) still resolve.
  const config = (): GoogleConfig | null => {
    const redirect = store.getDriveRedirect?.() ?? envGoogle?.redirect ?? null;
    const fromSettings = store.getDriveCredentials();
    if (fromSettings) return { clientId: fromSettings.clientId, clientSecret: fromSettings.clientSecret, redirect };
    return envGoogle ? { ...envGoogle, redirect } : null;
  };

  const oauthOrThrow = (): OAuth => {
    const g = config();
    if (!g) throw new Error("drive not configured");
    return makeOAuth(g);
  };

  // A valid access token for the account: reuse the stored one until it's within 60s of expiry,
  // otherwise refresh it from the stored refresh token and persist the new token + expiry.
  async function token(accountId: string): Promise<string> {
    const acc = store.getDriveAccount(accountId);
    if (!acc) throw new Error("account not found");
    if (acc.accessToken && acc.expiry && acc.expiry > Date.now() + 60_000) return acc.accessToken;
    const fresh = await oauthOrThrow().refresh(acc.refreshToken);
    store.updateDriveTokens(accountId, fresh);
    return fresh.accessToken;
  }

  async function api(accountId: string, path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${await token(accountId)}`, ...(init.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`drive ${res.status}: ${await res.text().catch(() => "")}`);
    return res;
  }

  return {
    // Resolved client creds (settings → env → null). Routes gate on this; secret never returned to HTTP.
    config,
    async listFolder(accountId: string, opts: { root?: DriveRoot; folderId?: string }) {
      const { q, corpora } = listQuery(opts);
      const params = new URLSearchParams({
        q, corpora, fields: LIST_FIELDS, pageSize: "1000",
        includeItemsFromAllDrives: "true", supportsAllDrives: "true",
        orderBy: "folder,name",
      });
      const data = await (await api(accountId, `/files?${params}`)).json() as { files: any[] };
      return (data.files ?? []).map(toEntry);
    },

    // Bytes for QuickLook: native docs export to PDF, everything else downloads raw.
    async getBytes(accountId: string, fileId: string): Promise<{ buffer: Buffer; mimeType: string }> {
      const metaParams = new URLSearchParams({ fields: "mimeType,name", supportsAllDrives: "true" });
      const meta = await (await api(accountId, `/files/${fileId}?${metaParams}`)).json() as { mimeType: string };
      const native = meta.mimeType.startsWith("application/vnd.google-apps.") && meta.mimeType !== FOLDER_MIME;
      const path = native
        ? `/files/${fileId}/export?mimeType=${encodeURIComponent(exportMimeFor(meta.mimeType))}`
        : `/files/${fileId}?alt=media&supportsAllDrives=true`;
      const res = await api(accountId, path);
      return { buffer: Buffer.from(await res.arrayBuffer()), mimeType: native ? exportMimeFor(meta.mimeType) : meta.mimeType };
    },

    // Create a folder under `parentId`.
    async mkdir(accountId: string, parentId: string, name: string): Promise<{ id: string }> {
      const res = await api(accountId, `/files?supportsAllDrives=true&fields=id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
      });
      return { id: (await res.json() as { id: string }).id };
    },

    // Rename a file/folder.
    async rename(accountId: string, id: string, name: string): Promise<{ id: string }> {
      const res = await api(accountId, `/files/${id}?supportsAllDrives=true&fields=id`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      return { id: (await res.json() as { id: string }).id };
    },

    // Move a file/folder between parents (add and/or remove parent ids).
    async move(accountId: string, id: string, addParents?: string, removeParents?: string): Promise<{ id: string }> {
      const params = new URLSearchParams({ supportsAllDrives: "true", fields: "id" });
      if (addParents) params.set("addParents", addParents);
      if (removeParents) params.set("removeParents", removeParents);
      const res = await api(accountId, `/files/${id}?${params}`, { method: "PATCH" });
      return { id: (await res.json() as { id: string }).id };
    },

    // Delete = move to Trash (recoverable), not a permanent delete, so a mis-click can be undone.
    async remove(accountId: string, id: string): Promise<{ id: string }> {
      const res = await api(accountId, `/files/${id}?supportsAllDrives=true&fields=id`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trashed: true }),
      });
      return { id: (await res.json() as { id: string }).id };
    },

    // Upload raw bytes as a new file under `parentId` via a multipart (metadata + media) request.
    async upload(accountId: string, parentId: string, name: string, bytes: Buffer, mimeType?: string): Promise<{ id: string }> {
      const type = mimeType || mimeForName(name);
      const boundary = `tr-${Math.random().toString(36).slice(2)}`;
      const meta = JSON.stringify({ name, parents: [parentId] });
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Type: ${type}\r\n\r\n`),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const res = await fetch(`${UPLOAD_API}/files?uploadType=multipart&supportsAllDrives=true&fields=id`, {
        method: "POST",
        headers: { Authorization: `Bearer ${await token(accountId)}`, "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      });
      if (!res.ok) throw new Error(`drive ${res.status}: ${await res.text().catch(() => "")}`);
      return { id: (await res.json() as { id: string }).id };
    },

    // Overwrite an EXISTING file's bytes (Drive media update) — the file id, name and parents stay
    // put; only the content changes. Backs Save in the File Browser's editor. Default media type is
    // text/plain (the editor only writes text); a media-only update never relabels the file's own
    // mimeType, so saving a .py keeps it a .py.
    async updateContent(accountId: string, id: string, bytes: Buffer, mimeType = "text/plain"): Promise<{ id: string }> {
      const res = await fetch(`${UPLOAD_API}/files/${id}?uploadType=media&supportsAllDrives=true&fields=id`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${await token(accountId)}`, "Content-Type": mimeType },
        body: bytes as Uint8Array<ArrayBuffer>,
      });
      if (!res.ok) throw new Error(`drive ${res.status}: ${await res.text().catch(() => "")}`);
      return { id: (await res.json() as { id: string }).id };
    },
  };
}
export type DriveController = ReturnType<typeof createDriveController>;
