import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { GithubRepo, GithubAccount } from "../api/types";

type Phase = "loading" | "ready" | "unauth" | "notinstalled" | "error";

/** Display label for an account chip: `login`, or `login@host` for a non-github.com host. */
function accountLabel(a: GithubAccount): string {
  return a.host === "github.com" ? a.login : `${a.login}@${a.host}`;
}

/**
 * Browse the repos on the user's GitHub via the `gh` CLI — shown inside the New Workspace modal's
 * clone mode. Works when gh is installed AND signed in (`gh auth login`); otherwise a one-line hint.
 * When more than one account is connected, an account switcher lets the user browse each one (its
 * repos are listed using that account's own token, so private repos show up). Picking a repo hands
 * up both the repo and the account it was browsed under, so the clone uses the right credentials.
 */
export function GithubRepoPicker({ selected, onPick }:
  { selected: string | null; onPick: (r: GithubRepo, account: GithubAccount) => void }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [accounts, setAccounts] = useState<GithubAccount[]>([]);
  const [sel, setSel] = useState(0);
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    let off = false;
    api.git.github.accounts()
      .then(({ installed, accounts }) => {
        if (off) return;
        if (!installed) { setPhase("notinstalled"); return; }
        if (accounts.length === 0) { setPhase("unauth"); return; }
        setAccounts(accounts);
        setSel(Math.max(0, accounts.findIndex(a => a.active)));
        setPhase("ready");
      })
      .catch(e => { if (!off) { setErr(String(e.message)); setPhase("error"); } });
    return () => { off = true; };
  }, []);

  // (Re)load repos whenever the selected account changes, scoped to that account's own credentials.
  useEffect(() => {
    if (phase !== "ready" || !accounts[sel]) return;
    let off = false;
    setReposLoading(true); setErr("");
    const acc = accounts[sel];
    api.git.github.repos({ account: acc.login, host: acc.host, limit: 200 })
      .then(r => { if (!off) { setRepos(r.repos); setReposLoading(false); } })
      .catch(e => { if (!off) { setErr(String(e.message)); setReposLoading(false); } });
    return () => { off = true; };
  }, [phase, sel, accounts]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return repos;
    return repos.filter(r =>
      r.nameWithOwner.toLowerCase().includes(needle) || r.description.toLowerCase().includes(needle));
  }, [repos, q]);

  if (phase === "loading") return (
    <Shell><div className="flex items-center gap-2 px-3 py-6 text-xs text-muted justify-center"><Spinner /> connecting to GitHub…</div></Shell>
  );
  if (phase === "notinstalled") return (
    <Shell>
      <div className="flex items-start gap-2.5 px-3 py-4 text-xs text-muted leading-relaxed">
        <span className="mt-0.5 text-fg"><GithubMark /></span>
        <span>The GitHub CLI isn’t installed. Install <code className="px-1 py-0.5 bg-elevated rounded text-fg font-mono">gh</code> to browse your repos, or paste a URL instead.</span>
      </div>
    </Shell>
  );
  if (phase === "unauth") return (
    <Shell>
      <div className="flex items-start gap-2.5 px-3 py-4 text-xs text-muted leading-relaxed">
        <span className="mt-0.5 text-fg"><GithubMark /></span>
        <span>Sign in to browse your repos — run <code className="px-1 py-0.5 bg-elevated rounded text-fg font-mono">gh auth login</code> in a terminal, then reopen this.</span>
      </div>
    </Shell>
  );
  if (phase === "error") return (
    <Shell><div className="px-3 py-4 text-xs text-error">{err || "could not reach GitHub"}</div></Shell>
  );

  return (
    <div className="flex flex-col gap-2">
      {accounts.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-dim shrink-0">Account</span>
          <select value={sel} onChange={e => { setSel(Number(e.target.value)); setQ(""); }}
            aria-label="GitHub account"
            className="flex-1 min-w-0 px-2 py-1 bg-surface border border-edge rounded-md text-xs text-fg outline-none cursor-pointer focus:border-blue-500">
            {accounts.map((a, i) => (
              <option key={`${a.host}/${a.login}`} value={i}>
                {accountLabel(a)}{a.active ? "  (active)" : ""}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dim"><SearchIcon /></span>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter repositories…"
          spellCheck={false} autoComplete="off" aria-label="Filter repositories"
          className="w-full pl-9 pr-3 py-2 bg-surface border border-edge rounded-lg text-sm text-fg placeholder:text-dim outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500/40" />
      </div>
      <div className="max-h-52 overflow-auto rounded-lg border border-edge bg-surface divide-y divide-edge/60">
        {reposLoading && <div className="flex items-center gap-2 px-3 py-6 text-xs text-muted justify-center"><Spinner /> loading repositories…</div>}
        {!reposLoading && err && <div className="px-3 py-4 text-xs text-error">{err}</div>}
        {!reposLoading && !err && filtered.length === 0 && <div className="px-3 py-6 text-xs text-muted text-center">no matching repositories</div>}
        {!reposLoading && !err && filtered.map(r => {
          const active = selected === r.nameWithOwner;
          return (
            <button key={r.nameWithOwner} onClick={() => onPick(r, accounts[sel])}
              className={`w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors cursor-pointer ${active ? "bg-blue-600/15" : "hover:bg-elevated"}`}>
              <span className={`shrink-0 ${active ? "text-blue-400" : "text-dim"}`}><RepoIcon /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className={`text-sm truncate ${active ? "text-bright" : "text-fg"}`}>{r.nameWithOwner}</span>
                  {r.isPrivate && <span className="shrink-0 text-dim" title="Private"><LockIcon /></span>}
                  {r.isFork && <span className="shrink-0 text-[10px] text-dim border border-edge rounded px-1">fork</span>}
                </span>
                {r.description && <span className="block text-xs text-dim truncate">{r.description}</span>}
              </span>
              {active && <span className="shrink-0 text-blue-400"><CheckIcon /></span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-edge bg-surface">{children}</div>;
}

/* ---- icons (inline SVG, matching the app's icon convention) ---- */
const sv = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

function SearchIcon() {
  return <svg width="15" height="15" {...sv}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-3.5-3.5" /></svg>;
}
function RepoIcon() {
  return <svg width="15" height="15" {...sv}><path d="M6 4h11a1 1 0 0 1 1 1v13H7a1 1 0 0 1-1-1z" /><path d="M6 17a2 2 0 0 0-2 2V6a2 2 0 0 1 2-2" /></svg>;
}
function LockIcon() {
  return <svg width="12" height="12" {...sv}><rect x="5" y="11" width="14" height="9" rx="1.6" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
}
function CheckIcon() {
  return <svg width="14" height="14" {...sv}><path d="m5 12.5 4.5 4.5L19 7" /></svg>;
}
function GithubMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.58 2 12.26c0 4.5 2.87 8.32 6.84 9.67.5.1.68-.22.68-.49 0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.21-3.37-1.21-.46-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.36-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.7 0 0 .84-.28 2.75 1.05a9.34 9.34 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.4.2 2.44.1 2.7.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.79-4.57 5.05.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.6.69.49A10.02 10.02 0 0 0 22 12.26C22 6.58 17.52 2 12 2z" />
    </svg>
  );
}
function Spinner() {
  return (
    <svg width="14" height="14" className="animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.4" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
