import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Link, LinkFolder } from "../api/types";

const EMPTY_LINKS: Link[] = [];
const EMPTY_FOLDERS: LinkFolder[] = [];

/** Data hook for the top-bar Links dropdown: the saved web links + their folders, plus CRUD/reorder
 *  helpers that invalidate the query so every open browser refetches on its next focus (REST +
 *  react-query, like notes — no live WS sync). */
export function useLinks() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["links"], queryFn: api.links.list });
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["links"] }); };
  // Optimistically patch the cached list so an edit (notably a recolor) paints instantly instead of
  // waiting on the refetch; the invalidate that follows the mutation reconciles with the server.
  type Cache = { links: Link[]; folders: LinkFolder[] };
  const patchLink = (id: string, patch: Partial<Link>) =>
    qc.setQueryData<Cache>(["links"], (old) => old ? { ...old, links: old.links.map((l) => l.id === id ? { ...l, ...patch } : l) } : old);
  const patchFolder = (id: string, patch: Partial<LinkFolder>) =>
    qc.setQueryData<Cache>(["links"], (old) => old ? { ...old, folders: old.folders.map((f) => f.id === id ? { ...f, ...patch } : f) } : old);

  return {
    links: q.data?.links ?? EMPTY_LINKS,
    folders: q.data?.folders ?? EMPTY_FOLDERS,
    isLoading: q.isLoading,
    addLink: async (b: { title?: string; url?: string; description?: string; folderId?: string | null }) => {
      const { link } = await api.links.create(b); invalidate(); return link;
    },
    saveLink: async (id: string, patch: { title?: string; url?: string; description?: string; folderId?: string | null; color?: string | null; sort?: number }) => {
      patchLink(id, patch);
      const { link } = await api.links.update(id, patch); invalidate(); return link;
    },
    removeLink: async (id: string) => { await api.links.remove(id); invalidate(); },
    reorderLinks: async (items: { id: string; folderId: string | null; sort: number }[]) => { await api.links.reorder(items); invalidate(); },
    addFolder: async (name: string) => { const { folder } = await api.linkFolders.create({ name }); invalidate(); return folder; },
    saveFolder: async (id: string, patch: { name?: string; color?: string | null; sort?: number }) => { patchFolder(id, patch); const { folder } = await api.linkFolders.update(id, patch); invalidate(); return folder; },
    removeFolder: async (id: string) => { await api.linkFolders.remove(id); invalidate(); },
    reorderFolders: async (items: { id: string; sort: number }[]) => { await api.linkFolders.reorder(items); invalidate(); },
  };
}

/** Prefix a bare host with https:// so a saved "example.com" still opens. Empty stays empty. */
export function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`;
}

/** The bare hostname (sans www.) for display, or the raw string if it doesn't parse as a URL. */
export function hostOf(url: string): string {
  try { return new URL(normalizeUrl(url)).hostname.replace(/^www\./, ""); } catch { return url.trim(); }
}
