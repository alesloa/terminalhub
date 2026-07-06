import { copyText } from "../../../lib/clipboard";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../api/client";
import type { GitBranch } from "../../../api/types";
import { useToasts } from "../../../store/toasts";
import { useGit } from "../useGit";
import { useInfiniteList } from "../../../hooks/useInfiniteList";
import { TrashIcon } from "../parts";
import { FileContextMenu, type FileMenuEntry } from "../FileContextMenu";
import { MergePreviewModal } from "../MergePreviewModal";

/** All local branches: checkout (click), create/switch (＋ header picker), delete (hover trash, -d → -D on prompt). */
export function BranchesTab({ rootPath }: { rootPath: string }) {
  const { run, pending } = useGit();
  const qc = useQueryClient();
  const push = useToasts(s => s.push);
  const [menu, setMenu] = useState<{ b: GitBranch; x: number; y: number } | null>(null);
  const [preview, setPreview] = useState<GitBranch | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ["git", "branches", rootPath],
    queryFn: () => api.git.branches(rootPath),
    refetchInterval: 5000,
  });
  const branches = data?.branches ?? [];
  const currentBranch = branches.find(b => b.current)?.name ?? null;
  const { filter, setFilter, scrollRef, onScroll, visible, filtered, hasMore } =
    useInfiniteList(branches, b => (b.upstream ? `${b.name} ${b.upstream}` : b.name));

  const rename = (name: string) => {
    const n = prompt(`Rename branch "${name}" to:`, name)?.trim();
    if (n && n !== name) run(() => api.git.renameBranch(rootPath, name, n));
  };

  // git merge prints its transcript on success (Fast-forward / Merge made …); surface it as a toast.
  // A conflict exits non-zero and useGit already toasts the error (the tree is left mid-merge).
  const doMerge = (name: string) =>
    run(() => api.git.merge(rootPath, name), { onSuccess: (d) => push((d as { message: string }).message) });
  const mergeInto = (name: string) => {
    if (confirm(`Merge "${name}" into the current branch (${currentBranch ?? "HEAD"})?`)) doMerge(name);
  };

  // -d refuses unmerged branches; offer the -D force path only after git says no.
  const del = async (name: string) => {
    if (!confirm(`Delete branch ${name}?`)) return;
    try {
      await api.git.deleteBranch(rootPath, name);
    } catch (e) {
      if (!confirm(`${(e as Error).message}\n\nForce-delete ${name} anyway?`)) return;
      try { await api.git.deleteBranch(rootPath, name, true); }
      catch (e2) { push((e2 as Error).message); return; }
    }
    qc.invalidateQueries({ queryKey: ["git"] });
  };

  const items = (b: GitBranch): FileMenuEntry[] => [
    { label: "Checkout", disabled: b.current, onClick: () => run(() => api.git.checkout(rootPath, b.name)) },
    { label: "Rename Branch…", onClick: () => rename(b.name) },
    "sep",
    { label: "Merge into Current", disabled: b.current, onClick: () => mergeInto(b.name) },
    { label: "Preview Merge…", disabled: b.current, onClick: () => setPreview(b) },
    "sep",
    { label: "Copy Branch Name", onClick: () => copyText(b.name) },
    "sep",
    { label: "Delete Branch", disabled: b.current, onClick: () => del(b.name) },
  ];

  return (
    <div className="flex-1 min-h-0 flex flex-col text-sm">
      <div className="flex items-center justify-between px-3 h-7 shrink-0 text-[11px] tracking-wide text-muted">
        <span>BRANCHES <span className="text-dim">{branches.length}</span></span>
        <div className="relative">
          <button title="Create new branch" onClick={() => setPickerOpen(v => !v)}
            className="hover:text-bright text-base leading-none">＋</button>
          {pickerOpen && (
            <CreateBranchPopover pending={pending}
              onCreate={name => run(() => api.git.createBranch(rootPath, name))}
              onClose={() => setPickerOpen(false)} />
          )}
        </div>
      </div>
      <div className="px-2 pb-1.5 shrink-0">
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter branches…" spellCheck={false}
          className="w-full px-2 py-1 text-xs bg-panel border border-edge rounded outline-none focus:border-blue-500" />
      </div>
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-auto">
        {visible.map(b => (
          <div key={b.name} className="group/row flex items-center gap-2 px-3 py-1 hover:bg-surface cursor-pointer"
            onContextMenu={e => { e.preventDefault(); setMenu({ b, x: e.clientX, y: e.clientY }); }}>
            <span className={`w-3 text-center shrink-0 ${b.current ? "text-blue-400" : "text-dim"}`}>{b.current ? "●" : "⎇"}</span>
            <button onClick={() => { if (!b.current) run(() => api.git.checkout(rootPath, b.name)); }} disabled={b.current}
              title={b.upstream ? `tracks ${b.upstream}` : "no upstream"}
              className={`min-w-0 flex-1 text-left truncate ${b.current ? "text-blue-400" : "text-fg hover:underline"}`}>
              {b.name}
            </button>
            {b.upstream && <span className="shrink-0 text-[10px] text-dim truncate max-w-[7rem]">{b.upstream}</span>}
            {!b.current && (
              <button title="Delete branch" onClick={() => del(b.name)}
                className="shrink-0 opacity-0 group-hover/row:opacity-100 text-dim hover:text-red-300"><TrashIcon /></button>
            )}
          </div>
        ))}
        {hasMore && <div className="px-3 py-1.5 text-center text-[10px] text-dim">scroll for more…</div>}
        {branches.length === 0 && <div className="px-3 py-4 text-xs text-dim">No branches.</div>}
        {branches.length > 0 && filtered.length === 0 && <div className="px-3 py-4 text-xs text-dim">No matching branches.</div>}
      </div>

      {menu && <FileContextMenu x={menu.x} y={menu.y} items={items(menu.b)} dismiss={() => setMenu(null)} />}
      {preview && (
        <MergePreviewModal rootPath={rootPath} branch={preview.name} currentBranch={currentBranch}
          onMerge={() => doMerge(preview.name)} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}

/** The Branches ＋ popover: just a name field to create a new branch (switching is the list below).
 *  Enter creates, Esc / click-away closes — no dropdown, no browser prompt. */
function CreateBranchPopover({ onCreate, onClose, pending }: {
  onCreate: (name: string) => void;
  onClose: () => void;
  pending?: boolean;
}) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const submit = () => { const n = name.trim(); if (n) { onCreate(n); onClose(); } };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute z-50 right-0 top-7 w-60 bg-panel border border-edge rounded shadow-lg p-2">
        <input ref={inputRef} value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") { e.preventDefault(); submit(); }
            else if (e.key === "Escape") { e.preventDefault(); onClose(); }
          }}
          placeholder="New branch name…" spellCheck={false}
          className="w-full px-2 py-1 text-sm bg-panel border border-edge rounded outline-none focus:border-blue-500" />
        <button onClick={submit} disabled={!name.trim() || pending}
          className={`mt-1.5 w-full py-1 rounded text-sm ${name.trim() && !pending ? "bg-blue-600 hover:bg-blue-500 text-white" : "bg-elevated text-dim cursor-not-allowed"}`}>
          Create branch
        </button>
      </div>
    </>
  );
}
