import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { TunnelStatus } from "../../api/types";

const KEY = ["tunnel"];

// Owner-only public-tunnel control. Polls ONLY while cloudflared is spinning up ("starting"); once it's
// running / idle / error there's nothing to watch, so polling stops. Mutations write the returned status
// straight into the cache so the UI flips immediately without waiting for a refetch.
export function useTunnel() {
  const qc = useQueryClient();
  const set = (s: TunnelStatus) => qc.setQueryData(KEY, s);
  const q = useQuery({
    queryKey: KEY,
    queryFn: api.tunnel.status,
    refetchInterval: (query) => (query.state.data?.status === "starting" ? 1500 : false),
  });
  const start = useMutation({ mutationFn: (port: number) => api.tunnel.start(port), onSuccess: set });
  const stop = useMutation({ mutationFn: api.tunnel.stop, onSuccess: set });
  return { status: (q.data ?? { status: "idle" }) as TunnelStatus, start, stop };
}
