import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToasts } from "../../store/toasts";

/**
 * One mutation that runs any git thunk, then refreshes every git query. Errors surface
 * as toasts (git's stderr verbatim) instead of inline boxes. Per-call `onSuccess`/`onError`
 * compose with the shared behaviour, so callers can clear a field or offer a follow-up.
 */
export function useGit() {
  const qc = useQueryClient();
  const push = useToasts(s => s.push);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["git"] });

  const m = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => invalidate(),
    onError: (e: Error) => push(e.message),
  });

  const run = (fn: () => Promise<unknown>, opts?: { onSuccess?: (data: unknown) => void; onError?: (e: Error) => void }) =>
    m.mutate(fn, opts);

  return { run, invalidate, pending: m.isPending };
}
