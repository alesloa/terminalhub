import { useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { GitStatus, GitFileEntry } from "../../api/types";
import { useRoom } from "../../store/room";
import { GitGate } from "./GitGate";

const base = (p: string) => p.split("/").pop() || p;
const dir = (p: string) => { const i = p.lastIndexOf("/"); return i > 0 ? p.slice(0, i) : ""; };

export function ScmPanel({ rootPath }: { rootPath: string }) {
  return (
    <GitGate rootPath={rootPath}>
      <ScmBody rootPath={rootPath} />
    </GitGate>
  );
}

function ScmBody({ rootPath }: { rootPath: string }) {
  const qc = useQueryClient();
  const openDiff = useRoom(s => s.openDiff);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [branchOpen, setBranchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const { data: status } = useQuery({
    queryKey: ["git", "status", rootPath],
    queryFn: () => api.git.status(rootPath),
    refetchInterval: 2500,
    refetchIntervalInBackground: true, // keep the changes list fresh while terminalhub is backgrounded
  });
  const { data: branchData } = useQuery({
    queryKey: ["git", "branches", rootPath],
    queryFn: () => api.git.branches(rootPath),
    staleTime: 8000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["git", "status", rootPath] });
    qc.invalidateQueries({ queryKey: ["git", "branches", rootPath] });
    qc.invalidateQueries({ queryKey: ["git", "log", rootPath] });
  };
  // One mutation runs any thunk; per-call onSuccess composes with the shared invalidate.
  const action = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => { setErr(null); invalidate(); },
    onError: (e: Error) => setErr(e.message),
  });
  const run = (fn: () => Promise<unknown>, opts?: { onSuccess?: () => void }) => action.mutate(fn, opts);

  if (!status) return <div className="flex-1 flex items-center justify-center text-xs text-dim">loading…</div>;

  const branchLabel = status.branch ?? (status.detached ? "detached HEAD" : "—");
  const changes = [
    ...status.unstaged.map(e => ({ entry: e, untracked: false })),
    ...status.untracked.map(p => ({ entry: { path: p, index: ".", worktree: "?" } as GitFileEntry, untracked: true })),
  ];
  const canCommit = msg.trim().length > 0 && status.staged.length > 0 && !action.isPending;

  const openFor = (e: GitFileEntry, side: "staged" | "work", untracked: boolean) =>
    openDiff({ file: e.path, name: base(e.path), root: rootPath, staged: side === "staged", untracked });

  return (
    <div className="flex-1 min-h-0 flex flex-col text-sm">
      {/* header: title + overflow menu */}
      <div className="flex items-center justify-between px-3 h-8 shrink-0 text-[11px] tracking-wide text-muted">
        <span>SOURCE CONTROL</span>
        <div className="relative">
          <button title="More actions" onClick={() => setMenuOpen(v => !v)} className="px-1 text-muted hover:text-fg">⋯</button>
          <Popover open={menuOpen} onClose={() => setMenuOpen(false)} className="right-0 top-6 w-44">
            <MenuItem onClick={() => { setMenuOpen(false); run(() => api.git.stashSave(rootPath, "", true)); }}>Stash changes (incl. untracked)</MenuItem>
            <MenuItem onClick={() => { setMenuOpen(false); run(() => api.git.stashPop(rootPath, "stash@{0}")); }}>Pop latest stash</MenuItem>
            <MenuItem onClick={() => { setMenuOpen(false); run(() => api.git.unstageAll(rootPath)); }}>Unstage all</MenuItem>
            <MenuItem onClick={() => { setMenuOpen(false); invalidate(); }}>Refresh</MenuItem>
          </Popover>
        </div>
      </div>

      {/* branch + sync */}
      <div className="flex items-center gap-1 px-2 pb-1.5 shrink-0">
        <div className="relative">
          <button onClick={() => setBranchOpen(v => !v)} title="Switch branch"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-elevated text-fg max-w-[7.5rem]">
            <span className="text-dim">⎇</span><span className="truncate">{branchLabel}</span>
          </button>
          <Popover open={branchOpen} onClose={() => setBranchOpen(false)} className="left-0 top-7 w-52 max-h-64 overflow-auto">
            <MenuItem onClick={() => { setBranchOpen(false); const n = prompt("New branch name"); if (n) run(() => api.git.createBranch(rootPath, n)); }}>
              ＋ Create new branch…
            </MenuItem>
            <div className="my-1 border-t border-edge" />
            {(branchData?.branches ?? []).map(b => (
              <MenuItem key={b.name} onClick={() => { setBranchOpen(false); if (!b.current) run(() => api.git.checkout(rootPath, b.name)); }}>
                <span className={b.current ? "text-blue-400" : ""}>{b.current ? "● " : "  "}{b.name}</span>
              </MenuItem>
            ))}
          </Popover>
        </div>

        <Counts ahead={status.ahead} behind={status.behind} />
        <div className="ml-auto flex items-center gap-0.5">
          <IconBtn title="Fetch" onClick={() => run(() => api.git.fetch(rootPath))}>↻</IconBtn>
          <IconBtn title="Pull (ff-only)" onClick={() => run(() => api.git.pull(rootPath))}>↓</IconBtn>
          <IconBtn title={status.upstream ? "Push" : "Publish branch"}
            onClick={() => run(() => api.git.push(rootPath, !status.upstream))}>↑</IconBtn>
        </div>
      </div>

      {/* commit box */}
      <div className="px-2 pb-2 shrink-0">
        <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={2} placeholder="Message (commits staged changes)"
          className="w-full px-2 py-1 text-sm bg-panel border border-edge rounded outline-none focus:border-blue-500 resize-none" />
        <button disabled={!canCommit} onClick={() => run(() => api.git.commit(rootPath, msg), { onSuccess: () => setMsg("") })}
          className={`mt-1 w-full py-1 rounded text-sm ${canCommit ? "bg-blue-600 hover:bg-blue-500 text-white" : "bg-elevated text-dim cursor-not-allowed"}`}>
          ✓ Commit
        </button>
      </div>

      {err && (
        <div className="mx-2 mb-1 px-2 py-1 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded flex justify-between gap-2">
          <span className="truncate" title={err}>{err}</span>
          <button onClick={() => setErr(null)} className="text-red-300/70 hover:text-red-200">✕</button>
        </div>
      )}

      {/* groups */}
      <div className="flex-1 overflow-auto">
        {status.conflicted.length > 0 && (
          <Group title="Merge Changes" count={status.conflicted.length}>
            {status.conflicted.map(e => (
              <Row key={e.path} entry={e} side="work" badgeChar="U" onOpen={() => openFor(e, "work", false)}
                actions={[{ label: "Stage", glyph: "+", onClick: () => run(() => api.git.stage(rootPath, [e.path])) }]} />
            ))}
          </Group>
        )}

        {status.staged.length > 0 && (
          <Group title="Staged Changes" count={status.staged.length}
            action={{ glyph: "−", title: "Unstage all", onClick: () => run(() => api.git.unstageAll(rootPath)) }}>
            {status.staged.map(e => (
              <Row key={e.path} entry={e} side="staged" badgeChar={e.index} onOpen={() => openFor(e, "staged", false)}
                actions={[{ label: "Unstage", glyph: "−", onClick: () => run(() => api.git.unstage(rootPath, [e.path])) }]} />
            ))}
          </Group>
        )}

        <Group title="Changes" count={changes.length}
          action={changes.length ? { glyph: "+", title: "Stage all changes", onClick: () => run(() => api.git.stageAll(rootPath)) } : undefined}>
          {changes.map(({ entry, untracked }) => (
            <Row key={entry.path} entry={entry} side="work" badgeChar={untracked ? "?" : entry.worktree}
              onOpen={() => openFor(entry, "work", untracked)}
              actions={[
                ...(untracked ? [] : [{ label: "Discard", glyph: "⟲", onClick: () => { if (confirm(`Discard changes to ${base(entry.path)}?`)) run(() => api.git.discard(rootPath, [entry.path])); } }]),
                { label: "Stage", glyph: "+", onClick: () => run(() => api.git.stage(rootPath, [entry.path])) },
              ]} />
          ))}
        </Group>

        {changes.length === 0 && status.staged.length === 0 && status.conflicted.length === 0 && (
          <div className="px-3 py-4 text-xs text-dim">No changes.</div>
        )}
      </div>
    </div>
  );
}

