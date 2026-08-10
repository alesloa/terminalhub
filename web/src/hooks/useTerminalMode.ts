import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { TerminalMode } from "../api/types";
import { useToasts } from "../store/toasts";

/** Flip a terminal between the xterm pane and the in-app Claude chat. Shared by every surface that
 *  offers the switch (the pane's segmented control, the terminal row's context menu) so they behave
 *  identically: invalidate the workspaces query on success — the mode lives on the Terminal row, so
 *  the refetch is what re-renders the dock, the list badge and the toggles — and on failure show the
 *  server's own message. A mid-turn switch comes back as a 409 whose `error` says which agent is busy
 *  and what to do about it, so it's surfaced verbatim rather than replaced with a generic line. */
export function useSetTerminalMode() {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  return useMutation({
    mutationFn: ({ id, mode }: { id: string; mode: TerminalMode }) => api.setTerminalMode(id, mode),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
    onError: (e: unknown) => push(e instanceof Error ? e.message : "could not switch mode", { level: "error" }),
  });
}
