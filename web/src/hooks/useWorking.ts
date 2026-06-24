import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { WorkingItem } from "../api/types";

/**
 * App-wide poll of which terminals' agents are actively working (thinking / streaming) right now.
 * Distinct from useAttention (the bell-based "needs you" state): this drives the card's moving
 * working glow and the blue terminal dots. One poll regardless of subscribers — react-query dedupes
 * by key. The server only samples panes while this poll is running, so it costs nothing when the
 * canvas isn't open.
 */
export function useWorking(): WorkingItem[] {
  const { data } = useQuery({ queryKey: ["working"], queryFn: api.listWorking, refetchInterval: 1500 });
  return data?.working ?? [];
}
