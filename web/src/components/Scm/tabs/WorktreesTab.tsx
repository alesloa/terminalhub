import { useLayoutEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../api/client";
import type { GitWorktree } from "../../../api/types";
import { useToasts } from "../../../store/toasts";
import { isLocalHost, revealLabel } from "../../../lib/host";
import { useGit } from "../useGit";
import { useInfiniteList } from "../../../hooks/useInfiniteList";
import { TrashIcon } from "../parts";
import { BranchFilterList } from "../BranchFilterList";
import { FileContextMenu, type FileMenuEntry } from "../FileContextMenu";

/** Linked worktrees: add (＋ header popover: path + branch filter) and remove (hover trash; destructive, double-confirmed). */
export function WorktreesTab({ rootPath }: { rootPath: string }) {
  const { run, pending } = useGit();
  const qc = useQueryClient();
  const push = useToasts(s => s.push);
  const [menu, setMenu] = useState<{ w: GitWorktree; x: number; y: number } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ["git", "worktrees", rootPath],
    queryFn: () => api.git.worktrees(rootPath),
    refetchInterval: 8000,
  });
  const worktrees = data?.worktrees ?? [];
  const { filter, setFilter, scrollRef, onScroll, visible, filtered, hasMore } =
    useInfiniteList(worktrees, w => `${w.branch ?? ""} ${w.path}`);

  // Deletes the linked working directory on disk. Plain remove refuses if it's dirty;
  // only then do we offer --force, behind a second confirm.
  const remove = async (path: string) => {
    if (!confirm(`Remove worktree at ${path}?\n\nThis deletes the linked working directory.`)) return;
    try {
      await api.git.worktreeRemove(rootPath, path);
    } catch (e) {
      if (!confirm(`${(e as Error).message}\n\nForce-remove ${path} anyway? Uncommitted changes there will be lost.`)) return;
      try { await api.git.worktreeRemove(rootPath, path, true); }
      catch (e2) { push((e2 as Error).message); return; }
    }
    qc.invalidateQueries({ queryKey: ["git"] });
  };

  // Reveal-in-file-manager only makes sense when the browser is on the host (loopback) — gated like
  // the rest of the app. There's no "Open in New Window" — Terminal Hub is a browser app, not the OS.
  const items = (w: GitWorktree): FileMenuEntry[] => [
    { label: "Copy Path", onClick: () => navigator.clipboard.writeText(w.path).catch(() => {}) },
    ...(isLocalHost
      ? [{ label: revealLabel, onClick: () => api.revealPath(w.path).catch((e: Error) => push(e.message)) }] as FileMenuEntry[]
      : []),
    "sep",
    { label: "Remove", disabled: w.main, onClick: () => remove(w.path) },
  ];

  return (
    <div className="flex-1 min-h-0 flex flex-col text-sm">
      <div className="flex items-center justify-between px-3 h-7 shrink-0 text-[11px] tracking-wide text-muted">
        <span>WORKTREES <span className="text-dim">{worktrees.length}</span></span>
        <div className="relative">
          <button title="Add worktree" onClick={() => setAddOpen(v => !v)} className="hover:text-bright text-base leading-none">＋</button>
          {addOpen && (
            <WorktreeAddPopover rootPath={rootPath} pending={pending} onClose={() => setAddOpen(false)}
              onAdd={(wp, branch, isNew) => run(() => api.git.worktreeAdd(rootPath, wp, branch, isNew))} />
          )}
        </div>
      </div>
      <div className="px-2 pb-1.5 shrink-0">
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter worktrees…" spellCheck={false}
          className="w-full px-2 py-1 text-xs bg-panel border border-edge rounded outline-none focus:border-blue-500" />
      </div>
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-auto">
        {visible.map(w => {
          const label = w.bare ? "(bare)" : w.detached ? "(detached)" : (w.branch ?? "(unknown)");
          return (
            <div key={w.path} className="group/row flex items-center gap-2 px-3 py-1 hover:bg-surface"
              onContextMenu={e => { e.preventDefault(); setMenu({ w, x: e.clientX, y: e.clientY }); }}>
              <span className="w-3 text-center shrink-0 text-dim">⌥</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 truncate text-fg">
                  {label}
                  {w.main && <span className="text-[10px] text-blue-400">main</span>}
                  {w.locked && <span className="text-[10px] text-amber-400">locked</span>}
                </span>
                <span className="block truncate text-[11px] text-dim">{w.path}</span>
              </span>
              {!w.main && (
                <button title="Remove worktree" onClick={() => remove(w.path)}
                  className="shrink-0 opacity-0 group-hover/row:opacity-100 text-dim hover:text-red-300"><TrashIcon /></button>
              )}
            </div>
          );
        })}
        {hasMore && <div className="px-3 py-1.5 text-center text-[10px] text-dim">scroll for more…</div>}
        {worktrees.length === 0 && <div className="px-3 py-4 text-xs text-dim">No worktrees.</div>}
        {worktrees.length > 0 && filtered.length === 0 && <div className="px-3 py-4 text-xs text-dim">No matching worktrees.</div>}
      </div>

      {menu && <FileContextMenu x={menu.x} y={menu.y} items={items(menu.w)} dismiss={() => setMenu(null)} />}
    </div>
  );
}

/**
 * The Worktrees ＋ popover: a path field on top, then a branch filter (pick an existing branch or
 * create a new one). Choosing a branch runs `git worktree add` at the typed path — replacing the
 * two chained browser prompts. The path is required; picking a branch with an empty path just
 * refocuses it. Flips above the trigger near the viewport bottom, like the other Scm popovers.
 */
function WorktreeAddPopover({ rootPath, onAdd, onClose, pending }: {
  rootPath: string;
  onAdd: (worktreePath: string, branch: string, isNew: boolean) => void;
  onClose: () => void;
  pending?: boolean;
}) {
  const [path, setPath] = useState("");
  const pathRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [flipUp, setFlipUp] = useState(false);
  useLayoutEffect(() => {
    pathRef.current?.focus();
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setFlipUp(r.bottom > window.innerHeight - 8);
  }, []);

  const { data } = useQuery({
    queryKey: ["git", "branches", rootPath],
    queryFn: () => api.git.branches(rootPath),
    staleTime: 8000,
  });
  const branches = data?.branches ?? [];

  const pick = (branch: string, isNew: boolean) => {
    const p = path.trim();
    if (!p) { pathRef.current?.focus(); return; }
    onAdd(p, branch, isNew);
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div ref={wrapRef} style={flipUp ? { top: "auto", bottom: "100%", marginBottom: 4 } : undefined}
        className="absolute z-50 right-0 top-7 w-72 flex flex-col bg-panel border border-edge rounded shadow-lg text-sm">
        <div className="p-1.5 border-b border-edge shrink-0">
          <input ref={pathRef} value={path} onChange={e => setPath(e.target.value)}
            onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }}
            placeholder="Worktree path (absolute or repo-relative)…" spellCheck={false}
            className="w-full px-2 py-1 text-sm bg-panel border border-edge rounded outline-none focus:border-blue-500" />
        </div>
        <div className="px-3 pt-1.5 pb-0.5 text-[10px] tracking-wide text-muted">CHECK OUT BRANCH</div>
        <BranchFilterList branches={branches} pending={pending} autoFocus={false}
          placeholder="Filter or create branch…" onEscape={onClose} onPick={pick} />
      </div>
    </>
  );
}
