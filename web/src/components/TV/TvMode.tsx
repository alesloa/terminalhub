import { useEffect, useMemo, useRef, useState } from "react";
import type { TvChannel } from "../../api/types";
import { useTv } from "./store";
import { useTvCatalog, useTvFavorites, useTvSettings, useTvRecents, favoriteId } from "./useTvData";
import { useHlsPlayer } from "./useHlsPlayer";
import { applyMediaState, channelQuality, isHd } from "./helpers";
import { TvSidebar } from "./TvSidebar";
import { TvPlayer } from "./TvPlayer";
import { ChannelList } from "./ChannelList";
import { TransportBar, type NowPlaying } from "./TransportBar";
import { StatusBar, type StatusStat } from "./StatusBar";
import { SearchIcon, TvIcon, BarsIcon, DownIcon, ClockIcon, VolumeIcon } from "./icons";

function heightOf(quality: string | null): number {
  const m = quality?.match(/(\d{3,4})/);
  return m ? Number(m[1]) : 0;
}

function matchFilters(c: TvChannel, f: ReturnType<typeof useTv.getState>["filters"], favIds: Set<string>, nsfw: boolean): boolean {
  if (!nsfw && c.isNsfw) return false;
  if (f.favOnly && !favIds.has(c.id)) return false;
  if (f.categories.length && !c.categories.some((x) => f.categories.includes(x))) return false;
  if (f.countries.length && !(c.country && f.countries.includes(c.country.code))) return false;
  if (f.languages.length && !c.languages.some((x) => f.languages.includes(x))) return false;
  if (f.hdOnly && !isHd(c)) return false;
  const q = f.search.trim().toLowerCase();
  if (q && !c.name.toLowerCase().includes(q)) return false;
  return true;
}

