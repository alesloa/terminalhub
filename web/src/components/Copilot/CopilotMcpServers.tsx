import { useState } from "react";
import { useMcpServers, useImportableMcp, useCreateMcp, usePatchMcp, useRefreshMcp, useDeleteMcp } from "../../hooks/useCopilot";
import type { CopilotMcpServer, CopilotMcpImportable, CopilotMcpTransport } from "../../api/types";

// MCP tool servers section (lives at the bottom of the Skills tab). MCP servers give the Copilot extra
// tools — search, browsers, APIs, your own servers. Each connected server's tools are run without
// confirmation (the user opted them in here), so they can also be used in scheduled loops. Secrets in
// `env` are write-only: we send values to the server but only ever get the key names back.
const field = "w-full px-2.5 py-1.5 bg-panel border border-edge rounded-lg text-sm outline-none focus:border-blue-500/60";

// One env var the user is editing. Imported servers seed the keys (values blank — secrets aren't returned).
interface EnvRow { key: string; value: string }

// A draft server in the add form. `id` (set when editing an existing server) switches save to PATCH.
interface Draft {
  id?: string;
  label: string;
  transport: CopilotMcpTransport;
  command: string;      // space-separated; split on save
  url: string;
  env: EnvRow[];
}

const emptyDraft: Draft = { label: "", transport: "stdio", command: "", url: "", env: [] };

