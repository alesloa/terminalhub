import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { AppNotification } from "../../api/types";

const EMPTY: AppNotification[] = [];

/**
 * Notification-center data + mutations. The list is the durable history the fire path persists, so
 * the bell badge survives a closed browser. A slow poll is a fallback; the real-time bump comes from
 * useNotificationSocket invalidating ["notifications"] the instant a reminder fires.
 */
export function useNotifications() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["notifications"], queryFn: () => api.notifications.list(100), refetchInterval: 60_000 });
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["notifications"] }); };

  return {
    notifications: q.data?.notifications ?? EMPTY,
    unread: q.data?.unread ?? 0,
    isLoading: q.isLoading,
    markRead: async (id: string) => { await api.notifications.markRead(id); invalidate(); },
    markAllRead: async () => { await api.notifications.markAllRead(); invalidate(); },
    remove: async (id: string) => { await api.notifications.remove(id); invalidate(); },
    clear: async () => { await api.notifications.clear(); invalidate(); },
  };
}