export function TvMode() {
  const { channel, playing, volume, muted, filters, mode, setMode, playChannel, togglePlay, setVolume, toggleMute, patchFilters, toggleArrayFilter, clearFilters, subtitleColor, setSubtitleColor, setPreferredAudioLang } = useTv();
  const catalog = useTvCatalog();
  const { favorites, add, remove } = useTvFavorites();
  const { settings } = useTvSettings();
  const { record } = useTvRecents();

  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const channels = catalog.data?.channels ?? [];
  const facets = catalog.data?.facets;
  const favIds = useMemo(() => new Set(favorites.filter((f) => f.source === "tv").map((f) => f.ref)), [favorites]);
  const nsfw = !!settings?.nsfw;

  const filtered = useMemo(
    () => channels.filter((c) => matchFilters(c, filters, favIds, nsfw)),
    [channels, filters, favIds, nsfw],
  );

  // Stream selection — try the highest-res stream first, fall through to lower ones on fatal error,
  // then auto-advance to the next channel in the filtered list.
  const ordered = useMemo(
    () => (channel ? [...channel.streams].sort((a, b) => heightOf(b.quality) - heightOf(a.quality)) : []),
    [channel],
  );
  const [streamIdx, setStreamIdx] = useState(0);
  useEffect(() => { setStreamIdx(0); }, [channel?.id]);
  const stream = ordered[streamIdx] ?? null;

  const curIdx = channel ? filtered.findIndex((c) => c.id === channel.id) : -1;
  const play = (c: TvChannel) => { playChannel(c); record.mutate({ source: "tv", ref: c.id, name: c.name, logo: c.logo }); };
  const go = (delta: number) => {
    if (filtered.length === 0) return;
    const base = curIdx < 0 ? 0 : (curIdx + delta + filtered.length) % filtered.length;
    play(filtered[base]);
  };

  // A dead stream falls through to the channel's own backup streams; when those are exhausted the player
  // shows "unavailable" (we do NOT auto-jump to a different channel — that surprises the user).
  const onFatal = () => { if (streamIdx < ordered.length - 1) setStreamIdx((i) => i + 1); };
  const { status, stats, programTitle, subtitles, audio, selectSubtitle, selectAudio } = useHlsPlayer(videoRef, stream, { onFatal });

  // Mirror the store's playback state onto the <video>.
  useEffect(() => { applyMediaState(videoRef.current, { volume, muted, playing }); }, [volume, muted, playing, status, stream?.url]);

  // The chosen caption color is applied to video::cue via a managed <style>, scoped to .tv-scope so it
  // only ever touches this window's video. Recreated on color change; removed on unmount.
  useEffect(() => {
    const el = document.createElement("style");
    el.textContent = `.tv-scope video::cue { color: ${subtitleColor} !important; background: rgba(0,0,0,.6); }`;
    document.head.appendChild(el);
    return () => { el.remove(); };
  }, [subtitleColor]);

  // Only surface a real programme name — never the channel name echoed back (see useHlsPlayer junk filter).
  const program = programTitle && programTitle !== channel?.name ? programTitle : null;

  const toggleFav = (c: TvChannel) => {
    const id = favoriteId(favorites, "tv", c.id);
    if (id) remove.mutate(id);
    else add.mutate({ source: "tv", ref: c.id, name: c.name, logo: c.logo });
  };

  const fullscreen = () => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };
  const pip = async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
    } catch { /* PiP unsupported / denied */ }
  };

  const quality = stats.quality ?? (channel ? channelQuality(channel) : null);
  const subLine = channel
    ? [channel.categories[0], channel.country?.flag && `${channel.country.flag} ${channel.country.name}`, channel.languages[0]].filter(Boolean).join(" · ")
    : null;
  const statusLabel = status === "playing" ? `LIVE · ${quality || "live"}` : status === "loading" ? "Connecting…" : status === "error" ? "Offline" : "Paused";
  const np: NowPlaying | null = channel
    ? { name: channel.name, sub: subLine ?? "", seed: channel.id || channel.name, logo: channel.logo, statusLabel }
    : null;

  const mbps = (stats.bitrateKbps / 1000).toFixed(1);
  const statusStats: StatusStat[] = [
    { key: "ch", icon: <TvIcon size={14} />, content: <><b>{channels.length.toLocaleString()}</b> channels</> },
    ...(program ? [{ key: "prog", good: true, icon: <ClockIcon />, content: <span className="truncate max-w-[220px] inline-block align-bottom"><b>{program}</b></span> } as StatusStat] : []),
    { key: "q", good: status === "playing", icon: <BarsIcon />, content: <>HLS · <b>{quality || "—"}</b></> },
    { key: "br", icon: <DownIcon />, content: <><b>{stats.bitrateKbps ? mbps : "0.0"}</b> Mbps</> },
    { key: "buf", icon: <ClockIcon />, content: <>buffer <b>{stats.bufferSec}s</b></> },
    { key: "vol", icon: <VolumeIcon size={14} muted={muted} />, content: <b>{muted ? 0 : volume}%</b> },
  ];

  // categories + languages are filtered by their display name (that's what channels store); countries by code.
  const countryOf = (code: string) => facets?.countries.find((c) => c.code === code);
  const anyChips = filters.categories.length + filters.countries.length + filters.languages.length > 0 || filters.favOnly || filters.hdOnly;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 flex min-h-0">
        <TvSidebar mode={mode} onMode={setMode} tvCount={channels.length} facets={facets} filters={filters}
          onToggleArray={toggleArrayFilter} onToggleFavOnly={() => patchFilters({ favOnly: !filters.favOnly })}
          onToggleHd={() => patchFilters({ hdOnly: !filters.hdOnly })} favCount={favIds.size} />

        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {/* toolbar: count + search */}
          <div className="h-[52px] shrink-0 flex items-center gap-3 px-4 border-b border-edge">
            <div className="text-[13px] text-muted shrink-0"><b className="text-fg font-semibold">{filtered.length.toLocaleString()}</b> channels</div>
            <div className="flex-1 flex items-center gap-2.5 bg-elevated border border-edge rounded-lg px-3 h-9 text-muted focus-within:border-edge-strong">
              <SearchIcon />
              <input value={filters.search} onChange={(e) => patchFilters({ search: e.target.value })}
                placeholder="Search channels…" className="flex-1 bg-transparent outline-none text-[13px] text-fg placeholder:text-dim" />
              {filters.search && <button onClick={() => patchFilters({ search: "" })} className="text-dim hover:text-fg text-sm">✕</button>}
            </div>
          </div>

          {/* active filter chips */}
          <div className="flex gap-2 px-4 pt-3 pb-2 flex-wrap border-b border-edge">
            {filters.categories.map((name) => (
              <Chip key={"c" + name} dot="bg-accent" label={name} onRemove={() => toggleArrayFilter("categories", name)} />
            ))}
            {filters.languages.map((name) => (
              <Chip key={"l" + name} dot="bg-[var(--tv-lang)]" label={name} onRemove={() => toggleArrayFilter("languages", name)} />
            ))}
            {filters.countries.map((code) => {
              const c = countryOf(code);
              return <Chip key={"co" + code} dot="bg-info" label={`${c?.flag ?? ""} ${c?.name ?? code}`.trim()} onRemove={() => toggleArrayFilter("countries", code)} />;
            })}
            <Chip dot="bg-warn" label="HD only" active={filters.hdOnly} onClick={() => patchFilters({ hdOnly: !filters.hdOnly })} />
            {anyChips && <button onClick={clearFilters} className="text-dim hover:text-fg text-[12px] px-2">Clear all</button>}
          </div>

          {/* stage: player + browse rail */}
          <div className="flex-1 flex min-h-0">
            <TvPlayer videoRef={videoRef} stageRef={stageRef} title={channel?.name ?? null} sub={subLine} program={program}
              status={status} quality={quality} playing={playing} onTogglePlay={togglePlay} />
            <ChannelList channels={filtered} currentId={channel?.id ?? null} favIds={favIds} onPlay={play} onToggleFav={toggleFav} />
          </div>
        </div>
      </div>

      <TransportBar nowPlaying={np} playing={playing} onTogglePlay={togglePlay}
        onPrev={() => go(-1)} onNext={() => go(1)}
        volume={volume} muted={muted} onVolume={setVolume} onToggleMute={toggleMute}
        onPip={pip} onFullscreen={fullscreen}
        subtitles={subtitles} subtitleColor={subtitleColor} onSelectSubtitle={selectSubtitle} onSubtitleColor={setSubtitleColor}
        audio={audio} onPickAudio={(t) => { selectAudio(t.id); setPreferredAudioLang(t.lang || t.label); }} />
      <StatusBar sourceLabel="iptv-org" stats={statusStats} />
    </div>
  );
}

function Chip({ dot, label, onRemove, onClick, active }: { dot: string; label: string; onRemove?: () => void; onClick?: () => void; active?: boolean }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-2 px-3 py-1 rounded-full border text-[12px] font-medium ${active || onRemove ? "bg-accent/15 border-accent/35 text-accent" : "bg-elevated border-edge text-muted hover:bg-surface hover:text-fg"}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      <span className="truncate max-w-[160px]">{label}</span>
      {onRemove && <span onClick={(e) => { e.stopPropagation(); onRemove(); }} className="text-dim hover:text-fg text-sm leading-none">✕</span>}
    </button>
  );
}
