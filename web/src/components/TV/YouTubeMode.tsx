import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import type { YouTubeItem, TvFavorite } from "../../api/types";
import { useTv, type TvMode } from "./store";
import {
  useYouTubeSearch, useYouTubePlaylist, useYouTubePlaylistInfo, useYouTubeVideo,
  useTvFavorites, useTvRecents, favoriteId,
} from "./useTvData";
import { parseYouTubeInput } from "./youtube";
import { useYouTubePlayer } from "./useYouTubePlayer";
import { TransportBar, type NowPlaying } from "./TransportBar";
import { StatusBar, type StatusStat } from "./StatusBar";
import { SearchIcon, TvIcon, RadioIcon, YouTubeIcon, BarsIcon, PlaylistIcon, StarIcon, CloseIcon } from "./icons";

interface Props {
  hasKey: boolean;
  onOpenSettings: () => void;
}

const AUTOPLAY_KEY = "tr.ytAutoplay";

function blockedReason(code: number): string {
  if (code === 100) return "It was removed or made private.";
  if (code === 101 || code === 150) return "The owner disabled playback on other sites.";
  return "It can't be played here.";
}

function favToItem(f: TvFavorite): YouTubeItem {
  return { videoId: f.ref, title: f.name, channelTitle: "", thumbnail: f.logo ?? "", publishedAt: "" };
}

/** YouTube tab: a real IFrame-API player driven by the app transport bar. The box does double duty —
 *  search the Data API, or paste a video/playlist link to play it directly. A pasted (or saved) playlist
 *  autoplays in order; un-embeddable / removed videos are detected and skipped (capped). Needs a
 *  server-side API key; without one it points the user at TV settings. */
