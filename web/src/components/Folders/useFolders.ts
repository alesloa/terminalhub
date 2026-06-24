import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { Folder, Workspace } from "../../api/types";

const EMPTY: Folder[] = [];

type Patch = Partial<Pick<Folder, "spaceId" | "name" | "x" | "y">>;

/**
 * Canvas folders data + mutations. The server returns the whole list (ordered by createdAt, stable).
 * `save` patches the cache in place so dragging/renaming a folder never flickers; create/remove and
 * the membership mutations refetch BOTH folders and workspaces (a card joining/leaving a folder flips
 * its workspaces.folderId, which decides whether it renders on the canvas). Everything round-trips
 * through the server so folders survive a refresh and sync across browsers — same model as the cards.
 */
export function useFolders() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["folders"], queryFn: api.folders.list });
  const folders = q.data?.folders ?? EMPTY;
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["folders"] });
    qc.invalidateQueries({ queryKey: ["workspaces"] });
  };

  const patchCache = (id: string, patch: Partial<Folder>) =>
    qc.setQueryData<{ folders: Folder[] }>(["folders"], (d) =>
      d ? { folders: d.folders.map((f) => (f.id === id ? { ...f, ...patch } : f)) } : d);

  // Optimistically flip a card's folderId in the workspaces cache so it leaves/returns to the canvas
  // the instant you drop, before the refetch lands.
  const patchMembership = (workspaceId: string, folderId: string | null) =>
    qc.setQueryData<{ workspaces: Workspace[] }>(["workspaces"], (d) =>
      d ? { ...d, workspaces: d.workspaces.map((w) => (w.id === workspaceId ? { ...w, folderId } : w)) } : d);

  return {
    folders, isLoading: q.isLoading,
    // Group cards into a new folder (drag-to-group / multi-select Group). Members are seeded server-side
    // in one POST; we refetch rather than guess the new folder id, so there's no membership-mismatch
    // window where the folder reads as empty. The round-trip is loopback-fast.
    create: async (b: { spaceId?: string | null; name?: string; x: number; y: number; memberIds?: string[] }) => {
      const { folder } = await api.folders.create(b);
      invalidate();
      return folder;
    },
    save: async (id: string, patch: Patch) => {
      patchCache(id, patch);
      const { folder } = await api.folders.update(id, patch);
      patchCache(id, folder);
      return folder;
    },
    // Drop a card into an existing folder.
    addMember: async (workspaceId: string, folderId: string) => {
      patchMembership(workspaceId, folderId);
      await api.updateWorkspace(workspaceId, { folderId });
      invalidate();
    },
    // Pull a card out of its folder, back onto the canvas at (x, y).
    removeMember: async (workspaceId: string, x: number, y: number) => {
      patchMembership(workspaceId, null);
      await api.updateWorkspace(workspaceId, { folderId: null, x, y });
      invalidate();
    },
    // Dissolve a folder: the server clears its members' folderId (they return to the canvas).
    remove: async (id: string) => {
      qc.setQueryData<{ folders: Folder[] }>(["folders"], (d) =>
        d ? { folders: d.folders.filter((f) => f.id !== id) } : d);
      await api.folders.remove(id);
      invalidate();
    },
  };
}
