import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { GitGate } from "./GitGate";

export function GitHubPanel({ rootPath }: { rootPath: string }) {
  return (
    <GitGate rootPath={rootPath}>
      <GithubBody rootPath={rootPath} />
    </GitGate>
  );
}

function GithubBody({ rootPath }: { rootPath: string }) {
  const qc = useQueryClient();
  const { data: info, isLoading } = useQuery({
    queryKey: ["git", "github", "info", rootPath],
    queryFn: () => api.git.github.info(rootPath),
    refetchInterval: 15_000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["git", "github"] });

  if (isLoading) return <Centered>checking GitHub CLI…</Centered>;
  if (!info?.installed) return (
    <Notice title="GitHub CLI not installed" onRefresh={refresh}
      hint="Install gh to see pull requests and Actions runs. macOS: brew install gh. Linux: see cli.github.com. Then refresh." />
  );
  if (!info.authed) return (
    <Notice title="GitHub CLI not signed in" onRefresh={refresh}
      hint="Run gh auth login in a terminal, then refresh." />
  );
  return <GithubData rootPath={rootPath} />;
}

function GithubData({ rootPath }: { rootPath: string }) {
  const prs = useQuery({ queryKey: ["git", "github", "prs", rootPath], queryFn: () => api.git.github.prs(rootPath), refetchInterval: 30_000 });
  const runs = useQuery({ queryKey: ["git", "github", "runs", rootPath], queryFn: () => api.git.github.runs(rootPath), refetchInterval: 15_000 });
  const open = (url: string) => url && window.open(url, "_blank", "noopener");

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-auto text-sm">
      <Section title="PULL REQUESTS" count={prs.data?.prs.length}>
        {(prs.data?.prs ?? []).map(p => (
          <button key={p.number} onClick={() => open(p.url)}
            className="w-full text-left flex items-start gap-2 px-3 py-1.5 hover:bg-surface">
            <span className={`mt-0.5 ${p.draft ? "text-dim" : "text-green-400"}`}>⑂</span>
            <span className="min-w-0">
              <span className="block truncate text-fg">{p.title}</span>
              <span className="block truncate text-[11px] text-dim">#{p.number} · {p.branch}{p.draft ? " · draft" : ""}</span>
            </span>
          </button>
        ))}
        {prs.data && prs.data.prs.length === 0 && <Empty>No open pull requests.</Empty>}
      </Section>

      <Section title="ACTIONS RUNS" count={runs.data?.runs.length}>
        {(runs.data?.runs ?? []).map(r => (
          <button key={r.id} onClick={() => open(r.url)}
            className="w-full text-left flex items-start gap-2 px-3 py-1.5 hover:bg-surface">
            <RunIcon status={r.status} conclusion={r.conclusion} />
            <span className="min-w-0">
              <span className="block truncate text-fg">{r.title || r.name}</span>
              <span className="block truncate text-[11px] text-dim">{r.name} · {r.branch} · {r.event}</span>
            </span>
          </button>
        ))}
        {runs.data && runs.data.runs.length === 0 && <Empty>No recent workflow runs.</Empty>}
      </Section>
    </div>
  );
}

function RunIcon({ status, conclusion }: { status: string; conclusion: string | null }) {
  if (status !== "completed") return <span className="mt-0.5 text-amber-400 tr-blink" title={status}>◐</span>;
  if (conclusion === "success") return <span className="mt-0.5 text-green-400" title="success">✓</span>;
  if (conclusion === "failure") return <span className="mt-0.5 text-red-400" title="failure">✗</span>;
  return <span className="mt-0.5 text-dim" title={conclusion ?? "done"}>○</span>;
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <div className="mb-1">
      <div className="px-3 py-1 text-[11px] tracking-wide text-muted">{title}{count != null && <span className="text-dim"> {count}</span>}</div>
      {children}
    </div>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return <div className="px-3 py-2 text-xs text-dim">{children}</div>;
}
function Centered({ children }: { children: ReactNode }) {
  return <div className="flex-1 flex items-center justify-center text-xs text-dim p-4">{children}</div>;
}
function Notice({ title, hint, onRefresh }: { title: string; hint: string; onRefresh: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 p-5 text-center">
      <div className="text-fg text-sm font-medium">{title}</div>
      <div className="text-dim text-xs leading-relaxed">{hint}</div>
      <button onClick={onRefresh} className="mt-1 px-3 py-1.5 bg-elevated hover:bg-edge rounded text-xs text-fg">↻ Refresh</button>
    </div>
  );
}