export function YouTubeMode({ hasKey, onOpenSettings }: Props) {
  const { mode, setMode, video, playVideo, playing, volume, muted, togglePlay, setPlaying, setVolume, toggleMute } = useTv();
  const { favorites, add, remove } = useTvFavorites();
  const { record } = useTvRecents();

  const [tab, setTab] = useState<"browse" | "saved">("browse");
  const [box, setBox] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [autoplay, setAutoplay] = useState(() => { try { return localStorage.getItem(AUTOPLAY_KEY) !== "0"; } catch { return true; } });
  const toggleAutoplay = () => setAutoplay((a) => { const n = !a; try { localStorage.setItem(AUTOPLAY_KEY, n ? "1" : "0"); } catch { /* blocked */ } return n; });

  const parsed = useMemo(() => parseYouTubeInput(submitted), [submitted]);
  const searchTerm = parsed.kind === "search" ? parsed.query : "";
  const playlistId = parsed.kind === "playlist" ? parsed.playlistId : "";
  const directVideoId = parsed.kind === "video" ? parsed.videoId : "";
  const isSearch = parsed.kind === "search" && searchTerm.length > 0;
  const isPlaylist = parsed.kind === "playlist";
  const isVideo = parsed.kind === "video";

  const searchQ = useYouTubeSearch(searchTerm, hasKey && isSearch);
  const playlistQ = useYouTubePlaylist(playlistId, hasKey && isPlaylist);
  const infoQ = useYouTubePlaylistInfo(playlistId, hasKey && isPlaylist);
  const videoQ = useYouTubeVideo(directVideoId, hasKey && isVideo);

  // Playlist pagination: page 1 comes from react-query; "Load more" appends later pages into local state.
  const [morePages, setMorePages] = useState<YouTubeItem[]>([]);
  const [moreToken, setMoreToken] = useState<string | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => { setMorePages([]); setMoreToken(undefined); }, [playlistId]);
  useEffect(() => { if (playlistQ.data) setMoreToken(playlistQ.data.nextPageToken); }, [playlistQ.data]);
  const loadMore = async () => {
    if (!moreToken || loadingMore || !isPlaylist) return;
    setLoadingMore(true);
    try {
      const r = await api.tv.youtubePlaylist(playlistId, moreToken);
      setMorePages((p) => [...p, ...r.items]);
      setMoreToken(r.nextPageToken);
    } catch { /* leave the list as-is on a failed page */ } finally { setLoadingMore(false); }
  };

  // Session-only hidden set (remove-from-list); cleared on reload, never persisted.
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const hiddenRef = useRef(hidden); hiddenRef.current = hidden;
  const hide = (id: string) => setHidden((s) => { const n = new Set(s); n.add(id); return n; });

  const rawList: YouTubeItem[] = useMemo(() => {
    if (isSearch) return searchQ.data?.items ?? [];
    if (isPlaylist) return [...(playlistQ.data?.items ?? []), ...morePages];
    if (isVideo) return videoQ.data?.item ? [videoQ.data.item] : [];
    return [];
  }, [isSearch, isPlaylist, isVideo, searchQ.data, playlistQ.data, morePages, videoQ.data]);
  const list = useMemo(() => rawList.filter((it) => !hidden.has(it.videoId)), [rawList, hidden]);

  // The playback queue (a snapshot of the list the current video was started from) + its index. Refs
  // mirror them so the player callbacks (created once) always advance against the latest queue.
  const [queue, setQueue] = useState<YouTubeItem[]>([]);
  const [queueIdx, setQueueIdx] = useState(-1);
  const queueRef = useRef(queue); queueRef.current = queue;
  const idxRef = useRef(queueIdx); idxRef.current = queueIdx;

  const [blocked, setBlocked] = useState<{ id: string; code: number } | null>(null);
  const skipsRef = useRef(0);
  const autoplayRef = useRef(autoplay); autoplayRef.current = autoplay;

  const playFrom = useCallback((items: YouTubeItem[], idx: number) => {
    const v = items[idx];
    if (!v) return;
    setQueue(items);
    setQueueIdx(idx);
    playVideo(v);
    record.mutate({ source: "youtube", ref: v.videoId, name: v.title, logo: v.thumbnail });
    skipsRef.current = 0;
    setBlocked(null);
  }, [playVideo, record]);

  const advance = useCallback((delta: number) => {
    const q = queueRef.current;
    if (!q.length) return;
    let i = idxRef.current + delta;
    while (i >= 0 && i < q.length && hiddenRef.current.has(q[i].videoId)) i += delta;
    if (i < 0 || i >= q.length) return;
    playFrom(q, i);
  }, [playFrom]);

  const handleEnded = useCallback(() => { if (autoplayRef.current) advance(1); }, [advance]);
  const handlePlaying = useCallback(() => { skipsRef.current = 0; setBlocked(null); }, []);
  const handleError = useCallback((code: number) => {
    const cur = queueRef.current[idxRef.current];
    setBlocked({ id: cur?.videoId ?? "", code });
    // Auto-skip past a dead/un-embeddable video, but cap consecutive skips so a fully-blocked list
    // doesn't walk the whole queue in a flash.
    if (autoplayRef.current && skipsRef.current < Math.min(queueRef.current.length, 8)) {
      skipsRef.current += 1;
      advance(1);
    }
  }, [advance]);

  const stageRef = useRef<HTMLDivElement>(null);
  useYouTubePlayer({
    hostRef: stageRef,
    videoId: video?.videoId ?? null,
    playing, volume, muted,
    onEnded: handleEnded,
    onError: handleError,
    onPlaying: handlePlaying,
    setPlaying,
  });

  // Paste-a-link autoplay: when a freshly-submitted video/playlist resolves, start it. Search results
  // are NOT auto-played — the user picks one. `autoKeyRef` guards against replaying on every re-render.
  const autoKeyRef = useRef("");
  useEffect(() => {
    if (!submitted || !hasKey || autoKeyRef.current === submitted) return;
    if (isVideo && videoQ.data?.item) {
      autoKeyRef.current = submitted;
      playFrom([videoQ.data.item], 0);
    } else if (isPlaylist && (playlistQ.data?.items?.length ?? 0) > 0) {
      autoKeyRef.current = submitted;
      playFrom((playlistQ.data?.items ?? []).filter((it) => !hiddenRef.current.has(it.videoId)), 0);
    }
  }, [submitted, hasKey, isVideo, isPlaylist, videoQ.data, playlistQ.data, playFrom]);

  const submit = (e: React.FormEvent) => { e.preventDefault(); setSubmitted(box.trim()); };

  const toggleSaveVideo = (it: YouTubeItem) => {
    const fid = favoriteId(favorites, "youtube", it.videoId);
    if (fid) remove.mutate(fid);
    else add.mutate({ source: "youtube", ref: it.videoId, name: it.title, logo: it.thumbnail, meta: null });
  };

  const info = infoQ.data?.info ?? null;
  const savedPlaylistRow = isPlaylist ? favoriteId(favorites, "youtube", playlistId) : null;
  const toggleSavePlaylist = () => {
    if (!isPlaylist) return;
    if (savedPlaylistRow) { remove.mutate(savedPlaylistRow); return; }
    add.mutate({ source: "youtube", ref: playlistId, name: info?.title ?? "Playlist", logo: info?.thumbnail ?? null, meta: "playlist" });
  };

  const ytFavs = useMemo(() => favorites.filter((f) => f.source === "youtube"), [favorites]);
  const savedPlaylists = ytFavs.filter((f) => f.meta === "playlist");
  const savedVideos = ytFavs.filter((f) => f.meta !== "playlist");
  const openPlaylist = (pid: string) => { setBox(pid); setSubmitted(pid); setTab("browse"); };
  const playSavedVideo = (i: number) => playFrom(savedVideos.map(favToItem), i);

  const noKey = !hasKey;
  const fetching = searchQ.isFetching || playlistQ.isFetching || videoQ.isFetching;
  const feedLabel = isPlaylist ? "in playlist" : isVideo ? "videos" : "results";

  const np: NowPlaying | null = video
    ? {
        name: video.title, sub: video.channelTitle, seed: video.videoId, logo: video.thumbnail || null,
        statusLabel: blocked && blocked.id === video.videoId ? "Can't play" : playing ? "Playing" : "Paused",
      }
    : null;

  const statusStats: StatusStat[] = [
    { key: "res", icon: <YouTubeIcon size={14} />, content: <><b>{list.length}</b> {feedLabel}</> },
    { key: "auto", good: autoplay, icon: <PlaylistIcon size={13} />, content: <>autoplay <b>{autoplay ? "on" : "off"}</b></> },
    { key: "now", good: !!video && playing, icon: <BarsIcon />, content: video ? <b className="block max-w-[240px] truncate">{video.title}</b> : <>nothing playing</> },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 flex min-h-0">
        {/* sidebar: sources + library + playback */}
        <aside className="w-[212px] shrink-0 bg-panel border-r border-edge flex flex-col py-3 px-2.5 gap-1.5 overflow-auto">
          <Label>Sources</Label>
          <Nav icon={<TvIcon size={15} />} label="Live TV" active={mode === "tv"} onClick={() => setMode("tv" as TvMode)} />
          <Nav icon={<RadioIcon size={15} />} label="Radio" active={mode === "radio"} onClick={() => setMode("radio" as TvMode)} />
          <Nav icon={<YouTubeIcon size={15} />} label="YouTube" active={mode === "youtube"} onClick={() => setMode("youtube")} />

          <Label>Library</Label>
          <Nav icon={<SearchIcon size={14} />} label="Browse" active={tab === "browse"} onClick={() => setTab("browse")} />
          <Nav icon={<StarIcon size={14} />} label="Saved" count={ytFavs.length} active={tab === "saved"} onClick={() => setTab("saved")} />

          <Label>Playback</Label>
          <button onClick={toggleAutoplay}
            className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg font-medium text-left text-muted hover:bg-elevated hover:text-fg">
            <span className="nico w-4 grid place-items-center text-muted"><PlaylistIcon size={15} /></span>
            <span className="flex-1">Autoplay</span>
            <span className={`relative w-8 h-[18px] rounded-full transition-colors ${autoplay ? "bg-accent" : "bg-edge-strong"}`}>
              <span className={`absolute top-[2px] w-3.5 h-3.5 rounded-full bg-white transition-all ${autoplay ? "left-[15px]" : "left-[2px]"}`} />
            </span>
          </button>
        </aside>

        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <form onSubmit={submit} className="h-[52px] shrink-0 flex items-center gap-3 px-4 border-b border-edge">
            <div className="flex-1 flex items-center gap-2.5 bg-elevated border border-edge rounded-lg px-3 h-9 text-muted focus-within:border-edge-strong">
              <SearchIcon />
              <input value={box} onChange={(e) => setBox(e.target.value)} placeholder="Search, or paste a video / playlist link…"
                className="flex-1 bg-transparent outline-none text-[13px] text-fg placeholder:text-dim" />
              {box && <button type="button" onClick={() => { setBox(""); setSubmitted(""); }} className="text-dim hover:text-fg text-sm">✕</button>}
            </div>
            <button type="submit" className="px-3.5 h-9 rounded-lg bg-accent text-accent-fg text-[13px] font-medium hover:bg-accent-hover">Go</button>
          </form>

          <div className="flex-1 flex min-h-0">
            {/* player stage */}
            <div className="flex-1 min-w-0 flex flex-col p-4 gap-3">
              <div className="flex-1 rounded-xl border border-edge-strong overflow-hidden relative bg-black grid place-items-center">
                <div ref={stageRef} className="absolute inset-0" />
                {noKey && (
                  <div className="relative z-10 text-dim text-[14px] text-center px-6">Add a YouTube Data API key to search and play.</div>
                )}
                {!noKey && !video && (
                  <div className="relative z-10 text-dim text-[14px] text-center px-6">Search above, or paste a video / playlist link.</div>
                )}
                {!noKey && blocked && blocked.id === video?.videoId && (
                  <div className="absolute inset-0 grid place-items-center bg-black/85 text-center px-6 z-20">
                    <div>
                      <div className="text-bright text-[14px] font-semibold mb-1">This video can't be embedded</div>
                      <div className="text-dim text-[12.5px] mb-3">{blockedReason(blocked.code)}</div>
                      <a href={`https://www.youtube.com/watch?v=${blocked.id}`} target="_blank" rel="noreferrer"
                        className="inline-block px-3.5 h-9 leading-9 rounded-lg bg-accent text-accent-fg text-[13px] font-medium hover:bg-accent-hover">Watch on YouTube</a>
                    </div>
                  </div>
                )}
              </div>
              {video && (
                <div>
                  <div className="text-bright text-[15px] font-semibold truncate">{video.title}</div>
                  {video.channelTitle && <div className="text-dim text-[12.5px] mt-0.5 truncate">{video.channelTitle}</div>}
                </div>
              )}
            </div>

            {/* rail: browse results / saved */}
            <div className="w-[330px] shrink-0 border-l border-edge flex flex-col min-h-0">
              {tab === "browse" ? (
                <BrowseRail
                  list={list} info={info} isPlaylist={isPlaylist} fetching={fetching} submitted={submitted} noKey={noKey}
                  videoId={video?.videoId ?? null} favorites={favorites} onOpenSettings={onOpenSettings}
                  onPick={(i) => playFrom(list, i)} onSave={toggleSaveVideo} onHide={hide}
                  savedPlaylistRow={savedPlaylistRow} onSavePlaylist={toggleSavePlaylist}
                  moreToken={moreToken} loadingMore={loadingMore} onLoadMore={loadMore} />
              ) : (
                <SavedRail playlists={savedPlaylists} videos={savedVideos} videoId={video?.videoId ?? null}
                  onOpenPlaylist={openPlaylist} onPlayVideo={playSavedVideo} onRemove={(id) => remove.mutate(id)} />
              )}
            </div>
          </div>
        </div>
      </div>

      <TransportBar nowPlaying={np} playing={playing} onTogglePlay={togglePlay}
        onPrev={queueIdx > 0 ? () => advance(-1) : undefined}
        onNext={queueIdx >= 0 && queueIdx < queue.length - 1 ? () => advance(1) : undefined}
        volume={volume} muted={muted} onVolume={setVolume} onToggleMute={toggleMute} />
      <StatusBar sourceLabel="YouTube" stats={statusStats} />
    </div>
  );
}