// --- small presentational pieces ---

function Counts({ ahead, behind }: { ahead: number; behind: number }) {
  if (!ahead && !behind) return null;
  return (
    <span className="text-[11px] text-dim tabular-nums flex items-center gap-1">
      {behind > 0 && <span title={`${behind} behind`}>↓{behind}</span>}
      {ahead > 0 && <span title={`${ahead} ahead`}>↑{ahead}</span>}
    </span>
  );
}

function Group({ title, count, action, children }:
  { title: string; count: number; action?: { glyph: string; title: string; onClick: () => void }; children: ReactNode }) {
  return (
    <div className="mb-1">
      <div className="flex items-center justify-between px-3 py-1 text-[11px] tracking-wide text-muted group/hdr">
        <span>{title} <span className="text-dim">{count}</span></span>
        {action && (
          <button title={action.title} onClick={action.onClick}
            className="opacity-0 group-hover/hdr:opacity-100 text-muted hover:text-bright leading-none">{action.glyph}</button>
        )}
      </div>
      {children}
    </div>
  );
}

function Row({ entry, badgeChar, onOpen, actions }:
  { entry: GitFileEntry; side: "staged" | "work"; badgeChar: string; onOpen: () => void;
    actions: { label: string; glyph: string; onClick: () => void }[] }) {
  const b = badge(badgeChar);
  return (
    <div onClick={onOpen} title={entry.path}
      className="group/row flex items-center gap-1 pl-3 pr-2 py-0.5 cursor-pointer hover:bg-surface">
      <span className="truncate text-fg">{base(entry.path)}</span>
      <span className="truncate text-dim text-xs">{dir(entry.path).replace(/^.*\//, "")}</span>
      <span className="ml-auto flex items-center gap-1.5">
        <span className="hidden group-hover/row:flex items-center gap-1.5">
          {actions.map(a => (
            <button key={a.label} title={a.label} onClick={e => { e.stopPropagation(); a.onClick(); }}
              className="text-muted hover:text-bright leading-none">{a.glyph}</button>
          ))}
        </span>
        <span className={`w-3 text-center font-medium ${b.c}`} title={entry.orig ? `${b.label} from ${entry.orig}` : b.label}>{b.t}</span>
      </span>
    </div>
  );
}

function badge(ch: string): { t: string; c: string; label: string } {
  switch (ch) {
    case "M": return { t: "M", c: "text-amber-400", label: "Modified" };
    case "A": return { t: "A", c: "text-green-400", label: "Added" };
    case "D": return { t: "D", c: "text-red-400", label: "Deleted" };
    case "R": return { t: "R", c: "text-blue-400", label: "Renamed" };
    case "C": return { t: "C", c: "text-blue-400", label: "Copied" };
    case "?": return { t: "U", c: "text-green-400", label: "Untracked" };
    case "U": return { t: "!", c: "text-red-400", label: "Conflict" };
    default: return { t: ch || "•", c: "text-muted", label: ch };
  }
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return <button title={title} onClick={onClick} className="w-6 h-6 rounded hover:bg-elevated text-muted hover:text-bright leading-none">{children}</button>;
}

function Popover({ open, onClose, className, children }: { open: boolean; onClose: () => void; className: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className={`absolute z-50 bg-panel border border-edge rounded shadow-lg py-1 text-sm ${className}`}>{children}</div>
    </>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <button onClick={onClick} className="w-full text-left px-3 py-1.5 hover:bg-elevated truncate">{children}</button>;
}
