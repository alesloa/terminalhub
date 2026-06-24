import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ReminderInput } from "../../api/client";
import type { Reminder, ReminderStatus } from "../../api/types";

const EMPTY: Reminder[] = [];

/**
 * Calendar reminders data + mutations. Fetches the full list (reminders are few) and lets the views
 * expand recurrences client-side; every mutation refetches so the grid + the bell badge stay in sync.
 * The server is the source of truth for fire times — we only ever send/patch the stored row.
 */
export function useReminders() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["reminders"], queryFn: () => api.reminders.list() });
  const reminders = q.data?.reminders ?? EMPTY;
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["reminders"] }); };

  return {
    reminders,
    isLoading: q.isLoading,
    create: async (b: ReminderInput) => { const { reminder } = await api.reminders.create(b); invalidate(); return reminder; },
    update: async (id: string, patch: Partial<Omit<ReminderInput, "image">> & { status?: ReminderStatus; image?: string | null }) => {
      const { reminder } = await api.reminders.update(id, patch); invalidate(); return reminder;
    },
    remove: async (id: string) => { await api.reminders.remove(id); invalidate(); },
    snooze: async (id: string, b: { minutes: number } | { until: number }) => { await api.reminders.snooze(id, b); invalidate(); },
  };
}
