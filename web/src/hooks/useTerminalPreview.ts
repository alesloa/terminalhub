import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

// Polls a terminal's visible-screen capture for the Stage Manager thumbnail. `enabled` should be
// false when the tile/dock is hidden so we don't poll uselessly. ~2s cadence — faster than the 5s
// workspaces poll, since this is the "live thumbnail", but still cheap (one capture-pane per tick).
export function useTerminalPreview(terminalId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["terminalPreview", terminalId],
    queryFn: () => api.terminalPreview(terminalId as string),
    enabled: enabled && !!terminalId,
    refetchInterval: enabled && terminalId ? 2000 : false,
    refetchOnWindowFocus: false,
    staleTime: 1500,
  });
}
