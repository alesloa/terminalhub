import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { basename } from "../../lib/paths";
import type { Favorite, FavoriteGroup, Workspace } from "../../api/types";

const EMPTY_GROUPS: FavoriteGroup[] = [];
const EMPTY_FAVS: Favorite[] = [];

/** Group rows by their bucket key (parentId/groupId, null → "root") and order each bucket. */
function bucketize<T extends { position: number }>(rows: T[], key: (r: T) => string | null): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r) ?? "root";
    let arr = m.get(k);
    if (!arr) { arr = []; m.set(k, arr); }
    arr.push(r);
  }
  for (const arr of m.values()) arr.sort((a, b) => a.position - b.position);
  return m;
}

/**
 * Favorites data + mutations. The server returns flat groups + favorites; we index them by
 * bucket once per data change so the recursive tree render is O(1) lookups, and expose thin
 * mutation wrappers that refetch on success.
 */
export function useFavorites() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["favorites"], queryFn: api.favorites.list });
  const groups = q.data?.groups ?? EMPTY_GROUPS;
  const favorites = q.data?.favorites ?? EMPTY_FAVS;
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["favorites"] }); };

  const groupsByParent = useMemo(() => bucketize(groups, g => g.parentId), [groups]);
  const favsByGroup = useMemo(() => bucketize(favorites, f => f.groupId), [favorites]);
  const childGroups = (parentId: string | null) => groupsByParent.get(parentId ?? "root") ?? EMPTY_GROUPS;
  const bucketFavorites = (groupId: string | null) => favsByGroup.get(groupId ?? "root") ?? EMPTY_FAVS;

  // Activate = drop/focus the workspace CARD on the canvas. It NEVER opens the room — the user
  // presses Open on the card. If a card for this folder already exists we leave it as-is.
  const activate = async (fav: Favorite) => {
    const cached = qc.getQueryData<{ workspaces: Workspace[] }>(["workspaces"]);
    const list = cached?.workspaces ?? (await api.listWorkspaces()).workspaces;
    if (!list.some(w => w.folder === fav.folder)) {
      await api.createWorkspace({ name: fav.label ?? basename(fav.folder), folder: fav.folder });
      qc.invalidateQueries({ queryKey: ["workspaces"] });
    }
  };

  return {
    groups, favorites, isLoading: q.isLoading,
    childGroups, bucketFavorites, activate,
    createGroup: (name: string, parentId: string | null = null) => api.favorites.createGroup(name, parentId).then(invalidate),
    renameGroup: (id: string, name: string) => api.favorites.renameGroup(id, name).then(invalidate),
    deleteGroup: (id: string, reassignTo?: string | null) => api.favorites.deleteGroup(id, reassignTo).then(invalidate),
    addFavorite: (folder: string, groupId: string | null = null, label?: string | null) => api.favorites.create(folder, groupId, label).then(invalidate),
    renameFavorite: (id: string, label: string | null) => api.favorites.rename(id, label).then(invalidate),
    removeFavorite: (id: string) => api.favorites.remove(id).then(invalidate),
    // Server validates cyclic group moves (400); on any failure we just refetch the true state.
    move: (kind: "favorite" | "group", id: string, targetParentId: string | null, index: number) =>
      api.favorites.move(kind, id, targetParentId, index).then(invalidate).catch(invalidate),
  };
}

export type FavoritesApi = ReturnType<typeof useFavorites>;

export type GroupOption = { id: string; name: string; depth: number };

/** Flatten the favorites groups (depth-first) into an indented list — every group an "add to
 *  favorites" menu can drop a folder into. Shared by the Browse panel and the workspace-card menu. */
export function flattenGroups(fav: FavoritesApi, parentId: string | null = null, depth = 0): GroupOption[] {
  return fav.childGroups(parentId).flatMap((g) => [
    { id: g.id, name: g.name, depth },
    ...flattenGroups(fav, g.id, depth + 1),
  ]);
}
