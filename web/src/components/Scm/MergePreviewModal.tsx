import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

/**
 * Read-only merge-conflict preview (`git merge-tree`). Shows whether `branch` would merge cleanly
 * into the current branch and, if not, the files that would conflict — without touching the tree.
 * "Merge" hands off to the caller's real merge (the same action as the menu's Merge into Current).
 */
export function MergePreviewModal({ rootPath, branch, currentBranch, onMerge, onClose }:
  { rootPath: string; branch: string; currentBranch: string | null; onMerge: () => void; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["git", "merge-preview", rootPath, branch],
    queryFn: () => api.git.mergePreview(rootPath, branch),
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const conflicted = !!data && !data.clean;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80]" onMouseDown={onClose}>
      <div className="bg-panel w-[480px] max-h-[70vh] rounded-lg p-5 flex flex-col gap-3 border border-edge"
        onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="text-lg">Preview merge</h2>
        <p className="text-sm text-muted">
          Merging <span className="text-fg">{branch}</span> into{" "}
          <span className="text-fg">{currentBranch ?? "the current branch"}</span>. Read-only — nothing changes.
        </p>
        <div className="min-h-[3rem] overflow-auto rounded border border-edge bg-canvas p-3 text-sm">
          {isLoading && <span className="text-dim">checking…</span>}
          {error && <span className="text-red-400">{(error as Error).message}</span>}
          {data?.clean && <span className="text-green-400">✓ Merges cleanly — no conflicts.</span>}
          {conflicted && (
            <div className="flex flex-col gap-1">
              <span className="text-amber-400">
                {data.conflicts.length} file{data.conflicts.length === 1 ? "" : "s"} would conflict:
              </span>
              {data.conflicts.map(f => (
                <span key={f} className="font-mono text-[12px] text-fg truncate">{f}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-1">
          <button onClick={onClose} className="px-3 py-1.5 bg-elevated rounded">Close</button>
          <button onClick={() => { onMerge(); onClose(); }} disabled={isLoading}
            className={`px-3 py-1.5 rounded disabled:opacity-40 ${conflicted ? "bg-amber-700 hover:bg-amber-600" : "bg-blue-600 hover:bg-blue-500"}`}>
            {conflicted ? "Merge anyway" : "Merge into current"}
          </button>
        </div>
      </div>
    </div>
  );
}
