import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { TimeEntry } from "../../api/types";

const EMPTY: TimeEntry[] = [];

/**
 * Timesheet entries for a visible [from,to) range. The server also returns any still-running entry
 * regardless of range, so a live timer is always present. Mutations invalidate the range query (and
 * the catalog, since start/create auto-add unknown names). Polls every 30s so an agent-started timer
 * appearing in another browser/tab shows up without a manual refresh.
 */
export function useTimeSheet(from: number, to: number) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["time", "entries", from, to],
    queryFn: () => api.time.entries(from, to),
    refetchInterval: 30_000,
  });
  const entries = q.data?.entries ?? EMPTY;
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["time", "entries"] });
    qc.invalidateQueries({ queryKey: ["time", "catalog"] });
  };

  return {
    entries,
    isLoading: q.isLoading,
    start: async (b: { client: string; project?: string; task?: string; notes?: string }) => {
      const { entry } = await api.time.start(b);
      invalidate();
      return entry;
    },
    stop: async (b: { id?: string; client?: string } = {}) => {
      await api.time.stop(b);
      invalidate();
    },
    add: async (b: { client: string; project?: string; task?: string; notes?: string; startedAt: number; stoppedAt?: number | null }) => {
      const { entry } = await api.time.create(b);
      invalidate();
      return entry;
    },
    save: async (id: string, patch: { client?: string; project?: string; task?: string; notes?: string; startedAt?: number; stoppedAt?: number | null }) => {
      const { entry } = await api.time.update(id, patch);
      invalidate();
      return entry;
    },
    remove: async (id: string) => { await api.time.remove(id); invalidate(); },
  };
}
