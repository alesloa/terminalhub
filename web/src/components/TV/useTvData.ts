import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { TvSource, YtHideInput } from "../../api/types";

// react-query data layer for the TV tool. The catalog is large and effectively static for a day, so it
// gets a long staleTime; radio/youtube are searched live; favorites/recents/settings are small and
// mutated through the helpers returned here (each invalidates its own key on success).

const HOUR = 1000 * 60 * 60;

export function useTvCatalog() {
  return useQuery({
    queryKey: ["tv", "catalog"],
    queryFn: () => api.tv.catalog(),
    staleTime: 24 * HOUR,
    gcTime: 24 * HOUR,
  });
}

export function useTvSettings() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["tv", "settings"], queryFn: () => api.tv.settings() });
  const save = useMutation({
    mutationFn: api.tv.saveSettings,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tv", "settings"] }),
  });
  return { settings: query.data, isLoading: query.isLoading, save };
}

export function useTvFavorites() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["tv", "favorites"], queryFn: () => api.tv.favorites() });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["tv", "favorites"] });
  const add = useMutation({ mutationFn: api.tv.addFavorite, onSuccess: invalidate });
  const remove = useMutation({ mutationFn: api.tv.removeFavorite, onSuccess: invalidate });
  return { favorites: query.data?.favorites ?? [], add, remove };
}

export function useTvRecents() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["tv", "recents"], queryFn: () => api.tv.recents() });
  const record = useMutation({
    mutationFn: api.tv.recordRecent,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tv", "recents"] }),
  });
  return { recents: query.data?.recents ?? [], record };
}

export function useRadioSearch(params: { q?: string; tag?: string; country?: string; limit?: number }, enabled = true) {
  return useQuery({
    queryKey: ["tv", "radio", params],
    queryFn: () => api.tv.radioSearch(params),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useRadioFacets(enabled = true) {
  return useQuery({
    queryKey: ["tv", "radio-facets"],
    queryFn: () => api.tv.radioFacets(),
    enabled,
    staleTime: 24 * HOUR,
  });
}

export function useYouTubeSearch(q: string, enabled = true) {
  const term = q.trim();
  return useQuery({
    queryKey: ["tv", "youtube", term],
    queryFn: () => api.tv.youtubeSearch(term),
    enabled: enabled && term.length > 0,
    retry: false, // a 400 (no_key) shouldn't be retried
    staleTime: 10 * 60 * 1000,
  });
}

export function useYouTubePlaylist(playlistId: string, enabled = true) {
  const id = playlistId.trim();
  return useQuery({
    queryKey: ["tv", "yt-playlist", id],
    queryFn: () => api.tv.youtubePlaylist(id),
    enabled: enabled && id.length > 0,
    retry: false,
    staleTime: 10 * 60 * 1000,
  });
}

export function useYouTubePlaylistInfo(playlistId: string, enabled = true) {
  const id = playlistId.trim();
  return useQuery({
    queryKey: ["tv", "yt-playlist-info", id],
    queryFn: () => api.tv.youtubePlaylistInfo(id),
    enabled: enabled && id.length > 0,
    retry: false,
    staleTime: 60 * 60 * 1000,
  });
}

export function useYouTubeVideo(videoId: string, enabled = true) {
  const id = videoId.trim();
  return useQuery({
    queryKey: ["tv", "yt-video", id],
    queryFn: () => api.tv.youtubeVideo(id),
    enabled: enabled && id.length > 0,
    retry: false,
    staleTime: 60 * 60 * 1000,
  });
}

// --- YouTube persistent deletions ---------------------------------------------------------------
// Two reads (bans are global + cached forever until mutated; per-playlist hides load when a playlist
// is open) and the four mutations, each invalidating the keys it touches. A ban also collapses any
// per-playlist rows server-side, so ban/unban invalidate every yt-hidden query, not just the open one.

export function useYtBans(enabled = true) {
  return useQuery({ queryKey: ["tv", "yt-bans"], queryFn: () => api.tv.ytBans(), enabled, staleTime: Infinity });
}

export function useYtHidden(playlistId: string, enabled = true) {
  const id = playlistId.trim();
  return useQuery({
    queryKey: ["tv", "yt-hidden", id],
    queryFn: () => api.tv.ytHiddenForPlaylist(id),
    enabled: enabled && id.length > 0,
    staleTime: Infinity,
  });
}

export function useYtDeletions() {
  const qc = useQueryClient();
  const invBans = () => qc.invalidateQueries({ queryKey: ["tv", "yt-bans"] });
  const invHidden = (pid: string) => qc.invalidateQueries({ queryKey: ["tv", "yt-hidden", pid] });
  const invAllHidden = () => qc.invalidateQueries({ queryKey: ["tv", "yt-hidden"] });
  const hide = useMutation({
    mutationFn: ({ playlistId, v }: { playlistId: string; v: YtHideInput }) => api.tv.ytHide(playlistId, v),
    onSuccess: (_d, { playlistId }) => invHidden(playlistId),
  });
  const ban = useMutation({
    mutationFn: (v: YtHideInput) => api.tv.ytBan(v),
    onSuccess: () => { invBans(); invAllHidden(); },
  });
  const restore = useMutation({
    mutationFn: ({ playlistId, videoId }: { playlistId: string; videoId: string }) => api.tv.ytRestore(playlistId, videoId),
    onSuccess: (_d, { playlistId }) => invHidden(playlistId),
  });
  const unban = useMutation({ mutationFn: (videoId: string) => api.tv.ytUnban(videoId), onSuccess: invBans });
  return { hide, ban, restore, unban };
}

/** Convenience for the favorite star: is (source, ref) currently favorited, and its row id if so. */
export function favoriteId(
  favorites: { id: string; source: TvSource; ref: string }[],
  source: TvSource,
  ref: string,
): string | null {
  return favorites.find((f) => f.source === source && f.ref === ref)?.id ?? null;
}
