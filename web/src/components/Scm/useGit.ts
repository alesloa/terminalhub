import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToasts } from "../../store/toasts";

/**
 * One mutation that runs any git thunk, then refreshes every git query. A per-call `onSuccess`
 * composes with the shared invalidate. A per-call `onError` REPLACES the default toast, so a caller
 * can fully own the failure — e.g. the git header turning a diverged-push error into a toast that
 * carries a Force Push button. With no `onError`, the default surfaces git's stderr verbatim.
 */
export function useGit() {
  const qc = useQueryClient();
  const push = useToasts(s => s.push);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["git"] });

  const m = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => invalidate(),
  });

  const run = (fn: () => Promise<unknown>, opts?: { onSuccess?: (data: unknown) => void; onError?: (e: Error) => void }) =>
    m.mutate(fn, { onSuccess: opts?.onSuccess, onError: opts?.onError ?? ((e: Error) => push(e.message)) });

  return { run, invalidate, pending: m.isPending };
}
