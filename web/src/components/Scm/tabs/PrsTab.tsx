import { copyText } from "../../../lib/clipboard";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../api/client";
import type { PullRequest, PrMergeMethod } from "../../../api/types";
import { useToasts } from "../../../store/toasts";
import { useGit } from "../useGit";
import { FileContextMenu, type FileMenuEntry } from "../FileContextMenu";
import { PrCommentModal } from "../PrCommentModal";
import { PrCreateModal } from "../PrCreateModal";
import { Centered, Notice } from "../parts";

/** GitHub pull requests via `gh`. Gated on gh being installed + authed, with a Refresh. */
export function PrsTab({ rootPath }: { rootPath: string }) {
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
      hint="Install gh to see pull requests. macOS: brew install gh. Linux: see cli.github.com. Then refresh." />
  );
  if (!info.authed) return (
    <Notice title="GitHub CLI not signed in" onRefresh={refresh} hint="Run gh auth login in a terminal, then refresh." />
  );
  return <PrList rootPath={rootPath} />;
}

function PrList({ rootPath }: { rootPath: string }) {
  const { run } = useGit();
  const qc = useQueryClient();
  const push = useToasts(s => s.push);
  const [menu, setMenu] = useState<{ p: PullRequest; x: number; y: number } | null>(null);
  const [comment, setComment] = useState<PullRequest | null>(null);
  const [filter, setFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["git", "github", "prs", rootPath],
    queryFn: () => api.git.github.prs(rootPath),
    refetchInterval: 30_000,
  });
  const open = (url: string) => url && window.open(url, "_blank", "noopener");
  const refresh = () => qc.invalidateQueries({ queryKey: ["git", "github"] });
  const allPrs = data?.prs ?? [];
  // Filter by title, #number, head branch, or author — the same live-filter feel as the branch picker.
  const prs = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return allPrs;
    return allPrs.filter(p =>
      p.title.toLowerCase().includes(q) || String(p.number).includes(q) ||
      p.branch.toLowerCase().includes(q) || p.author.toLowerCase().includes(q));
  }, [allPrs, filter]);

  const mergePr = (p: PullRequest, method: PrMergeMethod) => {
    if (confirm(`Merge PR #${p.number} (${method})?`))
      run(() => api.git.github.prMerge(rootPath, p.number, method), { onSuccess: () => { refresh(); push(`Merged #${p.number}`); } });
  };
  const closePr = (p: PullRequest) => {
    if (confirm(`Close PR #${p.number} without merging?`))
      run(() => api.git.github.prClose(rootPath, p.number), { onSuccess: () => { refresh(); push(`Closed #${p.number}`); } });
  };
  const submitComment = (body: string) => {
    if (!comment) return;
    const n = comment.number;
    run(() => api.git.github.prComment(rootPath, n, body), { onSuccess: () => { refresh(); push("Comment posted"); } });
    setComment(null);
  };

  // gh's three merge strategies live in a flyout submenu, mirroring GitHub's own merge button.
  const items = (p: PullRequest): FileMenuEntry[] => [
    { label: "Copy URL", onClick: () => copyText(p.url) },
    { label: "Open in Browser", onClick: () => open(p.url) },
    "sep",
    { label: "Comment on Pull Request…", onClick: () => setComment(p) },
    { label: "Merge Pull Request", children: [
      { label: "Create a merge commit", onClick: () => mergePr(p, "merge") },
      { label: "Squash and merge", onClick: () => mergePr(p, "squash") },
      { label: "Rebase and merge", onClick: () => mergePr(p, "rebase") },
    ] },
    { label: "Close Pull Request", onClick: () => closePr(p) },
  ];

  return (
    <div className="flex-1 min-h-0 flex flex-col text-sm">
      <div className="flex items-center gap-2 px-2 h-8 shrink-0 border-b border-edge">
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter pull requests…" spellCheck={false}
          className="flex-1 min-w-0 px-2 py-1 text-xs bg-panel border border-edge rounded outline-none focus:border-blue-500" />
        <button title="Create pull request" onClick={() => setCreateOpen(true)}
          className="shrink-0 text-muted hover:text-bright text-base leading-none px-1">＋</button>
      </div>

      <div className="flex-1 overflow-auto">
        {prs.map(p => (
          <button key={p.number} onClick={() => open(p.url)}
            onContextMenu={e => { e.preventDefault(); setMenu({ p, x: e.clientX, y: e.clientY }); }}
            className="w-full text-left flex items-start gap-2 px-3 py-1.5 hover:bg-surface cursor-pointer">
            <span className={`mt-0.5 ${p.draft ? "text-dim" : "text-green-400"}`}>⑂</span>
            <span className="min-w-0">
              <span className="block truncate text-fg">{p.title}</span>
              <span className="block truncate text-[11px] text-dim">#{p.number} · {p.branch}{p.draft ? " · draft" : ""}</span>
            </span>
          </button>
        ))}
        {isLoading && <div className="px-3 py-4 text-xs text-dim">loading…</div>}
        {!isLoading && allPrs.length === 0 && <div className="px-3 py-4 text-xs text-dim">No open pull requests.</div>}
        {!isLoading && allPrs.length > 0 && prs.length === 0 && <div className="px-3 py-4 text-xs text-dim">No matching pull requests.</div>}
      </div>

      {menu && <FileContextMenu x={menu.x} y={menu.y} items={items(menu.p)} dismiss={() => setMenu(null)} />}
      {comment && <PrCommentModal prNumber={comment.number} onSubmit={submitComment} onCancel={() => setComment(null)} />}
      {createOpen && <PrCreateModal rootPath={rootPath} onClose={() => setCreateOpen(false)} />}
    </div>
  );
}
