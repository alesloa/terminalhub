import { useEffect, useRef, useState } from "react";
import type { TvChannel } from "../../api/types";
import { gradientFor, monogram, channelQuality } from "./helpers";
import { StarIcon } from "./icons";

interface Props {
  channels: TvChannel[];
  currentId: string | null;
  favIds: Set<string>;
  onPlay: (c: TvChannel) => void;
  onToggleFav: (c: TvChannel) => void;
}

const PAGE = 50; // rows rendered at a time; grows on scroll (the catalog can be thousands of channels)

/** The right-hand browse rail: the filtered channel list. Windowed so a 3,000-channel catalog stays
 *  smooth — more rows mount as you near the bottom. */
export function ChannelList({ channels, currentId, favIds, onPlay, onToggleFav }: Props) {
  const [count, setCount] = useState(PAGE);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset the window whenever the underlying list changes (filter/search/sort).
  useEffect(() => { setCount(PAGE); scrollRef.current?.scrollTo({ top: 0 }); }, [channels]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) {
      setCount((c) => (c < channels.length ? c + PAGE : c));
    }
  };

  const rows = channels.slice(0, count);

  return (
    <div className="w-[330px] shrink-0 border-l border-edge flex flex-col min-h-0">
      <div className="px-3.5 pt-3 pb-2 text-[11px] font-bold tracking-wide text-dim flex items-center justify-between">
        <span>CHANNELS</span>
        <span className="font-medium text-dim">{channels.length.toLocaleString()} · A–Z</span>
      </div>
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-auto px-2.5 pb-3.5 flex flex-col gap-1">
        {channels.length === 0 && (
          <div className="px-3 py-8 text-center text-dim text-[12.5px]">No channels match these filters.</div>
        )}
        {rows.map((c) => {
          const playing = c.id === currentId;
          const fav = favIds.has(c.id);
          const q = channelQuality(c);
          const cat = c.categories[0];
          return (
            <button key={c.id} onClick={() => onPlay(c)}
              className={`group flex items-center gap-2.5 px-2.5 py-2 rounded-[9px] text-left ${playing ? "bg-accent/15 border border-accent/35" : "hover:bg-elevated border border-transparent"}`}>
              <Logo channel={c} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-[13px] truncate text-fg">{c.name}</div>
                <div className="text-dim text-[11.5px] mt-px flex items-center gap-1.5 truncate">
                  {c.country?.flag && <span className="text-[12px]">{c.country.flag}</span>}
                  <span className="truncate">{[cat, q].filter(Boolean).join(" · ") || "Live"}</span>
                </div>
              </div>
              {playing ? (
                <span className="tr-eq text-accent shrink-0"><i /><i /><i /></span>
              ) : (
                <span role="button" tabIndex={-1} title={fav ? "Remove favorite" : "Add favorite"}
                  onClick={(e) => { e.stopPropagation(); onToggleFav(c); }}
                  className={`shrink-0 ${fav ? "text-accent opacity-100" : "text-dim opacity-0 group-hover:opacity-100 hover:text-fg"}`}>
                  <StarIcon filled={fav} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Logo({ channel }: { channel: TvChannel }) {
  const [broken, setBroken] = useState(false);
  if (channel.logo && !broken) {
    return (
      <img src={channel.logo} alt="" onError={() => setBroken(true)}
        className="w-10 h-10 rounded-lg object-contain bg-surface shrink-0" />
    );
  }
  return (
    <div className="w-10 h-10 rounded-lg shrink-0 grid place-items-center font-bold text-[13px] text-white tracking-tight"
      style={{ background: gradientFor(channel.id || channel.name) }}>
      {monogram(channel.name)}
    </div>
  );
}
