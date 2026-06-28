import { useRef, type ReactNode } from "react";
import { gradientFor, monogram } from "./helpers";
import { PlayIcon, PauseIcon, PrevIcon, NextIcon, VolumeIcon, PipIcon, FullscreenIcon } from "./icons";

export interface NowPlaying {
  name: string;
  sub: string;
  seed: string; // logo gradient seed (channel/station/video id or name)
  logo?: string | null; // logo image URL, if any
  statusLabel: ReactNode; // e.g. "LIVE · 1080p"
}

interface Props {
  nowPlaying: NowPlaying | null;
  playing: boolean;
  onTogglePlay: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  volume: number;
  muted: boolean;
  onVolume: (v: number) => void;
  onToggleMute: () => void;
  onPip?: () => void;
  onFullscreen?: () => void;
  /** YouTube has no app-level transport (the iframe owns playback) — hide prev/play/next. */
  hideTransport?: boolean;
}

/** Full-width transport bar at the bottom of the body (above the status strip), matching the mockup:
 *  now-playing on the left, prev/play/next centered, volume + PiP + fullscreen on the right. */
export function TransportBar({
  nowPlaying, playing, onTogglePlay, onPrev, onNext,
  volume, muted, onVolume, onToggleMute, onPip, onFullscreen, hideTransport,
}: Props) {
  const shown = muted ? 0 : volume;
  return (
    <div className="h-[60px] shrink-0 border-t border-edge bg-gradient-to-b from-elevated to-surface flex items-center gap-4 px-[18px]">
      {/* now playing */}
      <div className="flex items-center gap-3 w-[260px] min-w-0">
        {nowPlaying ? (
          <>
            <Logo seed={nowPlaying.seed} logo={nowPlaying.logo} />
            <div className="min-w-0">
              <div className="font-semibold text-[13px] truncate text-bright">{nowPlaying.name}</div>
              <div className="text-accent text-[11px] font-semibold flex items-center gap-1.5 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_6px_var(--tw-shadow-color)] shadow-accent" />
                <span className="truncate">{nowPlaying.statusLabel}</span>
              </div>
            </div>
          </>
        ) : (
          <div className="text-dim text-[12px]">Nothing playing</div>
        )}
      </div>

      {/* transport */}
      {!hideTransport && (
        <div className="flex items-center gap-1.5 mx-auto">
          <button onClick={onPrev} disabled={!onPrev} title="Previous"
            className="w-[38px] h-[38px] rounded-[10px] grid place-items-center text-muted hover:bg-elevated hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent">
            <PrevIcon />
          </button>
          <button onClick={onTogglePlay} title={playing ? "Pause" : "Play"}
            className="w-11 h-11 rounded-[10px] grid place-items-center bg-accent text-accent-fg shadow-lg shadow-accent/30 hover:bg-accent-hover">
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button onClick={onNext} disabled={!onNext} title="Next"
            className="w-[38px] h-[38px] rounded-[10px] grid place-items-center text-muted hover:bg-elevated hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent">
            <NextIcon />
          </button>
        </div>
      )}
      {hideTransport && <div className="mx-auto" />}

      {/* right controls */}
      <div className="flex items-center gap-3.5 w-[260px] justify-end">
        <div className="flex items-center gap-2.5 text-muted w-[150px]">
          <button onClick={onToggleMute} title={muted ? "Unmute" : "Mute"} className="shrink-0 hover:text-fg">
            <VolumeIcon muted={muted || volume === 0} />
          </button>
          <VolumeSlider value={shown} onChange={onVolume} />
        </div>
        {onPip && (
          <button onClick={onPip} title="Picture-in-picture"
            className="w-[34px] h-[34px] rounded-[9px] grid place-items-center text-muted hover:bg-elevated hover:text-fg"><PipIcon /></button>
        )}
        {onFullscreen && (
          <button onClick={onFullscreen} title="Fullscreen"
            className="w-[34px] h-[34px] rounded-[9px] grid place-items-center text-muted hover:bg-elevated hover:text-fg"><FullscreenIcon /></button>
        )}
      </div>
    </div>
  );
}

function Logo({ seed, logo }: { seed: string; logo?: string | null }) {
  if (logo) {
    return <img src={logo} alt="" className="w-[38px] h-[38px] rounded-lg object-contain bg-surface shrink-0" onError={(e) => { (e.currentTarget.style.display = "none"); }} />;
  }
  return (
    <div className="w-[38px] h-[38px] rounded-lg shrink-0 grid place-items-center font-bold text-[12px] text-white tracking-tight" style={{ background: gradientFor(seed) }}>
      {monogram(seed)}
    </div>
  );
}

/** Thin draggable volume bar (green fill + white knob) — pointer down/drag anywhere on the track. */
function VolumeSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const setFromEvent = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    onChange(Math.round(ratio * 100));
  };
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    setFromEvent(e.clientX);
    const move = (ev: PointerEvent) => setFromEvent(ev.clientX);
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div ref={ref} onPointerDown={onPointerDown} className="flex-1 h-2 flex items-center cursor-pointer group" title={`Volume ${value}%`}>
      <div className="relative w-full h-1 rounded-full bg-edge-strong">
        <div className="absolute left-0 top-0 bottom-0 rounded-full bg-accent" style={{ width: `${value}%` }} />
        <div className="absolute top-1/2 w-2.5 h-2.5 rounded-full bg-white shadow -translate-x-1/2 -translate-y-1/2" style={{ left: `${value}%` }} />
      </div>
    </div>
  );
}
