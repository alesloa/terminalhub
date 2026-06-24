import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useToasts } from "../../store/toasts";
import type { DriveAccountPublic } from "../../api/types";

/**
 * Settings → Connections → Google Drive. Configure the OAuth client id/secret (stored server-side in
 * the DB), then connect Google accounts. The client SECRET is write-only: the form POSTs it, but the
 * server never returns it — once saved it shows only as "•••• saved". Connecting reuses the same OAuth
 * flow the Places bar uses (GET /connect → redirect to Google).
 *
 * ONE set of credentials backs UNLIMITED connected Drives — each Google account you connect becomes its
 * own volume in the Files window. Give each a custom name; remove one with its ✕. The optional Redirect
 * URI override pins the OAuth callback when the auto-derived one doesn't match what's registered in
 * Google Cloud (e.g. on a VPS / custom domain, or 127.0.0.1 vs localhost).
 */
export function GoogleDriveSettings() {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [error, setError] = useState("");
  // null = not yet seeded from config; "" = override cleared (auto-derive). Seeded once config loads.
  const [redirect, setRedirect] = useState<string | null>(null);

  // Config: whether creds resolve, the public clientId, where they came from (settings vs env), and the
  // redirect override. The secret is never part of this — it's write-only.
  const { data: config } = useQuery({ queryKey: ["drive-config"], queryFn: api.driveGetConfig, retry: false });
  const configured = config?.configured ?? false;
  const fromEnv = config?.source === "env";

  // Seed the redirect field from the server the first time config arrives (don't clobber edits after).
  useEffect(() => { if (redirect === null && config) setRedirect(config.redirect ?? ""); }, [config, redirect]);

  // Accounts only load once configured (otherwise the route 501s); skip the query when it isn't.
  const { data: acctData } = useQuery({
    queryKey: ["drive-accounts"], queryFn: api.driveAccounts, retry: false, enabled: configured,
  });
  const accounts = acctData?.accounts ?? [];

  const saveConfig = useMutation({
    mutationFn: (b: { clientId: string; clientSecret: string }) => api.driveSetConfig(b),
    onSuccess: () => {
      setClientId(""); setClientSecret(""); setError("");
      qc.invalidateQueries({ queryKey: ["drive-config"] });
      qc.invalidateQueries({ queryKey: ["drive-accounts"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const saveRedirect = useMutation({
    mutationFn: (url: string) => api.driveSetRedirect(url),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["drive-config"] }),
    onError: (e: Error) => push(e.message),
  });

  const clearConfig = useMutation({
    mutationFn: () => api.driveClearConfig(),
    onSuccess: () => {
      setRedirect(null);
      qc.invalidateQueries({ queryKey: ["drive-config"] });
      qc.invalidateQueries({ queryKey: ["drive-accounts"] });
    },
    onError: (e: Error) => push(e.message),
  });

  // Same connect flow as the Places bar: ask the server for the consent URL, then leave for Google.
  const connect = async () => {
    try { const { url } = await api.driveConnectUrl(); window.location.href = url; }
    catch (e) { push((e as Error).message); }
  };

  const onSave = () => {
    const id = clientId.trim(), secret = clientSecret.trim();
    if (!id || !secret) { setError("Both the Client ID and Client Secret are required."); return; }
    saveConfig.mutate({ clientId: id, clientSecret: secret });
  };

  const inputCls = "w-full rounded border border-edge-strong bg-canvas px-2 py-1 text-bright outline-none focus:border-blue-500";
  const redirectDirty = redirect !== null && redirect !== (config?.redirect ?? "");

  return (
    <section className="space-y-3">
      <h2 className="text-xs uppercase tracking-wide text-dim">Google Drive</h2>
      <p className="text-xs text-dim">
        Mount your Google Drives in the Files window. Create a Google Cloud project, enable the Drive API,
        and make an OAuth client (type: Web application) with{" "}
        <code className="rounded bg-canvas px-1 py-0.5 font-mono text-[11px] text-fg">…/api/drive/callback</code>{" "}
        as an authorized redirect URI. Paste the client ID and secret below — one set of keys connects any
        number of Google accounts. The secret is stored on the server and never shown again.
      </p>

      {fromEnv && (
        <div className="rounded border border-edge bg-canvas/50 px-3 py-2 text-xs text-dim">
          Currently configured from environment variables (<code className="font-mono">GOOGLE_CLIENT_ID</code>). Saving here
          stores credentials in the database, which take precedence.
        </div>
      )}

      {/* autoComplete + data-* attrs stop Chrome/1Password/LastPass treating ID+secret as a login form
          and autofilling the user's email/password into them. */}
      <div className="space-y-1">
        <label className="block text-xs text-muted">Client ID</label>
        <input
          name="tr-drive-client-id"
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          value={clientId}
          placeholder={configured && !fromEnv ? config?.clientId ?? "" : "xxxxxxxx.apps.googleusercontent.com"}
          onChange={(e) => { setError(""); setClientId(e.target.value); }}
          className={inputCls}
        />
        {configured && !fromEnv && !clientId && (
          <div className="text-xs text-dim">Saved: <span className="text-fg">{config?.clientId}</span></div>
        )}
      </div>

      <div className="space-y-1">
        <label className="block text-xs text-muted">Client Secret</label>
        <input
          type="password"
          name="tr-drive-client-secret"
          autoComplete="new-password"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          value={clientSecret}
          placeholder={configured ? "•••• saved" : "GOCSPX-…"}
          onChange={(e) => { setError(""); setClientSecret(e.target.value); }}
          className={inputCls}
        />
      </div>

      {error && <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</div>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saveConfig.isPending || !clientId.trim() || !clientSecret.trim()}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-50">
          {saveConfig.isPending ? "Saving…" : configured && !fromEnv ? "Update credentials" : "Save credentials"}
        </button>
        {configured && !fromEnv && (
          <button
            type="button"
            onClick={() => clearConfig.mutate()}
            disabled={clearConfig.isPending}
            className="rounded bg-surface px-3 py-1.5 text-sm text-fg hover:bg-elevated disabled:opacity-50">
            Remove
          </button>
        )}
      </div>

      {configured && (
        <div className="space-y-1 border-t border-edge pt-3">
          <label className="block text-xs text-muted">Redirect URI (advanced — optional)</label>
          <div className="flex items-center gap-2">
            <input
              name="tr-drive-redirect"
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              value={redirect ?? ""}
              placeholder="auto: derived from the address you open Terminal Hub at"
              onChange={(e) => setRedirect(e.target.value)}
              className={inputCls}
            />
            <button
              type="button"
              onClick={() => saveRedirect.mutate(redirect ?? "")}
              disabled={!redirectDirty || saveRedirect.isPending}
              className="shrink-0 rounded bg-surface px-3 py-1.5 text-sm text-fg hover:bg-elevated disabled:opacity-50">
              Save
            </button>
          </div>
          <p className="text-xs text-dim">
            Leave blank to auto-detect. Set this to a callback URL registered in Google Cloud (e.g.{" "}
            <code className="font-mono text-[11px]">http://localhost:8189/api/drive/callback</code>) when the auto-detected
            one doesn’t match — on a VPS / custom domain, or to force <code className="font-mono text-[11px]">localhost</code>{" "}
            instead of <code className="font-mono text-[11px]">127.0.0.1</code>.
          </p>
        </div>
      )}

      {configured && (
        <div className="space-y-2 border-t border-edge pt-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs uppercase tracking-wide text-dim">Connected Drives</h3>
            <button
              type="button"
              onClick={connect}
              className="rounded bg-surface px-2.5 py-1 text-xs text-fg hover:bg-elevated">
              ＋ Connect Google account
            </button>
          </div>
          {accounts.length === 0 ? (
            <div className="text-xs text-dim">No accounts connected yet. Connect one to browse its Drive in the Files window.</div>
          ) : (
            <ul className="space-y-1">
              {accounts.map((a) => <AccountRow key={a.id} account={a} />)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * One connected Drive: an editable custom name (blank → falls back to the Google email), the email it's
 * tied to underneath, and an ✕ to disconnect. The name field commits on blur / Enter.
 */
function AccountRow({ account }: { account: DriveAccountPublic }) {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const [draft, setDraft] = useState(account.label ?? "");

  const rename = useMutation({
    mutationFn: (label: string) => api.driveRenameAccount(account.id, label),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["drive-accounts"] }),
    onError: (e: Error) => push(e.message),
  });
  const disconnect = useMutation({
    mutationFn: () => api.driveDisconnect(account.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["drive-accounts"] }),
    onError: (e: Error) => push(e.message),
  });

  const commit = () => { if (draft.trim() !== (account.label ?? "").trim()) rename.mutate(draft.trim()); };

  return (
    <li className="flex items-center gap-2 rounded border border-edge bg-canvas/50 px-3 py-1.5">
      <span className="shrink-0">📁</span>
      <div className="min-w-0 flex-1">
        <input
          name="tr-drive-label"
          autoComplete="off"
          value={draft}
          placeholder={account.email}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-fg outline-none hover:border-edge focus:border-blue-500"
        />
        <div className="truncate px-1 text-xs text-dim">{account.email}</div>
      </div>
      <button
        type="button"
        title="Disconnect this Drive"
        onClick={() => disconnect.mutate()}
        disabled={disconnect.isPending}
        className="shrink-0 rounded px-2 py-1 text-sm text-dim hover:bg-elevated hover:text-error disabled:opacity-50">
        ✕
      </button>
    </li>
  );
}
