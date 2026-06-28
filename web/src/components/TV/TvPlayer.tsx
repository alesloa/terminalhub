import { type RefObject } from "react";
import type { PlayerStatus } from "./useHlsPlayer";
import { PlayIcon } from "./icons";

interface Props {
  videoRef: RefObject<HTMLVideoElement>;
  stageRef: RefObject<HTMLDivElement>;
  title: string | null;
  sub: string | null;
  status: PlayerStatus;
  quality: string | null;
  playing: boolean;
  onTogglePlay: () => void;
}

/** The video stage: the <video> (lives here so fullscreen targets the stage), the LIVE + quality
 *  badges, a center play button when idle/paused, a loading shimmer, and the bottom title overlay. */
export function TvPlayer({ videoRef, stageRef, title, sub, status, quality, playing, onTogglePlay }: Props) {
  const live = status === "playing";
  return (
    <div className="flex-1 min-w-0 flex flex-col p-4 gap-3">
      <div ref={stageRef}
        className="flex-1 rounded-xl relative overflow-hidden border border-edge-strong flex items-end bg-black">
        {/* atmospheric backdrop behind the video element (shows through when nothing is playing) */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(120% 120% at 70% 10%, rgba(84,155,255,.16), transparent 55%), radial-gradient(120% 120% at 20% 90%, rgba(63,185,80,.14), transparent 55%), linear-gradient(160deg,#1a2230,#15181d)" }} />

        <video ref={videoRef} playsInline className="absolute inset-0 w-full h-full bg-black object-contain"
          onClick={onTogglePlay} />

        {title && (
          <div className="absolute top-3.5 left-3.5 flex items-center gap-2 bg-black/50 backdrop-blur px-2.5 py-1 rounded-md text-[11px] font-bold tracking-wide">
            {live
              ? <><span className="w-2 h-2 rounded-full bg-error animate-pulse" />LIVE</>
              : <span className="text-dim">{status === "error" ? "OFFLINE" : status === "loading" ? "CONNECTING" : "PAUSED"}</span>}
          </div>
        )}
        {quality && live && (
          <div className="absolute top-3.5 right-3.5 bg-black/50 backdrop-blur px-2.5 py-1 rounded-md text-[11px] font-semibold text-dim">{quality} · HLS</div>
        )}

        {/* center control: play when idle/paused; spinner while connecting */}
        {!title && (
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-dim text-[14px] text-center px-6">Select a channel to start watching.</div>
          </div>
        )}
        {title && status !== "playing" && (
          <div className="absolute inset-0 grid place-items-center">
            {status === "loading" ? (
              <div className="w-12 h-12 rounded-full border-2 border-white/20 border-t-white/80 animate-spin" />
            ) : status === "error" ? (
              <div className="text-center">
                <div className="text-dim text-[13px] mb-2">This stream is unavailable.</div>
                <button onClick={onTogglePlay} className="px-3 h-7 inline-flex items-center rounded bg-elevated border border-edge-strong text-[12px] text-fg hover:bg-surface">Retry</button>
              </div>
            ) : (
              <button onClick={onTogglePlay} title="Play"
                className="w-[74px] h-[74px] rounded-full bg-white/10 backdrop-blur border border-white/20 grid place-items-center text-white hover:bg-white/20">
                <PlayIcon size={26} />
              </button>
            )}
          </div>
        )}

        {title && (
          <div className="relative w-full p-[18px] bg-gradient-to-b from-transparent to-black/60">
            <h2 className="text-[18px] font-semibold text-bright leading-tight">{title}</h2>
            {sub && <p className="text-dim text-[12.5px] mt-1">{sub}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
