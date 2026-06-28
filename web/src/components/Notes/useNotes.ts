import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { Note, NoteGroup } from "../../api/types";

const EMPTY_NOTES: Note[] = [];
const EMPTY_GROUPS: NoteGroup[] = [];

/**
 * Scratchpad notes + their groups (the Notes panel's left-rail collections). Two small REST lists
 * (notes are tiny, so the list returns full content). `save` patches the notes cache in place rather
 * than refetching so the list doesn't reorder under the user mid-edit — the true updatedAt order is
 * restored on the next full fetch (reopening the panel). Everything else invalidates so other open
 * browsers reconcile on focus. Deleting a group re-homes its notes server-side, so it invalidates
 * BOTH lists (the moved notes' groupId changed).
 */
export function useNotes() {
  const qc = useQueryClient();
  const notesQ = useQuery({ queryKey: ["notes"], queryFn: api.notes.list });
  const groupsQ = useQuery({ queryKey: ["noteGroups"], queryFn: api.noteGroups.list });

  const invalidateNotes = () => { qc.invalidateQueries({ queryKey: ["notes"] }); };
  const invalidateGroups = () => { qc.invalidateQueries({ queryKey: ["noteGroups"] }); };

  const patchNote = (id: string, patch: Partial<Note>) =>
    qc.setQueryData<{ notes: Note[] }>(["notes"], (d) =>
      d ? { notes: d.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) } : d);
  const patchGroup = (id: string, patch: Partial<NoteGroup>) =>
    qc.setQueryData<{ groups: NoteGroup[] }>(["noteGroups"], (d) =>
      d ? { groups: d.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) } : d);

  return {
    notes: notesQ.data?.notes ?? EMPTY_NOTES,
    groups: groupsQ.data?.groups ?? EMPTY_GROUPS,
    isLoading: notesQ.isLoading,

    create: async (b: { title?: string; content?: string; groupId?: string | null } = {}) => {
      const { note } = await api.notes.create(b);
      invalidateNotes();
      return note;
    },
    save: async (id: string, patch: { title?: string; content?: string }) => {
      const { note } = await api.notes.update(id, patch);
      patchNote(id, { title: note.title, content: note.content, updatedAt: note.updatedAt });
      return note;
    },
    // Move a note into a group (or null = ungrouped). Patches the cache so the rail counts + the
    // filtered list update instantly; the note keeps its place until the next full fetch.
    move: async (id: string, groupId: string | null) => {
      patchNote(id, { groupId });
      const { note } = await api.notes.update(id, { groupId });
      return note;
    },
    remove: async (id: string) => { await api.notes.remove(id); invalidateNotes(); },

    createGroup: async (name = "") => { const { group } = await api.noteGroups.create({ name }); invalidateGroups(); return group; },
    renameGroup: async (id: string, name: string) => { patchGroup(id, { name }); const { group } = await api.noteGroups.update(id, { name }); invalidateGroups(); return group; },
    recolorGroup: async (id: string, color: string | null) => { patchGroup(id, { color }); const { group } = await api.noteGroups.update(id, { color }); invalidateGroups(); return group; },
    removeGroup: async (id: string) => { await api.noteGroups.remove(id); invalidateGroups(); invalidateNotes(); },
  };
}
