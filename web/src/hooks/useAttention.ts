import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { AttentionItem } from "../api/types";

/**
 * App-wide poll of which terminals need attention (their agent rang the bell while
 * backgrounded). One network poll regardless of how many components subscribe —
 * react-query dedupes by key. Drives the tab dots, card badges, and toasts.
 */
export function useAttention(): AttentionItem[] {
  const { data } = useQuery({ queryKey: ["attention"], queryFn: api.listAttention, refetchInterval: 2000 });
  return data?.attention ?? [];
}
