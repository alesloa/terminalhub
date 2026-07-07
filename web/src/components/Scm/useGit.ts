import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToasts } from "../../store/toasts";

/**
 * One mutation that runs any git thunk, then refreshes every git query. A per-call `onSuccess`
 * composes with the shared invalidate. A per-call `onError` REPLACES the default toast, so a caller
 * can fully own the failure — e.g. the git header turning a diverged-push error into a toast that
 * carries a Force Push button. With no `onError`, the default surfaces git's stderr verbatim.
 *
 * `optimistic` runs synchronously BEFORE the request and returns a rollback. It's for ops whose UI
 * would otherwise sit frozen while a slow, per-repo-serialized git command round-trips (Stage All on
 * a big repo): flip the cache now, let the shared invalidate reconcile to real git on success, and
 * roll back + refetch if it fails. react-query's per-call `mutate` has no `onMutate`, so we apply it
 * here instead.
 */
export function useGit() {
  const qc = useQueryClient();
  const push = useToasts(s => s.push);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["git"] });

  const m = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => invalidate(),
  });

  const run = (
    fn: () => Promise<unknown>,
    opts?: { onSuccess?: (data: unknown) => void; onError?: (e: Error) => void; optimistic?: () => () => void },
  ) => {
    const rollback = opts?.optimistic?.();
    m.mutate(fn, {
      onSuccess: opts?.onSuccess,
      onError: (e: Error) => {
        rollback?.();       // undo the optimistic flip…
        invalidate();       // …then refetch so the checkboxes match real git, not our guess.
        (opts?.onError ?? ((err: Error) => push(err.message)))(e);
      },
    });
  };

  return { run, invalidate, pending: m.isPending };
}