interface BrowseRailProps {
  list: YouTubeItem[];
  info: { title: string; channelTitle: string } | null;
  isPlaylist: boolean;
  fetching: boolean;
  submitted: string;
  noKey: boolean;
  videoId: string | null;
  favorites: TvFavorite[];
  onOpenSettings: () => void;
  onPick: (i: number) => void;
  onSave: (it: YouTubeItem) => void;
  onHide: (id: string) => void;
  savedPlaylistRow: string | null;
  onSavePlaylist: () => void;
  moreToken?: string;
  loadingMore: boolean;
  onLoadMore: () => void;
}

function BrowseRail({
  list, info, isPlaylist, fetching, submitted, noKey, videoId, favorites, onOpenSettings,
  onPick, onSave, onHide, savedPlaylistRow, onSavePlaylist, moreToken, loadingMore, onLoadMore,
}: BrowseRailProps) {
  return (
    <>
      <div className="px-3.5 pt-3 pb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold tracking-wide text-dim truncate">
          {isPlaylist ? (info?.title ?? "PLAYLIST").toUpperCase() : "RESULTS"}
        </span>
        {isPlaylist && (
          <button onClick={onSavePlaylist} title={savedPlaylistRow ? "Remove playlist from saved" : "Save playlist"}
            className={`shrink-0 flex items-center gap-1 text-[11px] font-medium ${savedPlaylistRow ? "text-accent" : "text-dim hover:text-fg"}`}>
            <StarIcon size={13} filled={!!savedPlaylistRow} /> Save
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto px-2.5 pb-3.5 flex flex-col gap-1.5">
        {noKey && (
          <div className="m-2 p-3 rounded-lg border border-edge bg-elevated text-[12.5px] text-muted">
            No API key set. <button onClick={onOpenSettings} className="text-accent hover:underline">Add one in settings</button> to enable YouTube.
          </div>
        )}
        {!noKey && fetching && list.length === 0 && <div className="px-3 py-8 text-center text-dim text-[12.5px]">Loading…</div>}
        {!noKey && !fetching && submitted && list.length === 0 && <div className="px-3 py-8 text-center text-dim text-[12.5px]">Nothing to show.</div>}
        {list.map((it, i) => {
          const playingNow = it.videoId === videoId;
          const fav = !!favoriteId(favorites, "youtube", it.videoId);
          return (
            <div key={it.videoId + i}
              className={`group flex gap-2.5 p-1.5 rounded-[9px] ${playingNow ? "bg-accent/15 border border-accent/35" : "hover:bg-elevated border border-transparent"}`}>
              <button onClick={() => onPick(i)} className="flex gap-2.5 text-left flex-1 min-w-0">
                <div className="w-[120px] h-[68px] rounded-md overflow-hidden bg-surface shrink-0 relative">
                  {it.thumbnail && <img src={it.thumbnail} alt="" className="w-full h-full object-cover" />}
                  {playingNow && <span className="absolute bottom-1 right-1 tr-eq text-accent"><i /><i /><i /></span>}
                </div>
                <div className="min-w-0 flex-1 py-0.5">
                  <div className="text-[12.5px] font-medium text-fg line-clamp-2 leading-snug">{it.title}</div>
                  {it.channelTitle && <div className="text-dim text-[11.5px] mt-1 truncate">{it.channelTitle}</div>}
                </div>
              </button>
              <div className="flex flex-col items-center justify-center gap-1 shrink-0 pr-0.5">
                <button onClick={() => onSave(it)} title={fav ? "Remove from saved" : "Save video"}
                  className={`${fav ? "text-accent opacity-100" : "text-dim opacity-0 group-hover:opacity-100 hover:text-fg"}`}><StarIcon size={14} filled={fav} /></button>
                <button onClick={() => onHide(it.videoId)} title="Remove from list"
                  className="text-dim opacity-0 group-hover:opacity-100 hover:text-fg"><CloseIcon size={13} /></button>
              </div>
            </div>
          );
        })}
        {isPlaylist && moreToken && (
          <button onClick={onLoadMore} disabled={loadingMore}
            className="mx-2 mt-1 mb-2 h-8 rounded-lg border border-edge text-[12px] text-muted hover:bg-elevated hover:text-fg disabled:opacity-50">
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
    </>
  );
}

function SavedRail({
  playlists, videos, videoId, onOpenPlaylist, onPlayVideo, onRemove,
}: {
  playlists: TvFavorite[]; videos: TvFavorite[]; videoId: string | null;
  onOpenPlaylist: (pid: string) => void; onPlayVideo: (i: number) => void; onRemove: (id: string) => void;
}) {
  const empty = playlists.length === 0 && videos.length === 0;
  return (
    <div className="flex-1 overflow-auto px-2.5 py-3 flex flex-col gap-1">
      {empty && <div className="px-3 py-8 text-center text-dim text-[12.5px]">Star a video or playlist to save it here.</div>}
      {playlists.length > 0 && <div className="px-1.5 pt-1 pb-1.5 text-[11px] font-bold tracking-wide text-dim">PLAYLISTS</div>}
      {playlists.map((p) => (
        <div key={p.id} className="group flex items-center gap-2.5 px-2 py-2 rounded-[9px] hover:bg-elevated">
          <button onClick={() => onOpenPlaylist(p.ref)} className="flex items-center gap-2.5 flex-1 min-w-0 text-left">
            <span className="w-9 h-9 rounded-lg grid place-items-center bg-surface text-accent shrink-0"><PlaylistIcon size={16} /></span>
            <span className="min-w-0 flex-1 text-[12.5px] font-medium text-fg truncate">{p.name}</span>
          </button>
          <button onClick={() => onRemove(p.id)} title="Remove" className="text-dim opacity-0 group-hover:opacity-100 hover:text-fg shrink-0"><CloseIcon size={13} /></button>
        </div>
      ))}
      {videos.length > 0 && <div className="px-1.5 pt-2.5 pb-1.5 text-[11px] font-bold tracking-wide text-dim">VIDEOS</div>}
      {videos.map((v, i) => {
        const playingNow = v.ref === videoId;
        return (
          <div key={v.id} className={`group flex gap-2.5 p-1.5 rounded-[9px] ${playingNow ? "bg-accent/15 border border-accent/35" : "hover:bg-elevated border border-transparent"}`}>
            <button onClick={() => onPlayVideo(i)} className="flex gap-2.5 text-left flex-1 min-w-0">
              <div className="w-[88px] h-[50px] rounded-md overflow-hidden bg-surface shrink-0 relative">
                {v.logo && <img src={v.logo} alt="" className="w-full h-full object-cover" />}
                {playingNow && <span className="absolute bottom-1 right-1 tr-eq text-accent"><i /><i /><i /></span>}
              </div>
              <div className="min-w-0 flex-1 py-0.5 text-[12.5px] font-medium text-fg line-clamp-2 leading-snug">{v.name}</div>
            </button>
            <button onClick={() => onRemove(v.id)} title="Remove" className="self-center text-dim opacity-0 group-hover:opacity-100 hover:text-fg shrink-0"><CloseIcon size={13} /></button>
          </div>
        );
      })}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[10.5px] font-bold tracking-wider text-dim px-2 pt-2.5 pb-1 uppercase">{children}</div>;
}

function Nav({ icon, label, active, onClick, count }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void; count?: number }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg font-medium text-left ${active ? "bg-elevated text-bright [&_.nico]:text-accent" : "text-muted hover:bg-elevated hover:text-fg"}`}>
      <span className="nico w-4 grid place-items-center text-muted">{icon}</span>
      <span className="flex-1">{label}</span>
      {typeof count === "number" && count > 0 && <span className="text-[10.5px] text-dim">{count}</span>}
    </button>
  );
}
