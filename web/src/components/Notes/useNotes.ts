import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { Note } from "../../api/types";

const EMPTY: Note[] = [];

/**
 * Scratchpad notes data + mutations. The server returns the full list (notes are small). Create
 * and delete refetch; `save` patches the cache in place instead of refetching so the list doesn't
 * reorder under the user mid-edit — the true updatedAt order is restored on the next full fetch
 * (reopening the panel). The save round-trips through the server so edits survive a refresh.
 */
export function useNotes() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["notes"], queryFn: api.notes.list });
  const notes = q.data?.notes ?? EMPTY;
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["notes"] }); };

  const patchCache = (id: string, patch: Partial<Note>) =>
    qc.setQueryData<{ notes: Note[] }>(["notes"], (d) =>
      d ? { notes: d.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) } : d);

  return {
    notes, isLoading: q.isLoading,
    create: async (title = "", content = "") => {
      const { note } = await api.notes.create({ title, content });
      invalidate();
      return note;
    },
    save: async (id: string, patch: { title?: string; content?: string }) => {
      const { note } = await api.notes.update(id, patch);
      patchCache(id, { title: note.title, content: note.content, updatedAt: note.updatedAt });
      return note;
    },
    remove: async (id: string) => { await api.notes.remove(id); invalidate(); },
  };
}
