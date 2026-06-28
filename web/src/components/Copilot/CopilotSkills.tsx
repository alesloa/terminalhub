import { useState } from "react";
import { useCopilotSkills, usePatchSkill, useSkillAccounts, useCreateAccount, useDeleteAccount } from "../../hooks/useCopilot";
import type { CopilotSkillCard } from "../../api/types";
import { CopilotMcpServers } from "./CopilotMcpServers";

// Provider presets for the email skill — the named ones only need an address + app-password; "imap"
// also asks for a host. Mirrors the server's PROVIDER_HOSTS + EmailProvider enum.
const EMAIL_PROVIDERS = [
  { id: "gmail", label: "Gmail", needsHost: false },
  { id: "icloud", label: "iCloud / Apple Mail", needsHost: false },
  { id: "outlook", label: "Outlook / Hotmail", needsHost: false },
  { id: "yahoo", label: "Yahoo", needsHost: false },
  { id: "imap", label: "Other (IMAP)", needsHost: true },
];

// The Skills tab — makes the copilot's assignable capabilities visible and toggleable. Each skill is
// a card with its description, example phrasings (so you know what to ask), and an on/off switch
// (the built-in core skill is always on). Account-managing skills (email) surface their accounts here.
export function CopilotSkills() {
  const skills = useCopilotSkills();

  return (
    <div className="h-full overflow-y-auto px-4 py-4 space-y-3">
      <div className="text-xs text-dim px-1">Skills give your Assistant new abilities. Turn one on, then just ask.</div>
      {skills.isLoading && <div className="text-sm text-dim px-1">loading…</div>}
      {skills.data?.filter((s) => s.id !== "mcp").map((s) => <SkillCard key={s.id} skill={s} />)}
      <CopilotMcpServers />
    </div>
  );
}

function SkillCard({ skill }: { skill: CopilotSkillCard }) {
  const patch = usePatchSkill();
  return (
    <div className="rounded-xl border border-edge bg-panel p-3.5">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 shrink-0 rounded-lg bg-blue-600/15 text-blue-400 flex items-center justify-center text-lg">{skill.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold text-sm text-bright">{skill.name}</div>
            {skill.builtin
              ? <span className="text-[10px] uppercase tracking-wide text-dim border border-edge rounded px-1.5 py-0.5">Always on</span>
              : <Toggle on={skill.enabled} busy={patch.isPending} onChange={(on) => patch.mutate({ id: skill.id, patch: { enabled: on } })} />}
          </div>
          <div className="text-xs text-muted mt-1 leading-5">{skill.description}</div>
          {skill.examples.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {skill.examples.map((ex) => <span key={ex} className="text-[11px] px-2 py-0.5 rounded-full bg-elevated/60 border border-edge text-muted">“{ex}”</span>)}
            </div>
          )}
          {skill.accountsProvider && skill.enabled && <AccountsSection skillId={skill.id} />}
        </div>
      </div>
    </div>
  );
}

function AccountsSection({ skillId }: { skillId: string }) {
  const accounts = useSkillAccounts(skillId, true);
  const del = useDeleteAccount(skillId);
  const [adding, setAdding] = useState(false);
  return (
    <div className="mt-3 border-t border-edge pt-3 space-y-2">
      <div className="text-[11px] uppercase tracking-wide text-dim">Connected mailboxes</div>
      {accounts.data?.length === 0 && !adding && <div className="text-xs text-dim">None yet — add one to let me check your email.</div>}
      {accounts.data?.map((a) => (
        <div key={a.id} className="flex items-center justify-between gap-2 text-sm bg-elevated/40 border border-edge rounded-lg px-2.5 py-1.5">
          <div className="min-w-0">
            <div className="truncate text-bright">{a.label}</div>
            <div className="text-[11px] text-dim">{providerLabel(a.provider)}{typeof a.config.user === "string" ? ` · ${a.config.user}` : ""}{a.hasSecret ? " · 🔑 saved" : ""}</div>
          </div>
          <button onClick={() => del.mutate(a.id)} title="Remove" className="shrink-0 text-dim hover:text-red-400 px-1">✕</button>
        </div>
      ))}
      {adding
        ? <AddAccountForm skillId={skillId} onDone={() => setAdding(false)} />
        : <button onClick={() => setAdding(true)} className="text-xs px-2.5 py-1.5 rounded-lg border border-edge bg-panel hover:bg-elevated hover:text-bright transition-colors">+ Add a mailbox</button>}
    </div>
  );
}

function AddAccountForm({ skillId, onDone }: { skillId: string; onDone: () => void }) {
  const create = useCreateAccount(skillId);
  const [provider, setProvider] = useState("gmail");
  const [label, setLabel] = useState("");
  const [user, setUser] = useState("");
  const [secret, setSecret] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("993");
  const preset = EMAIL_PROVIDERS.find((p) => p.id === provider)!;
  const canSave = label.trim() && user.trim() && secret.trim() && (!preset.needsHost || host.trim());

  const save = () => {
    if (!canSave) return;
    const config: Record<string, unknown> = { user: user.trim() };
    if (preset.needsHost) { config.host = host.trim(); config.port = Number(port) || 993; }
    create.mutate({ label: label.trim(), provider, config, secret: secret.trim() }, { onSuccess: onDone });
  };

  const field = "w-full px-2.5 py-1.5 bg-panel border border-edge rounded-lg text-sm outline-none focus:border-blue-500/60";
  return (
    <div className="space-y-2 bg-panel/60 border border-edge rounded-lg p-2.5">
      <select value={provider} onChange={(e) => setProvider(e.target.value)} className={field}>
        {EMAIL_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Personal)" className={field} />
      <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="Email address" autoComplete="off" className={field} />
      {preset.needsHost && (
        <div className="flex gap-2">
          <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="IMAP host (imap.example.com)" className={field} />
          <input value={port} onChange={(e) => setPort(e.target.value)} placeholder="993" className={`${field} w-20`} />
        </div>
      )}
      <input value={secret} onChange={(e) => setSecret(e.target.value)} type="password" placeholder="App-specific password" autoComplete="new-password" className={field} />
      <div className="text-[10px] text-dim leading-4">Use an app-specific password, not your login password. Stored on the server, never shown again.</div>
      {create.isError && <div className="text-[11px] text-red-300">{(create.error as Error).message}</div>}
      <div className="flex justify-end gap-2 pt-0.5">
        <button onClick={onDone} className="text-xs px-2.5 py-1 rounded bg-elevated hover:bg-edge">Cancel</button>
        <button onClick={save} disabled={!canSave || create.isPending} className="text-xs px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white">{create.isPending ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}

function providerLabel(id: string): string { return EMAIL_PROVIDERS.find((p) => p.id === id)?.label ?? id; }

function Toggle({ on, busy, onChange }: { on: boolean; busy: boolean; onChange: (on: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} disabled={busy} role="switch" aria-checked={on} title={on ? "Disable" : "Enable"}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${on ? "bg-blue-600" : "bg-elevated"} ${busy ? "opacity-50" : ""}`}>
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}
