import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { GithubAccount } from "../../api/types";
import { useToasts } from "../../store/toasts";

const acctKeyOf = (a: GithubAccount) => `${a.host}/${a.login}`;

/**
 * "Publish to GitHub" for a folder with no remote yet. Creates the repo via `gh`
 * (owner + visibility chosen here), wires up origin, and pushes — VS Code's flow.
 * Portals to <body> because the SCM panel lives inside the Room's CSS transform,
 * which would otherwise capture position:fixed.
 */
export function PublishModal({ rootPath, folder, branch, onClose }:
  { rootPath: string; folder: string; branch: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToasts(s => s.push);

  const { data: info, isLoading: infoLoading } = useQuery({
    queryKey: ["git", "github", "info", rootPath],
    queryFn: () => api.git.github.info(rootPath),
  });
  const ready = !!info?.installed && !!info?.authed;

  // Every signed-in gh account (personal + work, even across hosts) so the user picks which identity
  // to publish under — without `gh auth switch` flipping the active account for every other terminal.
  const { data: acctData } = useQuery({
    queryKey: ["git", "github", "accounts"],
    queryFn: () => api.git.github.accounts(),
    enabled: ready,
  });
  const accounts = acctData?.accounts ?? [];

  const [name, setName] = useState(folder);
  const [owner, setOwner] = useState("");
  const [acctKey, setAcctKey] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [description, setDescription] = useState("");
  const [topics, setTopics] = useState("");

  // Default the selection to the active account once the list loads (never hardcoded).
  useEffect(() => {
    if (acctKey || accounts.length === 0) return;
    setAcctKey(acctKeyOf(accounts.find(a => a.active) ?? accounts[0]));
  }, [accounts, acctKey]);
  const account = accounts.find(a => acctKeyOf(a) === acctKey) ?? null;

  // Owner list (login + orgs) scoped to the chosen account, so switching account reflows the orgs.
  const { data: owners } = useQuery({
    queryKey: ["git", "github", "owners", rootPath, acctKey],
    queryFn: () => api.git.github.owners(rootPath, account ? { account: account.login, host: account.host } : undefined),
    enabled: ready,
  });

  // Switching account resets the owner to that account's own login (its orgs are added in the list).
  useEffect(() => { if (account) setOwner(account.login); }, [account?.login]);
  // No-account fallback (e.g. account list unavailable): default the owner to the authed login.
  useEffect(() => { if (owners?.login && !owner) setOwner(owners.login); }, [owners, owner]);

  const publish = useMutation({
    mutationFn: () => api.git.github.publish(rootPath, {
      name: name.trim(), owner, visibility, description: description.trim() || undefined,
      topics: topics.split(/[,\n]/).map(t => t.trim()).filter(Boolean),
      account: account?.login, host: account?.host,
    }),
    onSuccess: ({ url }) => {
      qc.invalidateQueries({ queryKey: ["git"] });
      toast(`Published → ${url}`);
      onClose();
    },
    onError: (e: Error) => toast(e.message), // keep the modal open so the name can be fixed
  });

  const ownerList = owners ? [owners.login, ...owners.orgs] : owner ? [owner] : [];
  const canPublish = ready && !!name.trim() && !!owner && !publish.isPending;

  const close = () => { if (!publish.isPending) onClose(); };

  // Close on a backdrop click only when the press BOTH started and ended on the backdrop. Without the
  // mousedown guard, selecting text inside the modal and releasing the mouse outside it fires a click
  // on the backdrop (its the common ancestor of down+up) and wrongly closes the modal.
  const downOnBackdrop = useRef(false);

  return createPortal(
    <div className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center"
      onMouseDown={e => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={e => { if (downOnBackdrop.current && e.target === e.currentTarget) close(); }}>
      <div className="bg-panel w-[440px] rounded-lg border border-edge shadow-2xl p-5 flex flex-col gap-3"
        onClick={e => e.stopPropagation()}>
        <h2 className="text-lg flex items-center gap-2"><GithubMark /> Publish to GitHub</h2>

        {infoLoading && <div className="text-sm text-muted py-4">checking GitHub CLI…</div>}

        {!infoLoading && !info?.installed && (
          <Gate title="GitHub CLI not installed"
            hint="Install gh, then reopen. macOS: brew install gh · Windows: winget install GitHub.cli · Linux: see cli.github.com" />
        )}
        {!infoLoading && info?.installed && !info.authed && (
          <Gate title="GitHub CLI not signed in" hint="Run  gh auth login  in a terminal, then reopen." />
        )}

        {ready && (
          <>
            {/* Pick which signed-in GitHub identity to publish under (a plain dropdown — scales the
                same whether there are two accounts or ten). */}
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

            {/* Owner only matters when the account can create under an org too — otherwise the owner
                IS the account login the picker above already shows, so we hide this redundant row. */}
            {ownerList.length > 1 && (
              <div className="text-sm">
                <div className="text-muted mb-1">Owner</div>
                <select value={owner} onChange={e => setOwner(e.target.value)}
                  className="w-full px-2 py-1.5 bg-elevated rounded border border-edge-strong text-fg">
                  {ownerList.map(o => <option key={o} value={o}>{o}{owners && o === owners.login ? "  (you)" : ""}</option>)}
                </select>
              </div>
            )}

            <label className="text-sm">Repository name
              <input value={name} onChange={e => setName(e.target.value)} spellCheck={false} autoComplete="off"
                className="w-full mt-1 px-2 py-1.5 bg-elevated rounded border border-edge-strong font-mono" />
            </label>
            <div className="text-xs text-dim -mt-1">
              Creating <span className="text-fg font-mono">github.com/{owner || "…"}/{name.trim() || "…"}</span>
            </div>

            <div className="text-sm">
              <div className="text-muted mb-1">Visibility</div>
              <div className="grid grid-cols-2 gap-2">
                <VisCard active={visibility === "private"} onClick={() => setVisibility("private")}
                  icon={<LockIcon />} title="Private" sub="Only you can see it" />
                <VisCard active={visibility === "public"} onClick={() => setVisibility("public")}
                  icon={<GlobeIcon />} title="Public" sub="Anyone can see it" />
              </div>
            </div>

            <label className="text-sm">Description <span className="text-dim">(optional)</span>
              <input value={description} onChange={e => setDescription(e.target.value)}
                className="w-full mt-1 px-2 py-1.5 bg-elevated rounded border border-edge-strong" />
            </label>

            <label className="text-sm">Topics <span className="text-dim">(optional)</span>
              <input value={topics} onChange={e => setTopics(e.target.value)} spellCheck={false} autoComplete="off"
                placeholder="comma-separated, e.g. cli, rust, terminal"
                className="w-full mt-1 px-2 py-1.5 bg-elevated rounded border border-edge-strong" />
            </label>
            <div className="text-xs text-dim -mt-1">Lowercase tags for discovery on GitHub; spaces become hyphens.</div>

            <div className="text-xs text-dim">
              Creates the repo on GitHub and pushes {branch ? <>branch <span className="font-mono text-muted">{branch}</span></> : "the current branch"}.
            </div>

            <div className="flex justify-between mt-1">
              <button onClick={close} className="px-3 py-1.5 bg-elevated hover:bg-edge rounded text-sm">Cancel</button>
              <button disabled={!canPublish} onClick={() => publish.mutate()}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm disabled:opacity-40 flex items-center gap-2">
                {publish.isPending && <Spinner />}{publish.isPending ? "Publishing…" : "Publish"}
              </button>
            </div>
          </>
        )}

        {!infoLoading && !ready && (
          <div className="flex justify-end">
            <button onClick={close} className="px-3 py-1.5 bg-elevated hover:bg-edge rounded text-sm">Close</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Gate({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="py-2">
      <div className="text-fg text-sm font-medium">{title}</div>
      <div className="text-dim text-xs leading-relaxed mt-1">{hint}</div>
    </div>
  );
}

function VisCard({ active, onClick, icon, title, sub }:
  { active: boolean; onClick: () => void; icon: ReactNode; title: string; sub: string }) {
  return (
    <button onClick={onClick}
      className={`text-left px-3 py-2 rounded border ${active ? "bg-blue-500/15 border-blue-500/50" : "bg-surface border-edge-strong hover:bg-elevated"}`}>
      <div className="flex items-center gap-1.5 text-fg text-sm">{icon}{title}{active && <span className="ml-auto text-blue-300">✓</span>}</div>
      <div className="text-[11px] text-dim mt-0.5">{sub}</div>
    </button>
  );
}

function Spinner() {
  return <svg className="animate-spin" width="13" height="13" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
    <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>;
}
function GithubMark({ size = 16, className = "text-fg" }: { size?: number; className?: string } = {}) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={`shrink-0 ${className}`}>
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
  </svg>;
}
function LockIcon() {
  return <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="text-muted">
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </svg>;
}
function GlobeIcon() {
  return <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" className="text-muted">
    <circle cx="8" cy="8" r="5.5" /><path d="M2.5 8h11M8 2.5c1.7 1.7 1.7 9.3 0 11M8 2.5c-1.7 1.7-1.7 9.3 0 11" />
  </svg>;
}
