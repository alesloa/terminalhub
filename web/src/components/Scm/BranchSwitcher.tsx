import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useGit } from "./useGit";
import { BranchPicker } from "./BranchPicker";

/**
 * A compact `⎇ branch ▾` chip for the room header: shows the current branch and, on click,
 * a menu to switch to another branch or create a new one. Self-contained — gates on
 * `git.info` so it renders nothing for non-repo folders, and leans on `useGit` to refresh
 * every git query after a checkout/create. Mirrors the switcher in the Source Control panel.
 */
export function BranchSwitcher({ rootPath }: { rootPath: string }) {
  const { run, pending } = useGit();
  const [open, setOpen] = useState(false);

  const { data: info } = useQuery({
    queryKey: ["git", "info", rootPath],
    queryFn: () => api.git.info(rootPath),
    refetchInterval: 10_000,
  });
  const isRepo = !!info?.isRepo;

  const { data: status } = useQuery({
    queryKey: ["git", "status", rootPath],
    queryFn: () => api.git.status(rootPath),
    refetchInterval: 2500,
    enabled: isRepo,
  });
  const { data: branchData } = useQuery({
    queryKey: ["git", "branches", rootPath],
    queryFn: () => api.git.branches(rootPath),
    staleTime: 8000,
    enabled: isRepo,
  });

  if (!isRepo) return null;

  const label = status?.branch ?? (status?.detached ? "detached HEAD" : "—");
  const branches = branchData?.branches ?? [];

  return (
    // Stop pointer-down here so clicking the chip never starts a window drag (the header bar
    // doubles as the drag handle when the room is floating).
    <div className="relative shrink-0" onPointerDown={e => e.stopPropagation()}>
      <button onClick={() => setOpen(v => !v)} title="Switch branch"
        className="flex items-center gap-1 px-1.5 h-5 rounded text-xs peacock-btn text-fg max-w-[12rem]">
        <span className="text-dim leading-none">⎇</span>
        <span className="truncate">{label}</span>
        <span className="text-dim leading-none -translate-y-px">▾</span>
      </button>
      {open && (
        <BranchPicker branches={branches} pending={pending} showSearch
          onCheckout={name => run(() => api.git.checkout(rootPath, name))}
          onCreate={name => run(() => api.git.createBranch(rootPath, name))}
          onClose={() => setOpen(false)} className="left-0 top-7 w-64" />
      )}
    </div>
  );
}
