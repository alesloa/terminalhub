import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { StickyNote } from "../../api/types";

const EMPTY: StickyNote[] = [];

type Patch = Partial<Pick<StickyNote, "spaceId" | "content" | "color" | "x" | "y" | "w" | "h" | "pinned">>;

/**
 * Canvas sticky-notes data + mutations. The server returns the whole list (notes are small, ordered
 * by createdAt so the order is stable). `save` patches the cache in place instead of refetching, so
 * dragging/resizing/typing a note never reorders the list or flickers; create and delete refetch.
 * Everything round-trips through the server so notes survive a refresh and sync over the tunnel.
 */
export function useStickyNotes() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["stickyNotes"], queryFn: api.stickyNotes.list });
  const notes = q.data?.stickyNotes ?? EMPTY;
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["stickyNotes"] }); };

  const patchCache = (id: string, patch: Partial<StickyNote>) =>
    qc.setQueryData<{ stickyNotes: StickyNote[] }>(["stickyNotes"], (d) =>
      d ? { stickyNotes: d.stickyNotes.map((n) => (n.id === id ? { ...n, ...patch } : n)) } : d);

  return {
    notes, isLoading: q.isLoading,
    create: async (b: { spaceId?: string | null; color?: string | null; x: number; y: number; w: number; h: number }) => {
      const { stickyNote } = await api.stickyNotes.create(b);
      invalidate();
      return stickyNote;
    },
    save: async (id: string, patch: Patch) => {
      // Optimistic: paint the change immediately, then reconcile with the server's row.
      patchCache(id, patch);
      const { stickyNote } = await api.stickyNotes.update(id, patch);
      patchCache(id, stickyNote);
      return stickyNote;
    },
    remove: async (id: string) => {
      // Optimistic: drop it from the cache so it vanishes on click, then confirm with the server.
      qc.setQueryData<{ stickyNotes: StickyNote[] }>(["stickyNotes"], (d) =>
        d ? { stickyNotes: d.stickyNotes.filter((n) => n.id !== id) } : d);
      await api.stickyNotes.remove(id);
      invalidate();
    },
  };
}
