import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { GithubAccount, AiProvider } from "../../api/types";
import { useToasts } from "../../store/toasts";
import { Popover, MenuItem, MenuSep } from "./parts";
import { AiProviderSettings } from "./AiProviderSettings";

const acctKeyOf = (a: GithubAccount) => `${a.host}/${a.login}`;

/**
 * "Initialize Repository" for a folder that isn't under version control yet. Beyond a bare `git init`,
 * it lets the user pick WHICH signed-in GitHub account the repo should commit under (its name/email are
 * set repo-locally, overriding global/includeIf for just this repo) and optionally make the first
 * commit — message editable, with the SAME ✨ AI generate + provider picker the commit box uses.
 * Portals to <body> because the SCM panel lives inside the Room's CSS transform (same as PublishModal).
 */
export function InitRepoModal({ rootPath, onClose }: { rootPath: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToasts(s => s.push);

  // Signed-in gh accounts, so the user picks which identity the repo commits under. gh missing /
  // nobody logged in ⇒ empty list, and we fall back to a plain init under the global git identity.
  const { data: acctData } = useQuery({
    queryKey: ["git", "github", "accounts"],
    queryFn: () => api.git.github.accounts(),
  });
  const accounts = acctData?.accounts ?? [];

  const [acctKey, setAcctKey] = useState<string | null>(null);
  // Default the selection to the active account once the list loads (never hardcoded).
  useEffect(() => {
    if (acctKey || accounts.length === 0) return;
    setAcctKey(acctKeyOf(accounts.find(a => a.active) ?? accounts[0]));
  }, [accounts, acctKey]);
  const account = accounts.find(a => acctKeyOf(a) === acctKey) ?? null;

  // The commit identity (name + email) the chosen account would use — shown so the user SEES exactly
  // what gets written before committing. Keyed by account so switching reflows it.
  const { data: identity, isFetching: idLoading } = useQuery({
    queryKey: ["git", "github", "identity", acctKey],
    queryFn: () => api.git.github.identity(account!.login, account!.host),
    enabled: !!account,
  });

  // The AI providers — same source the commit box uses, so the picker here shows/switches the same set.
  const { data: aiCfg } = useQuery({ queryKey: ["ai", "providers"], queryFn: () => api.ai.providers() });
  const enabledProviders = (aiCfg?.providers ?? []).filter(p => p.enabled);
  const activeId = enabledProviders.find(p => p.id === aiCfg?.defaultProviderId)?.id ?? enabledProviders[0]?.id ?? null;
  const activeLabel = enabledProviders.find(p => p.id === activeId)?.label;
  // Switch the active provider by re-saving with a new default (keys + prompts preserved server-side).
  const switchProvider = (id: string) => {
    const providers = (aiCfg?.providers ?? []).map(({ apiKeySet, apiKeyFromEnv, ...rest }) => rest as AiProvider);
    api.ai.saveProviders(providers, id)
      .then(() => qc.invalidateQueries({ queryKey: ["ai"] }))
      .catch((e: Error) => toast(e.message));
  };

  // Which stacks the folder holds (node/python/rust…) + whether a .gitignore already exists, so the
  // dialog can show what the default .gitignore will cover before writing it.
  const { data: giPreview } = useQuery({
    queryKey: ["git", "gitignore-preview", rootPath],
    queryFn: () => api.git.gitignorePreview(rootPath),
  });

  const [addGitignore, setAddGitignore] = useState(true);
  const [doCommit, setDoCommit] = useState(true);
  const [message, setMessage] = useState("Initial commit");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [aiMenu, setAiMenu] = useState(false);
  const [aiSettings, setAiSettings] = useState(false);

  const acctArg = account ? { account: account.login, host: account.host } : {};
  // Shared init options for both ✨-generate and the Initialize button (identity + the .gitignore).
  const baseOpts = { ...acctArg, gitignore: addGitignore };

  // ✨ AI message: the repo must exist to read its files, so init first (under the chosen identity —
  // fast, no staging), then summarize its top-level contents server-side. The initial-commit endpoint
  // deliberately does NOT `git add -A`, so it never blocks on a huge node_modules-laden folder.
  const generate = async () => {
    if (generating) return;
    setGenerating(true);
    setGenError(null);
    try {
      // Init (+ identity + .gitignore) first so the listing the AI summarizes already excludes
      // node_modules/.env/etc. — a clean, meaningful basis for the message.
      await api.git.init(rootPath, baseOpts);
      const { message: m } = await api.ai.initialCommitMessage(rootPath);
      setMessage(m);
      qc.invalidateQueries({ queryKey: ["git"] });
    } catch (e) {
      const err = (e as Error).message;
      if (/no ai provider/i.test(err)) setAiSettings(true); // nudge to set one up, same as the commit box
      else setGenError(err);
    } finally {
      setGenerating(false);
    }
  };

  const init = useMutation({
    mutationFn: () => api.git.init(rootPath, {
      ...baseOpts,
      commit: doCommit ? { message: message.trim() || "Initial commit" } : undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["git"] }); // info refetch flips the gate to the repo view
      toast(doCommit ? "Repository initialized + first commit" : "Repository initialized");
      onClose();
    },
    onError: (e: Error) => toast(e.message), // keep the modal open so the choice can be fixed
  });

  const busy = init.isPending || generating;
  const close = () => { if (!busy) onClose(); };

  return createPortal(
    <>
    <div className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center" onClick={close}>
      <div className="bg-panel w-[440px] rounded-lg border border-edge shadow-2xl p-5 flex flex-col gap-3"
        onClick={e => e.stopPropagation()}>
        <h2 className="text-lg flex items-center gap-2"><GitMark /> Initialize Repository</h2>

        {/* Pick which signed-in GitHub identity the repo commits under (only when there's a choice). */}
        {accounts.length >= 2 && (
          <div className="text-sm">
            <div className="text-muted mb-1">Account</div>
            <select value={acctKey ?? ""} onChange={e => setAcctKey(e.target.value)}
              className="w-full px-2 py-1.5 bg-elevated rounded border border-edge-strong text-fg">
              {accounts.map(a => (
                <option key={acctKeyOf(a)} value={acctKeyOf(a)}>
                  {a.login}{a.active ? "  (active)" : ""}{a.host !== "github.com" ? `  · ${a.host}` : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* What identity will actually be written, so the user can catch a wrong account before committing. */}
        {account && (
          <div className="text-xs text-dim -mt-1">
            {idLoading && !identity ? "resolving identity…" : identity
              ? <>commits as <span className="text-fg">{identity.name}</span> <span className="font-mono text-muted">&lt;{identity.email}&gt;</span></>
              : "couldn't read this account's identity"}
          </div>
        )}
        {!account && (
          <div className="text-xs text-dim">
            {acctData && !acctData.installed
              ? "GitHub CLI not found — the repo will use your global git identity."
              : "No signed-in GitHub account — the repo will use your global git identity."}
          </div>
        )}

        {/* Default .gitignore — written before staging so the first commit never includes node_modules,
            build output, or .env/secrets. Skipped (kept as-is) if the folder already has one. */}
        <label className="flex items-center gap-2 text-sm mt-1 select-none cursor-pointer">
          <input type="checkbox" checked={addGitignore} onChange={e => setAddGitignore(e.target.checked)} className="accent-blue-500" />
          Add a .gitignore
        </label>
        {addGitignore && (
          <div className="text-xs text-dim -mt-1.5 ml-6">
            {giPreview?.exists
              ? "A .gitignore already exists — it'll be kept as-is."
              : giPreview && giPreview.ecosystems.length
                ? <>Detected <span className="text-fg">{giPreview.ecosystems.map(e => e.label).join(", ")}</span> + common (.env, OS files, logs).</>
                : "Common defaults (.env, OS files, logs)."}
          </div>
        )}

        {/* Optional first commit: stages everything and commits, message editable (✨ AI-generated). */}
        <label className="flex items-center gap-2 text-sm mt-1 select-none cursor-pointer">
          <input type="checkbox" checked={doCommit} onChange={e => setDoCommit(e.target.checked)} className="accent-blue-500" />
          Create initial commit
        </label>
        {doCommit && (
          <div className="space-y-1.5">
            <textarea value={message} onChange={e => { setMessage(e.target.value); if (genError) setGenError(null); }} rows={2}
              spellCheck={false} placeholder="Initial commit"
              className="w-full px-2 py-1.5 bg-elevated rounded border border-edge-strong text-sm resize-none outline-none focus:border-blue-500" />

            {genError && (
              <div className="flex items-start gap-1.5 text-[11px] text-red-400" role="alert">
                <span className="leading-none">⚠</span><span className="min-w-0 break-words">{genError}</span>
              </div>
            )}

            {/* ✨ generate + provider chevron — the SAME control the commit box uses, so you can switch
                provider or open AI settings to add/pick models right here. */}
            <div className="flex items-center gap-2">
              <div className="flex">
                <button type="button" title="Generate an initial-commit message from the project's files"
                  disabled={generating} onClick={generate}
                  className={`h-7 px-2 rounded-l text-sm border border-edge-strong ${generating ? "bg-panel text-dim cursor-not-allowed" : "bg-elevated hover:bg-edge text-fg"}`}>
                  {generating
                    ? <span className="tr-dot-wave" role="status" aria-label="Generating message"><i /><i /><i /></span>
                    : "✨"}
                </button>
                <div className="relative">
                  <button type="button" onClick={() => setAiMenu(v => !v)}
                    title={activeLabel ? `AI: ${activeLabel} — switch or edit settings` : "Choose an AI provider"}
                    className="h-7 w-7 flex items-center justify-center rounded-r border border-l-0 border-edge-strong bg-elevated hover:bg-edge text-fg text-base leading-none">
                    <span className="-translate-y-1">⌄</span></button>
                  <Popover open={aiMenu} onClose={() => setAiMenu(false)} className="left-0 top-8 w-56">
                    {enabledProviders.map(p => (
                      <MenuItem key={p.id} onClick={() => { setAiMenu(false); switchProvider(p.id); }}>
                        <span className="flex items-center gap-2">
                          <span className="w-3 text-blue-400">{p.id === activeId ? "✓" : ""}</span>
                          <span className="truncate">{p.label}</span>
                        </span>
                      </MenuItem>
                    ))}
                    {enabledProviders.length === 0 && <div className="px-3 py-1.5 text-xs text-dim">No providers yet</div>}
                    <MenuSep />
                    <MenuItem onClick={() => { setAiMenu(false); setAiSettings(true); }}>Add / edit models…</MenuItem>
                  </Popover>
                </div>
              </div>
              <span className="text-[11px] text-dim truncate">{activeLabel ? `via ${activeLabel}` : "no AI provider — pick one ⌄"}</span>
            </div>
          </div>
        )}

        <div className="flex justify-between mt-1">
          <button onClick={close} disabled={busy} className="px-3 py-1.5 bg-elevated hover:bg-edge rounded text-sm disabled:opacity-40">Cancel</button>
          <button disabled={busy} onClick={() => init.mutate()}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm text-white disabled:opacity-40 flex items-center gap-2">
            {init.isPending && <Spinner />}{init.isPending ? "Initializing…" : "Initialize"}
          </button>
        </div>
      </div>
    </div>

    {/* AI settings sits in its OWN layer ABOVE this modal (it hardcodes z-[60], below our z-[70]) and
        outside the close-on-click overlay, so opening "Add / edit models…" doesn't dismiss this dialog. */}
    {aiSettings && (
      <div className="fixed inset-0 z-[80]">
        <AiProviderSettings onClose={() => setAiSettings(false)} />
      </div>
    )}
    </>,
    document.body,
  );
}

function Spinner() {
  return <svg className="animate-spin" width="13" height="13" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
    <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>;
}
function GitMark({ size = 16 }: { size?: number } = {}) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className="shrink-0 text-fg">
    <path d="M15.7 7.3 8.7.3a1 1 0 0 0-1.4 0L5.85 1.74l1.83 1.83a1.2 1.2 0 0 1 1.52 1.53l1.76 1.76a1.2 1.2 0 1 1-.72.68L8.6 5.88v4.32a1.2 1.2 0 1 1-1 0V5.84a1.2 1.2 0 0 1-.65-1.57L5.14 2.46.3 7.3a1 1 0 0 0 0 1.4l7 7a1 1 0 0 0 1.4 0l7-7a1 1 0 0 0 0-1.4Z" />
  </svg>;
}
