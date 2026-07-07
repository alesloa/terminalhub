import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { CloneJob } from "../api/types";

/**
 * Live view of the server's async clone jobs. Polls fast (1s) while anything is listed so the
 * placeholder card's state stays fresh, and idles at 5s otherwise. When a watched job finishes
 * (flips to done, or vanishes after running — it completed and expired between polls), the server
 * has already created the workspace row, so invalidate ["workspaces"] to swap in the real card.
 */
export function useCloneJobs(): CloneJob[] {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["cloneJobs"],
    queryFn: () => api.git.cloneJobs.list(),
    refetchInterval: (q) => ((q.state.data?.jobs.length ?? 0) > 0 ? 1000 : 5000),
  });
  const jobs = data?.jobs ?? [];
  const prev = useRef<Map<string, CloneJob["status"]>>(new Map());
  useEffect(() => {
    const cur = new Map(jobs.map(j => [j.id, j.status] as const));
    for (const [id, status] of prev.current) {
      const now = cur.get(id);
      if (status === "running" && (now === "done" || now === undefined)) {
        qc.invalidateQueries({ queryKey: ["workspaces"] });
        break;
      }
    }
    prev.current = cur;
  }, [jobs, qc]);
  return jobs;
}
