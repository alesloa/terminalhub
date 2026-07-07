import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { CloneJob } from "../api/types";

/**
 * Placeholder for an in-flight async clone — a dimmed, inert WorkspaceCard-shaped tile at the spot
 * the finished workspace will land. Not draggable/openable (there's nothing to open yet); the only
 * control is the X: cancel while running (kills the clone, deletes the partial folder — confirmed
 * first), plain dismiss once it has failed. Success needs no action: the job self-expires and the
 * real card appears via the ["workspaces"] invalidate in useCloneJobs.
 */
export function CloningCard({ job }: { job: CloneJob }) {
  const qc = useQueryClient();
  const failed = job.status === "error";
  const cancel = () => {
    if (!failed && !window.confirm("Cancel this clone? The partially downloaded folder will be deleted.")) return;
    api.git.cloneJobs.cancel(job.id).catch(() => {})
      .finally(() => qc.invalidateQueries({ queryKey: ["cloneJobs"] }));
  };
  return (
    <div style={{ position: "absolute", left: job.ws.x, top: job.ws.y }}>
      {/* Same footprint + chrome as WorkspaceCard (w-72 rounded border), dimmed while downloading. */}
      <div className={`relative w-72 rounded-lg border bg-canvas p-3 shadow-lg select-none ${failed ? "border-error/50" : "border-edge opacity-60"}`}>
        <button onClick={cancel} title={failed ? "Dismiss" : "Cancel clone"} aria-label={failed ? "Dismiss failed clone" : "Cancel clone"}
          className="absolute top-[5px] right-[5px] z-10 grid h-[18px] w-[18px] place-items-center rounded-full bg-red-600 text-white opacity-60 shadow-sm ring-1 ring-black/20 transition hover:scale-110 hover:bg-red-500 hover:opacity-100 focus:opacity-100 focus:outline-none active:scale-95">
          <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
        <div className="flex items-center gap-2 pr-5 min-w-0">
          {!failed && (
            <svg width="14" height="14" className="shrink-0 animate-spin motion-reduce:animate-none text-blue-400" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.4" opacity="0.25" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
          )}
          <div className="font-semibold truncate">{job.name}</div>
        </div>
        {failed
          ? <div className="text-xs text-error mt-1 whitespace-pre-wrap break-words max-h-16 overflow-hidden">{job.error}</div>
          : <div className="text-xs text-muted truncate mt-1">Cloning {job.repo ?? job.url}…</div>}
        <div className="text-xs text-dim truncate mt-1">{job.path}</div>
      </div>
    </div>
  );
}
