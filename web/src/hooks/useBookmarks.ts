import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Bookmark } from "../api/types";

/**
 * Bookmarks for one workspace (folder), shared by the editor gutter and the Bookmarks panel.
 * react-query dedups the GET by key, so every editor tab + the panel share a single fetch.
 */
export function useBookmarks(workspaceId: string) {
  const qc = useQueryClient();
  const key = ["bookmarks", workspaceId];
  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const q = useQuery({
    queryKey: key,
    queryFn: () => api.bookmarks.list(workspaceId),
    enabled: !!workspaceId,
  });
  const bookmarks = useMemo(() => q.data?.bookmarks ?? [], [q.data]);

  const create = useMutation({
    mutationFn: (b: { filePath: string; line: number; label?: string | null; preview?: string | null }) =>
      api.bookmarks.create(workspaceId, b),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: (v: { id: string; patch: { label?: string | null; line?: number } }) => api.bookmarks.update(v.id, v.patch),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.bookmarks.remove(id),
    onSuccess: invalidate,
  });
  const clearFile = useMutation({
    mutationFn: (filePath: string) => api.bookmarks.clearFile(workspaceId, filePath),
    onSuccess: invalidate,
  });
  const clearAll = useMutation({
    mutationFn: () => api.bookmarks.clearAll(workspaceId),
    onSuccess: invalidate,
  });

  /** Toggle a plain bookmark at a line: remove if one exists there, else create with a preview. */
  const toggle = (filePath: string, line: number, preview?: string | null) => {
    const existing = bookmarks.find(b => b.filePath === filePath && b.line === line);
    if (existing) remove.mutate(existing.id);
    else create.mutate({ filePath, line, preview: preview ?? null });
  };

  return { bookmarks, isLoading: q.isLoading, create, update, remove, clearFile, clearAll, toggle, invalidate };
}

/** Next/previous bookmark relative to (filePath, line), across all files, wrapping at the ends. */
export function neighborBookmark(
  bookmarks: Bookmark[],
  from: { filePath: string; line: number },
  dir: 1 | -1,
): Bookmark | null {
  if (bookmarks.length === 0) return null;
  const sorted = [...bookmarks].sort((a, b) => (a.filePath === b.filePath ? a.line - b.line : a.filePath < b.filePath ? -1 : 1));
  const after = (b: Bookmark) => b.filePath > from.filePath || (b.filePath === from.filePath && b.line > from.line);
  const before = (b: Bookmark) => b.filePath < from.filePath || (b.filePath === from.filePath && b.line < from.line);
  if (dir === 1) return sorted.find(after) ?? sorted[0];
  return [...sorted].reverse().find(before) ?? sorted[sorted.length - 1];
}
