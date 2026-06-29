import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useRoom } from "../../store/room";
import { useToasts } from "../../store/toasts";
import { confirmModal } from "../../store/confirm";
import { useGit } from "./useGit";
import { PublishModal } from "./PublishModal";
import { PrCreateModal } from "./PrCreateModal";
import { BranchPicker } from "./BranchPicker";
import { Popover, MenuItem, MenuSep, FolderIcon, Spinner } from "./parts";

/**
 * `📁 folder / branch` on the left; a smart-sync button + a git-ops dropdown on the right.
 * The button adapts to the repo state: Publish to GitHub (no remote) → Publish Branch (no
 * upstream) → ↓behind ↑ahead Sync (diverged) → Pull N (behind) → Push N (ahead) → Fetch
 * (nothing queued — the resting state).
 */
export function GitHeader({ rootPath, onResizeStart }:
  { rootPath: string; onResizeStart?: (e: ReactPointerEvent) => void }) {
  const { run, pending } = useGit();
  const push = useToasts(s => s.push);
  const setScmTab = useRoom(s => s.setScmTab);
  const [menuOpen, setMenuOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [prCreateOpen, setPrCreateOpen] = useState(false);

  const { data: status } = useQuery({
    queryKey: ["git", "status", rootPath],
    queryFn: () => api.git.status(rootPath),
    refetchInterval: 2500,
    refetchIntervalInBackground: true, // keep polling while terminalhub is backgrounded (see ChangesSection)
  });
  // Branches power the click-to-switch dropdown on the branch label below. Same cache/staleTime as
  // the room-header chip and the SCM panel so all three branch switchers share one fetch.
  const { data: branchData } = useQuery({
    queryKey: ["git", "branches", rootPath],
    queryFn: () => api.git.branches(rootPath),
    staleTime: 8000,
  });

  const folder = rootPath.split("/").pop() || rootPath;
  const branch = status?.branch ?? (status?.detached ? "detached HEAD" : "—");
  const published = !!status?.upstream;
  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;
  const hasRemote = (status?.remotes?.length ?? 0) > 0;

  // Open pull requests (shared cache with the PRs tab). `gh pr list` returns only OPEN PRs, so a PR
  // that gets merged/closed drops out on the next poll and the chip disappears on its own. Only run
  // it for a repo with a remote — a local-only repo has no PRs to look up.
  const { data: prData } = useQuery({
    queryKey: ["git", "github", "prs", rootPath],
    queryFn: () => api.git.github.prs(rootPath),
    enabled: hasRemote,
    refetchInterval: 30_000,
  });
  // The open PR whose head is the branch we're on — what to surface as a clickable "PR #n" chip.
  const branchPr = (prData?.prs ?? []).find(p => p.branch === status?.branch);

  // Things git's CLI can do but we haven't exposed a server endpoint for yet. Surface
  // it loudly (toast) rather than a silent no-op so the button never lies.
  const notWired = (what: string) => push(`${what} isn't wired up yet`);
  const close = (fn: () => void) => () => { setMenuOpen(false); fn(); };

  // The whole header bar doubles as a drag-to-resize handle for the bottom block (GitPanel owns
  // the drag math). Skip the buttons so a press on them still clicks instead of starting a resize.
  const onBarPointerDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    onResizeStart?.(e);
  };

  // Every network op toasts git's own transcript on success ("Everything up-to-date",
  // "Already up to date.", "Fetched.", "… -> main") so nothing completes in silence.
  const toastMsg = (d: unknown) => push((d as { message: string }).message);
  // Force Push overwrites the remote with the local branch — the only way out when histories have
  // diverged with no shared ancestor (Sync can't merge unrelated histories). Destructive on the
  // remote, so it's gated behind a confirm (like every other destructive git action here).
  const forcePushCur = async () => {
    const ok = await confirmModal({
      title: "Force push?",
      body: `This overwrites the remote ${branch} with your local branch, discarding ${behind > 0 ? `${behind} commit${behind === 1 ? "" : "s"} on the remote you don't have` : "any remote commits you don't have"}. This can't be undone.`,
      confirmLabel: "Force Push",
    });
    if (ok) run(() => api.git.forcePush(rootPath, !published), { onSuccess: toastMsg });
  };
  // A push/sync that fails because the branch has diverged (unrelated histories, or a
  // non-fast-forward rejection) can ONLY be resolved by overwriting the remote — so that error
  // toast carries a Force Push button (which opens the confirm above) instead of dead-ending on a
  // message. It sticks (no auto-dismiss) so the offer doesn't vanish while you read it. NOT offered
  // on a failed pull/fetch: there, force-pushing would destroy the very remote commits you wanted.
  const divergedPushFailure = (msg: string) =>
    /unrelated histories|non-fast-forward|\(fetch first\)|\[rejected\]|tip of your current branch is behind/i.test(msg);
  const onNetErr = (e: Error) =>
    divergedPushFailure(e.message)
      ? push(e.message, { sticky: true, action: { label: "Force Push", onClick: () => void forcePushCur() } })
      : push(e.message);

  const fetchAll = () => run(() => api.git.fetch(rootPath), { onSuccess: toastMsg });
  const pullCur = () => run(() => api.git.pull(rootPath), { onSuccess: toastMsg });
  const pushCur = () => run(() => api.git.push(rootPath, !published), { onSuccess: toastMsg, onError: onNetErr });
  const syncCur = () => run(() => api.git.sync(rootPath), { onSuccess: toastMsg, onError: onNetErr });
  const publishOrPush = () => (hasRemote ? pushCur() : setPublishOpen(true));

  // The primary button is a smart sync, like VS Code's: Publish when there's no remote or
  // upstream; when the branch has diverged (both ahead AND behind) show ↓behind ↑ahead and
  // sync (pull then push); otherwise Pull when behind, Push when ahead, and a plain Fetch
  // when there's nothing queued (the default resting state).
  const mode =
    !hasRemote ? "publish"
    : !published ? "publish-branch"
    : ahead > 0 && behind > 0 ? "sync"
    : behind > 0 ? "pull"
    : ahead > 0 ? "push"
    : "fetch";
  const primary =
    mode === "publish" ? () => setPublishOpen(true)
    : mode === "sync" ? syncCur
    : mode === "pull" ? pullCur
    : mode === "fetch" ? fetchAll
    : pushCur; // "push" and "publish-branch" both push (push -u when there's no upstream)
  const primaryLabel =
    mode === "publish" ? "Publish to GitHub"
    : mode === "publish-branch" ? "Publish Branch"
    : mode === "pull" ? `Pull ${behind}`
    : mode === "push" ? `Push ${ahead}`
    : "Fetch"; // "sync" renders its own ↓/↑ pair below
  const primaryIcon = mode === "pull" ? "↓" : mode === "fetch" ? "↻" : "↑";
  const primaryTitle =
    mode === "publish" ? "Create this repo on GitHub"
    : mode === "publish-branch" ? "Publish branch to remote"
    : mode === "sync" ? `Sync: pull ${behind}, push ${ahead}`
    : mode === "pull" ? "Pull changes from upstream"
    : mode === "push" ? "Push commits"
    : "Fetch from remote";

  return (
    <div onPointerDown={onResizeStart ? onBarPointerDown : undefined} title={onResizeStart ? "Drag to resize" : undefined}
      className={`flex items-center gap-2 px-3 h-9 shrink-0 border-b border-edge ${onResizeStart ? "cursor-row-resize" : "cursor-default"}`}>
      <FolderIcon />
      <span className="flex items-center text-[13px] min-w-0" title={`${folder} · ${branch}`}>
        {/* The folder name (and its icon) never clip — they're the identity, always shown in full. */}
        <span className="text-fg shrink-0">{folder}</span>
        <span className="text-dim shrink-0"> / </span>
        {/* The branch is the only part that shrinks: it clips with NO ellipsis (overflow-hidden,
            not `truncate`) so as much of the name shows as fits. Clicking opens the switcher. */}
        <span className="relative min-w-0 flex">
          <button onClick={() => setBranchOpen(v => !v)} title="Switch branch"
            className="flex items-center gap-0.5 min-w-0 max-w-full rounded px-0.5 -mx-0.5 text-muted hover:text-fg hover:bg-elevated cursor-pointer">
            <span className="min-w-0 overflow-hidden whitespace-nowrap">{branch}</span>
            <span className="text-dim leading-none -translate-y-px shrink-0">▾</span>
          </button>
          {branchOpen && (
            <BranchPicker branches={branchData?.branches ?? []} pending={pending} showSearch
              onCheckout={name => run(() => api.git.checkout(rootPath, name))}
              onCreate={name => run(() => api.git.createBranch(rootPath, name))}
              onClose={() => setBranchOpen(false)} className="left-0 top-6 w-64" />
          )}
        </span>
      </span>
      {branchPr && (
        <button onClick={() => window.open(branchPr.url, "_blank", "noopener")}
          title={`Open pull request #${branchPr.number}${branchPr.draft ? " (draft)" : ""} — ${branchPr.title}`}
          className="shrink-0 text-xs font-medium text-green-400 hover:text-green-300 hover:underline leading-none">
          PR #{branchPr.number}
        </button>
      )}

      {/* Split button: a fixed-height row whose halves each take h-full, so both resolve to the exact
          same pixel height off one definite source — no stretch/min-content rounding between them. */}
      <div className="ml-auto flex shrink-0 h-[25px]">
        <button onClick={primary} title={primaryTitle} disabled={pending}
          className="h-full flex items-center gap-1 px-2 min-h-0 leading-none rounded-l bg-elevated hover:bg-edge text-fg text-xs border border-edge-strong cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-elevated">
          {pending
            ? <span className="flex items-center gap-1"><Spinner />Working…</span>
            : mode === "sync"
              ? <span className="flex items-center gap-1.5 tabular-nums"><span>↓{behind}</span><span>↑{ahead}</span></span>
              : <><span>{primaryIcon}</span>{primaryLabel}</>}
        </button>
        <div className="relative flex h-full">
          <button title="More git actions" onClick={() => setMenuOpen(v => !v)}
            className="h-full flex items-center justify-center w-7 min-h-0 rounded-r bg-elevated hover:bg-edge text-fg border border-l-0 border-edge-strong cursor-pointer">
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6l4 4 4-4" />
            </svg></button>
          <Popover open={menuOpen} onClose={() => setMenuOpen(false)} className="right-0 top-7 w-52">
            <MenuItem onClick={close(fetchAll)} disabled={pending}>Fetch</MenuItem>
            <MenuItem onClick={close(() => notWired("Fetch From"))}>Fetch From…</MenuItem>
            <MenuItem onClick={close(pullCur)} disabled={pending}>Pull</MenuItem>
            <MenuItem onClick={close(() => notWired("Pull (Rebase)"))}>Pull (Rebase)</MenuItem>
            <MenuSep />
            <MenuItem onClick={close(syncCur)} disabled={pending}>Sync (Pull, Push)</MenuItem>
            <MenuItem onClick={close(publishOrPush)} disabled={pending}>Push</MenuItem>
            <MenuItem onClick={close(() => notWired("Push To"))}>Push To…</MenuItem>
            <MenuItem onClick={close(forcePushCur)} disabled={pending}>Force Push</MenuItem>
            <MenuSep />
            <MenuItem onClick={close(() => setPrCreateOpen(true))}>Create Pull Request</MenuItem>
            <MenuItem onClick={close(() => setScmTab("prs"))}>View Pull Requests</MenuItem>
          </Popover>
        </div>
      </div>

      {publishOpen && (
        <PublishModal rootPath={rootPath} folder={folder} branch={status?.branch ?? null} onClose={() => setPublishOpen(false)} />
      )}
      {prCreateOpen && <PrCreateModal rootPath={rootPath} onClose={() => setPrCreateOpen(false)} />}
    </div>
  );
}
