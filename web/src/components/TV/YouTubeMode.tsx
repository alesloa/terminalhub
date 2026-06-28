import { useRef, useState } from "react";
import { useTv, type TvMode } from "./store";
import { useYouTubeSearch, useTvRecents } from "./useTvData";
import { StatusBar, type StatusStat } from "./StatusBar";
import { SearchIcon, TvIcon, RadioIcon, YouTubeIcon, BarsIcon, FullscreenIcon } from "./icons";

interface Props {
  hasKey: boolean;
  onOpenSettings: () => void;
}

/** YouTube tab: search the Data API, click a result to embed it. The iframe owns playback (its own
 *  volume/quality/fullscreen), so there's no app transport bar here — just search, results, and the
 *  status strip. Needs a server-side API key; without one it points the user at TV settings. */
export function YouTubeMode({ hasKey, onOpenSettings }: Props) {
  const { mode, setMode, video, playVideo } = useTv();
  const { record } = useTvRecents();
  const [search, setSearch] = useState("");
  const [submitted, setSubmitted] = useState("");
  const result = useYouTubeSearch(submitted, hasKey);
  const items = result.data?.items ?? [];
  const noKey = (result.error as Error | null)?.message === "no_key";
  const stageRef = useRef<HTMLDivElement>(null);

  const fullscreen = () => { const el = stageRef.current; if (!el) return; if (document.fullscreenElement) void document.exitFullscreen(); else void el.requestFullscreen?.(); };

  const statusStats: StatusStat[] = [
    { key: "res", icon: <YouTubeIcon size={14} />, content: <><b>{items.length}</b> results</> },
    { key: "now", good: !!video, icon: <BarsIcon />, content: video ? <b className="block max-w-[280px] truncate">{video.title}</b> : <>nothing playing</> },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 flex min-h-0">
        {/* sources sidebar */}
        <aside className="w-[212px] shrink-0 bg-panel border-r border-edge flex flex-col py-3 px-2.5 gap-1.5 overflow-auto">
          <div className="text-[10.5px] font-bold tracking-wider text-dim px-2 pt-2.5 pb-1 uppercase">Sources</div>
          <Nav icon={<TvIcon size={15} />} label="Live TV" active={mode === "tv"} onClick={() => setMode("tv" as TvMode)} />
          <Nav icon={<RadioIcon size={15} />} label="Radio" active={mode === "radio"} onClick={() => setMode("radio" as TvMode)} />
          <Nav icon={<YouTubeIcon size={15} />} label="YouTube" active={mode === "youtube"} onClick={() => setMode("youtube")} />
        </aside>

        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <form onSubmit={(e) => { e.preventDefault(); setSubmitted(search); }}
            className="h-[52px] shrink-0 flex items-center gap-3 px-4 border-b border-edge">
            <div className="flex-1 flex items-center gap-2.5 bg-elevated border border-edge rounded-lg px-3 h-9 text-muted focus-within:border-edge-strong">
              <SearchIcon />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search YouTube…"
                className="flex-1 bg-transparent outline-none text-[13px] text-fg placeholder:text-dim" />
            </div>
            <button type="submit" className="px-3.5 h-9 rounded-lg bg-accent text-accent-fg text-[13px] font-medium hover:bg-accent-hover">Search</button>
          </form>

          <div className="flex-1 flex min-h-0">
            {/* player stage */}
            <div className="flex-1 min-w-0 flex flex-col p-4 gap-3">
              <div ref={stageRef} className="flex-1 rounded-xl border border-edge-strong overflow-hidden relative bg-black grid place-items-center">
                {video ? (
                  <>
                    <iframe key={video.videoId} title={video.title} className="w-full h-full"
                      src={`https://www.youtube-nocookie.com/embed/${video.videoId}?autoplay=1&rel=0`}
                      allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
                    <button onClick={fullscreen} title="Fullscreen"
                      className="absolute bottom-3 right-3 w-9 h-9 rounded-lg grid place-items-center bg-black/50 backdrop-blur text-white hover:bg-black/70"><FullscreenIcon /></button>
                  </>
                ) : (
                  <div className="text-dim text-[14px] text-center px-6">
                    {noKey ? "Add a YouTube Data API key to search and play." : "Search above, then pick a video to play."}
                  </div>
                )}
              </div>
              {video && <div><div className="text-bright text-[15px] font-semibold truncate">{video.title}</div><div className="text-dim text-[12.5px] mt-0.5">{video.channelTitle}</div></div>}
            </div>

            {/* results rail */}
            <div className="w-[330px] shrink-0 border-l border-edge flex flex-col min-h-0">
              <div className="px-3.5 pt-3 pb-2 text-[11px] font-bold tracking-wide text-dim">RESULTS</div>
              <div className="flex-1 overflow-auto px-2.5 pb-3.5 flex flex-col gap-1.5">
                {noKey && (
                  <div className="m-2 p-3 rounded-lg border border-edge bg-elevated text-[12.5px] text-muted">
                    No API key set. <button onClick={onOpenSettings} className="text-accent hover:underline">Add one in settings</button> to enable YouTube.
                  </div>
                )}
                {!noKey && result.isFetching && <div className="px-3 py-8 text-center text-dim text-[12.5px]">Searching…</div>}
                {!noKey && !result.isFetching && submitted && items.length === 0 && <div className="px-3 py-8 text-center text-dim text-[12.5px]">No results.</div>}
                {items.map((it) => {
                  const playingNow = it.videoId === video?.videoId;
                  return (
                    <button key={it.videoId} onClick={() => { playVideo(it); record.mutate({ source: "youtube", ref: it.videoId, name: it.title, logo: it.thumbnail }); }}
                      className={`group flex gap-2.5 p-1.5 rounded-[9px] text-left ${playingNow ? "bg-accent/15 border border-accent/35" : "hover:bg-elevated border border-transparent"}`}>
                      <div className="w-[120px] h-[68px] rounded-md overflow-hidden bg-surface shrink-0 relative">
                        <img src={it.thumbnail} alt="" className="w-full h-full object-cover" />
                        {playingNow && <span className="absolute bottom-1 right-1 tr-eq text-accent"><i /><i /><i /></span>}
                      </div>
                      <div className="min-w-0 flex-1 py-0.5">
                        <div className="text-[12.5px] font-medium text-fg line-clamp-2 leading-snug">{it.title}</div>
                        <div className="text-dim text-[11.5px] mt-1 truncate">{it.channelTitle}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      <StatusBar sourceLabel="YouTube" stats={statusStats} />
    </div>
  );
}

function Nav({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg font-medium text-left ${active ? "bg-elevated text-bright [&_.nico]:text-accent" : "text-muted hover:bg-elevated hover:text-fg"}`}>
      <span className="nico w-4 grid place-items-center text-muted">{icon}</span><span className="flex-1">{label}</span>
    </button>
  );
}
