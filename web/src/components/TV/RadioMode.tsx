import { useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import type { RadioStation } from "../../api/types";
import { api, getToken } from "../../api/client";
import { useTv, type TvMode } from "./store";
import { useRadioSearch, useRadioFacets, useTvFavorites, useTvRecents, favoriteId } from "./useTvData";
import { applyMediaState, gradientFor, monogram, stationSub } from "./helpers";
import { TransportBar, type NowPlaying } from "./TransportBar";
import { StatusBar, type StatusStat } from "./StatusBar";
import { SearchIcon, RadioIcon, TvIcon, YouTubeIcon, BarsIcon, ClockIcon, VolumeIcon, StarIcon } from "./icons";

type Status = "idle" | "loading" | "playing" | "error";

export function RadioMode() {
  const { mode, setMode, station, playing, volume, muted, playStation, togglePlay, setVolume, toggleMute } = useTv();
  const { favorites, add, remove } = useTvFavorites();
  const { record } = useTvRecents();
  const facets = useRadioFacets();

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [country, setCountry] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(search), 350); return () => clearTimeout(t); }, [search]);

  const params = useMemo(() => ({ q: debounced || undefined, tag: tag || undefined, country: country || undefined, limit: 100 }), [debounced, tag, country]);
  const result = useRadioSearch(params);
  const stations = result.data?.stations ?? [];

  const audioRef = useRef<HTMLAudioElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [buffer, setBuffer] = useState(0);

  // Attach the station stream: HLS (.m3u8) flows through the proxy; everything else (icecast mp3/aac)
  // plays straight off the <audio> element (media playback needs no CORS, and the proxy would buffer an
  // endless stream forever).
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !station) { setStatus("idle"); return; }
    setStatus("loading");
    setBuffer(0);
    let destroyed = false;
    const fail = () => { if (!destroyed) setStatus("error"); };

    if (/\.m3u8(\?|$)/i.test(station.url) && Hls.isSupported()) {
      const hls = new Hls({ xhrSetup: (xhr) => { const t = getToken(); if (t) xhr.setRequestHeader("authorization", `Bearer ${t}`); } });
      hlsRef.current = hls;
      hls.loadSource(api.tv.proxyUrl({ url: station.url, referrer: null, userAgent: null }));
      hls.attachMedia(audio);
      hls.on(Hls.Events.MANIFEST_PARSED, () => audio.play().catch(() => {}));
      hls.on(Hls.Events.ERROR, (_e, d) => { if (d.fatal) fail(); });
    } else {
      audio.src = station.url;
      audio.play().catch(() => {});
      audio.addEventListener("error", fail);
    }
    return () => {
      destroyed = true;
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      audio.removeEventListener("error", fail);
      audio.removeAttribute("src");
      audio.load();
    };
  }, [station?.url]);

  useEffect(() => { applyMediaState(audioRef.current, { volume, muted, playing }); }, [volume, muted, playing, status, station?.url]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlaying = () => setStatus("playing");
    const onWaiting = () => setStatus((s) => (s === "error" ? s : "loading"));
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("waiting", onWaiting);
    const id = window.setInterval(() => {
      const b = audio.buffered;
      setBuffer(b.length ? Number(Math.max(0, b.end(b.length - 1) - audio.currentTime).toFixed(1)) : 0);
    }, 1000);
    return () => { window.clearInterval(id); audio.removeEventListener("playing", onPlaying); audio.removeEventListener("waiting", onWaiting); };
  }, []);

  const favIds = useMemo(() => new Set(favorites.filter((f) => f.source === "radio").map((f) => f.ref)), [favorites]);
  const curIdx = station ? stations.findIndex((s) => s.id === station.id) : -1;
  const play = (s: RadioStation) => { playStation(s); record.mutate({ source: "radio", ref: s.id, name: s.name, logo: s.favicon || null }); };
  const go = (delta: number) => { if (stations.length === 0) return; const i = curIdx < 0 ? 0 : (curIdx + delta + stations.length) % stations.length; play(stations[i]); };
  const toggleFav = (s: RadioStation) => { const id = favoriteId(favorites, "radio", s.id); if (id) remove.mutate(id); else add.mutate({ source: "radio", ref: s.id, name: s.name, logo: s.favicon || null }); };

  const statusLabel = status === "playing" ? `ON AIR · ${station?.bitrate ? station.bitrate + "k" : station?.codec?.toUpperCase() || "live"}` : status === "loading" ? "Tuning…" : status === "error" ? "Off air" : "Paused";
  const np: NowPlaying | null = station ? { name: station.name, sub: stationSub(station), seed: station.id, logo: station.favicon || null, statusLabel } : null;

  const statusStats: StatusStat[] = [
    { key: "st", icon: <RadioIcon size={14} />, content: <><b>{stations.length}</b> stations</> },
    { key: "codec", good: status === "playing", icon: <BarsIcon />, content: <>{station?.codec?.toUpperCase() || "—"} · <b>{station?.bitrate || 0}k</b></> },
    { key: "buf", icon: <ClockIcon />, content: <>buffer <b>{buffer}s</b></> },
    { key: "vol", icon: <VolumeIcon size={14} muted={muted} />, content: <b>{muted ? 0 : volume}%</b> },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <audio ref={audioRef} className="hidden" />
      <div className="flex-1 flex min-h-0">
        {/* radio sidebar: sources + genres + countries */}
        <aside className="w-[212px] shrink-0 bg-panel border-r border-edge flex flex-col py-3 px-2.5 gap-1.5 overflow-auto">
          <Label>Sources</Label>
          <Nav icon={<TvIcon size={15} />} label="Live TV" active={mode === "tv"} onClick={() => setMode("tv" as TvMode)} />
          <Nav icon={<RadioIcon size={15} />} label="Radio" active={mode === "radio"} onClick={() => setMode("radio")} />
          <Nav icon={<YouTubeIcon size={15} />} label="YouTube" active={mode === "youtube"} onClick={() => setMode("youtube" as TvMode)} />

          <Label>Genres</Label>
          {(facets.data?.tags ?? []).slice(0, 14).map((t) => (
            <FiltRow key={t.name} label={t.name} count={t.stationcount} sel={tag === t.name} onClick={() => setTag(tag === t.name ? null : t.name)} />
          ))}

          <Label>Country</Label>
          {(facets.data?.countries ?? []).filter((c) => c.iso_3166_1).sort((a, b) => (b.stationcount ?? 0) - (a.stationcount ?? 0)).slice(0, 10).map((c) => (
            <FiltRow key={c.iso_3166_1} label={c.name} count={c.stationcount} sel={country === c.iso_3166_1} onClick={() => setCountry(country === c.iso_3166_1 ? null : (c.iso_3166_1 ?? null))} />
          ))}
        </aside>

        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <div className="h-[52px] shrink-0 flex items-center gap-3 px-4 border-b border-edge">
            <div className="text-[13px] text-muted shrink-0"><b className="text-fg font-semibold">{stations.length}</b> stations</div>
            <div className="flex-1 flex items-center gap-2.5 bg-elevated border border-edge rounded-lg px-3 h-9 text-muted focus-within:border-edge-strong">
              <SearchIcon />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search stations…"
                className="flex-1 bg-transparent outline-none text-[13px] text-fg placeholder:text-dim" />
              {search && <button onClick={() => setSearch("")} className="text-dim hover:text-fg text-sm">✕</button>}
            </div>
          </div>
          {(tag || country) && (
            <div className="flex gap-2 px-4 pt-3 pb-2 flex-wrap border-b border-edge">
              {tag && <button onClick={() => setTag(null)} className="flex items-center gap-2 px-3 py-1 rounded-full border bg-accent/15 border-accent/35 text-accent text-[12px] font-medium">{tag} <span className="text-dim hover:text-fg">✕</span></button>}
              {country && <button onClick={() => setCountry(null)} className="flex items-center gap-2 px-3 py-1 rounded-full border bg-accent/15 border-accent/35 text-accent text-[12px] font-medium">{country} <span className="text-dim hover:text-fg">✕</span></button>}
            </div>
          )}

          <div className="flex-1 flex min-h-0">
            {/* now playing visual */}
            <div className="flex-1 min-w-0 flex flex-col p-4">
              <div className="flex-1 rounded-xl border border-edge-strong grid place-items-center relative overflow-hidden"
                style={{ background: "radial-gradient(120% 120% at 30% 10%, rgba(63,185,80,.16), transparent 55%), linear-gradient(160deg,#1b2420,#15181d)" }}>
                {station ? (
                  <div className="flex flex-col items-center gap-4 text-center px-6">
                    <div className="w-[120px] h-[120px] rounded-2xl grid place-items-center text-white font-bold text-[34px] shadow-2xl" style={{ background: gradientFor(station.id) }}>
                      {station.favicon ? <img src={station.favicon} alt="" className="w-full h-full object-contain rounded-2xl" onError={(e) => { e.currentTarget.style.display = "none"; }} /> : monogram(station.name)}
                    </div>
                    <div>
                      <div className="text-bright text-[20px] font-semibold">{station.name}</div>
                      <div className="text-dim text-[13px] mt-1">{stationSub(station)}</div>
                    </div>
                    {status === "playing" && <span className="tr-eq text-accent !h-5 [&_i]:!h-5"><i /><i /><i /><i /><i /></span>}
                    {status === "loading" && <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-white/80 animate-spin" />}
                    {status === "error" && <div className="text-error text-[13px]">This station is off air.</div>}
                  </div>
                ) : (
                  <div className="text-dim text-[14px]">Pick a station to start listening.</div>
                )}
              </div>
            </div>

            {/* station rail */}
            <div className="w-[330px] shrink-0 border-l border-edge flex flex-col min-h-0">
              <div className="px-3.5 pt-3 pb-2 text-[11px] font-bold tracking-wide text-dim flex items-center justify-between">
                <span>STATIONS</span><span className="font-medium text-dim">by popularity</span>
              </div>
              <div className="flex-1 overflow-auto px-2.5 pb-3.5 flex flex-col gap-1">
                {result.isLoading && <div className="px-3 py-8 text-center text-dim text-[12.5px]">Loading stations…</div>}
                {!result.isLoading && stations.length === 0 && <div className="px-3 py-8 text-center text-dim text-[12.5px]">No stations found.</div>}
                {stations.map((s) => {
                  const playingNow = s.id === station?.id;
                  const fav = favIds.has(s.id);
                  return (
                    <button key={s.id} onClick={() => play(s)}
                      className={`group flex items-center gap-2.5 px-2.5 py-2 rounded-[9px] text-left ${playingNow ? "bg-accent/15 border border-accent/35" : "hover:bg-elevated border border-transparent"}`}>
                      <div className="w-10 h-10 rounded-lg shrink-0 grid place-items-center font-bold text-[13px] text-white overflow-hidden" style={{ background: gradientFor(s.id) }}>
                        {s.favicon ? <img src={s.favicon} alt="" className="w-full h-full object-contain" onError={(e) => { e.currentTarget.style.display = "none"; }} /> : monogram(s.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-[13px] truncate text-fg">{s.name}</div>
                        <div className="text-dim text-[11.5px] mt-px truncate">{stationSub(s) || "Radio"}</div>
                      </div>
                      {playingNow ? <span className="tr-eq text-accent shrink-0"><i /><i /><i /></span> : (
                        <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); toggleFav(s); }}
                          className={`shrink-0 ${fav ? "text-accent opacity-100" : "text-dim opacity-0 group-hover:opacity-100 hover:text-fg"}`}><StarIcon filled={fav} /></span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      <TransportBar nowPlaying={np} playing={playing} onTogglePlay={togglePlay}
        onPrev={() => go(-1)} onNext={() => go(1)} volume={volume} muted={muted} onVolume={setVolume} onToggleMute={toggleMute} />
      <StatusBar sourceLabel="radio-browser" stats={statusStats} />
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[10.5px] font-bold tracking-wider text-dim px-2 pt-2.5 pb-1 uppercase">{children}</div>;
}
function Nav({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg font-medium text-left ${active ? "bg-elevated text-bright [&_.nico]:text-accent" : "text-muted hover:bg-elevated hover:text-fg"}`}>
      <span className="nico w-4 grid place-items-center text-muted">{icon}</span><span className="flex-1">{label}</span>
    </button>
  );
}
function FiltRow({ label, count, sel, onClick }: { label: string; count?: number; sel: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[12.5px] ${sel ? "text-bright" : "text-muted hover:bg-elevated hover:text-fg"}`}>
      <span className={`w-3.5 text-[11px] ${sel ? "text-accent" : "text-dim"}`}>{sel ? "✓" : ""}</span>
      <span className="truncate text-left flex-1 capitalize">{label}</span>
      {typeof count === "number" && <span className="text-[10.5px] text-dim">{count.toLocaleString()}</span>}
    </button>
  );
}