export function CopilotMcpServers() {
  const servers = useMcpServers();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [importing, setImporting] = useState(false);

  return (
    <div className="rounded-xl border border-edge bg-panel p-3.5">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 shrink-0 rounded-lg bg-blue-600/15 text-blue-400 flex items-center justify-center text-lg">🔌</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold text-sm text-bright">Tool servers (MCP)</div>
            <span className="text-[10px] uppercase tracking-wide text-dim border border-edge rounded px-1.5 py-0.5">Always on</span>
          </div>
          <div className="text-xs text-muted mt-1 leading-5">Connect MCP servers to give the Assistant extra tools — search, browsers, APIs, or your own servers. Each one you add and enable runs without asking.</div>

          <div className="mt-3 border-t border-edge pt-3 space-y-2">
            {servers.isLoading && <div className="text-xs text-dim">loading…</div>}
            {servers.data?.length === 0 && !draft && !importing && <div className="text-xs text-dim">No tool servers yet — import the ones you already use, or add one by hand.</div>}
            {servers.data?.map((s) => <ServerRow key={s.id} server={s} onEdit={() => setDraft(toDraft(s))} />)}

            {importing && <ImportList onPick={(d) => { setImporting(false); setDraft(d); }} onClose={() => setImporting(false)} />}
            {draft && <ServerForm draft={draft} onChange={setDraft} onDone={() => setDraft(null)} />}

            {!draft && !importing && (
              <div className="flex gap-2 pt-0.5">
                <button onClick={() => setDraft({ ...emptyDraft })} className="text-xs px-2.5 py-1.5 rounded-lg border border-edge bg-panel hover:bg-elevated hover:text-bright transition-colors">+ Add a server</button>
                <button onClick={() => setImporting(true)} className="text-xs px-2.5 py-1.5 rounded-lg border border-edge bg-panel hover:bg-elevated hover:text-bright transition-colors">↓ Import</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ServerRow({ server, onEdit }: { server: CopilotMcpServer; onEdit: () => void }) {
  const patch = usePatchMcp();
  const refresh = useRefreshMcp();
  const del = useDeleteMcp();
  const busy = patch.isPending || refresh.isPending || del.isPending;
  return (
    <div className="bg-elevated/40 border border-edge rounded-lg px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex items-center gap-2">
          <StatusDot status={server.status} />
          <div className="min-w-0">
            <div className="truncate text-sm text-bright">{server.label}</div>
            <div className="text-[11px] text-dim truncate">
              {server.transport === "stdio" ? (server.command.join(" ") || "—") : (server.url || "—")}
              {" · "}{server.tools.length} tool{server.tools.length === 1 ? "" : "s"}
              {server.envKeys.length > 0 ? ` · 🔑 ${server.envKeys.length}` : ""}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => refresh.mutate(server.id)} disabled={busy} title="Reconnect & refresh tools" className="text-dim hover:text-bright px-1 disabled:opacity-40">⟳</button>
          <button onClick={onEdit} title="Edit" className="text-dim hover:text-bright px-1">✎</button>
          <button onClick={() => del.mutate(server.id)} disabled={busy} title="Remove" className="text-dim hover:text-red-400 px-1 disabled:opacity-40">✕</button>
          <Toggle on={server.enabled} busy={patch.isPending} onChange={(on) => patch.mutate({ id: server.id, patch: { enabled: on } })} />
        </div>
      </div>
      {server.status === "error" && server.lastError && <div className="text-[11px] text-red-300 mt-1 leading-4 break-words">{server.lastError}</div>}
      {server.tools.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {server.tools.slice(0, 12).map((t) => <span key={t.name} title={t.description} className="text-[10px] px-1.5 py-0.5 rounded bg-panel border border-edge text-muted">{t.name}</span>)}
          {server.tools.length > 12 && <span className="text-[10px] text-dim px-1">+{server.tools.length - 12} more</span>}
        </div>
      )}
    </div>
  );
}

function ImportList({ onPick, onClose }: { onPick: (d: Draft) => void; onClose: () => void }) {
  const importable = useImportableMcp(true);
  return (
    <div className="space-y-2 bg-panel/60 border border-edge rounded-lg p-2.5">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wide text-dim">From your ~/.claude.json</div>
        <button onClick={onClose} className="text-dim hover:text-bright px-1 text-xs">✕</button>
      </div>
      {importable.isLoading && <div className="text-xs text-dim">loading…</div>}
      {importable.data?.length === 0 && <div className="text-xs text-dim">No global MCP servers found. Add one by hand instead.</div>}
      {importable.data?.map((s) => (
        <button key={s.name} onClick={() => onPick(fromImport(s))} className="w-full text-left bg-elevated/40 hover:bg-elevated border border-edge rounded-lg px-2.5 py-1.5">
          <div className="text-sm text-bright truncate">{s.name}</div>
          <div className="text-[11px] text-dim truncate">{s.transport === "stdio" ? s.command.join(" ") : s.url}{s.envKeys.length > 0 ? ` · 🔑 ${s.envKeys.join(", ")}` : ""}</div>
        </button>
      ))}
    </div>
  );
}

function ServerForm({ draft, onChange, onDone }: { draft: Draft; onChange: (d: Draft) => void; onDone: () => void }) {
  const create = useCreateMcp();
  const patch = usePatchMcp();
  const editing = !!draft.id;
  const busy = create.isPending || patch.isPending;
  const err = (create.error as Error | null)?.message ?? (patch.error as Error | null)?.message;

  const command = draft.command.trim().split(/\s+/).filter(Boolean);
  const canSave = draft.label.trim() && (draft.transport === "stdio" ? command.length > 0 : !!draft.url.trim());

  const save = () => {
    if (!canSave) return;
    const env = Object.fromEntries(draft.env.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value]));
    if (editing) {
      patch.mutate({ id: draft.id!, patch: { label: draft.label.trim(), command, url: draft.url.trim() || null, env } }, { onSuccess: onDone });
    } else {
      create.mutate({ label: draft.label.trim(), transport: draft.transport, command, url: draft.url.trim() || null, env }, { onSuccess: onDone });
    }
  };

  const setEnv = (i: number, patch: Partial<EnvRow>) => onChange({ ...draft, env: draft.env.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  return (
    <div className="space-y-2 bg-panel/60 border border-edge rounded-lg p-2.5">
      <input value={draft.label} onChange={(e) => onChange({ ...draft, label: e.target.value })} placeholder="Label (e.g. Brave Search)" className={field} />
      {!editing && (
        <div className="flex gap-2">
          {(["stdio", "http"] as const).map((t) => (
            <button key={t} onClick={() => onChange({ ...draft, transport: t })}
              className={`flex-1 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${draft.transport === t ? "border-blue-500/60 bg-blue-600/15 text-blue-300" : "border-edge bg-panel text-muted hover:text-bright"}`}>
              {t === "stdio" ? "Local command (stdio)" : "Remote URL (http)"}
            </button>
          ))}
        </div>
      )}
      {draft.transport === "stdio"
        ? <input value={draft.command} onChange={(e) => onChange({ ...draft, command: e.target.value })} placeholder="Command (e.g. npx -y @modelcontextprotocol/server-brave-search)" autoComplete="off" className={`${field} font-mono text-[12px]`} />
        : <input value={draft.url} onChange={(e) => onChange({ ...draft, url: e.target.value })} placeholder="https://server.example.com/mcp" autoComplete="off" className={`${field} font-mono text-[12px]`} />}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-wide text-dim">Environment {draft.transport === "http" ? "(headers/secrets)" : "(secrets)"}</div>
          <button onClick={() => onChange({ ...draft, env: [...draft.env, { key: "", value: "" }] })} className="text-[11px] text-blue-400 hover:text-blue-300">+ add</button>
        </div>
        {draft.env.map((row, i) => (
          <div key={i} className="flex gap-2">
            <input value={row.key} onChange={(e) => setEnv(i, { key: e.target.value })} placeholder="KEY" autoComplete="off" className={`${field} w-2/5 font-mono text-[12px]`} />
            <input value={row.value} onChange={(e) => setEnv(i, { value: e.target.value })} type="password" placeholder="value" autoComplete="new-password" className={`${field} flex-1`} />
            <button onClick={() => onChange({ ...draft, env: draft.env.filter((_, j) => j !== i) })} title="Remove" className="text-dim hover:text-red-400 px-1">✕</button>
          </div>
        ))}
        {editing && draft.env.some((r) => r.key && !r.value) && <div className="text-[10px] text-dim leading-4">Secrets are never shown — leave a value blank to keep the saved one, or type to replace it.</div>}
      </div>

      {err && <div className="text-[11px] text-red-300">{err}</div>}
      <div className="flex justify-end gap-2 pt-0.5">
        <button onClick={onDone} className="text-xs px-2.5 py-1 rounded bg-elevated hover:bg-edge">Cancel</button>
        <button onClick={save} disabled={!canSave || busy} className="text-xs px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white">{busy ? "Connecting…" : editing ? "Save" : "Add & connect"}</button>
      </div>
    </div>
  );
}

function toDraft(s: CopilotMcpServer): Draft {
  return { id: s.id, label: s.label, transport: s.transport, command: s.command.join(" "), url: s.url ?? "", env: s.envKeys.map((key) => ({ key, value: "" })) };
}
function fromImport(s: CopilotMcpImportable): Draft {
  return { label: s.name, transport: s.transport, command: s.command.join(" "), url: s.url ?? "", env: s.envKeys.map((key) => ({ key, value: "" })) };
}

function StatusDot({ status }: { status: CopilotMcpServer["status"] }) {
  const color = status === "ok" ? "bg-green-400" : status === "error" ? "bg-red-400" : "bg-dim";
  const title = status === "ok" ? "Connected" : status === "error" ? "Connection failed" : "Not connected yet";
  return <span title={title} className={`w-2 h-2 rounded-full shrink-0 ${color}`} />;
}

function Toggle({ on, busy, onChange }: { on: boolean; busy: boolean; onChange: (on: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} disabled={busy} role="switch" aria-checked={on} title={on ? "Disable" : "Enable"}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${on ? "bg-blue-600" : "bg-elevated"} ${busy ? "opacity-50" : ""}`}>
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}
