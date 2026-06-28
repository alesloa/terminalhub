import { useEffect, useRef, useState, type RefObject } from "react";
import Hls from "hls.js";
import { api, getToken } from "../../api/client";
import type { TvStream } from "../../api/types";

// Robust HLS playback for the TV tool. Every stream is loaded through /api/tv/proxy (server injects
// Referer/User-Agent + CORS and rewrites .m3u8 children back through itself), so the browser only ever
// talks same-origin. Safari plays the proxied manifest natively; everyone else gets hls.js with
// network/media auto-recovery + a stall watchdog. `stats` drives the status strip; `status` the overlay.

export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "error";
export interface PlayerStats {
  quality: string | null; // e.g. "1080p"
  bitrateKbps: number; // bandwidth estimate
  bufferSec: number; // seconds buffered ahead of playhead
  levels: number; // number of quality renditions
}

const EMPTY_STATS: PlayerStats = { quality: null, bitrateKbps: 0, bufferSec: 0, levels: 0 };
const STALL_MS = 16000; // give up on a stream that hasn't produced a frame in this long → onFatal

export function useHlsPlayer(
  videoRef: RefObject<HTMLVideoElement>,
  stream: TvStream | null,
  opts: { onFatal?: () => void } = {},
) {
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [stats, setStats] = useState<PlayerStats>(EMPTY_STATS);
  const hlsRef = useRef<Hls | null>(null);
  const onFatalRef = useRef(opts.onFatal);
  onFatalRef.current = opts.onFatal;

  // (Re)attach the source whenever the stream changes.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) {
      setStatus("idle");
      setStats(EMPTY_STATS);
      return;
    }
    const src = api.tv.proxyUrl(stream);
    let destroyed = false;
    let started = false;
    setStatus("loading");
    setStats(EMPTY_STATS);

    const watchdog = window.setTimeout(() => { if (!started) fail(); }, STALL_MS);
    function clearWatch() { window.clearTimeout(watchdog); }

    function markPlaying() {
      if (destroyed) return;
      started = true;
      clearWatch();
      setStatus("playing");
    }
    function fail() {
      if (destroyed || started) return;
      setStatus("error");
      onFatalRef.current?.();
    }
    // The <video>'s own events are the source of truth for "is it actually playing".
    // Autoplay blocked (no user activation): not an error — stop the spinner and the watchdog so the
    // user can press play, which carries a fresh gesture.
    const tryPlay = () => video.play().catch((err: DOMException) => {
      if (destroyed) return;
      if (err?.name === "NotAllowedError") { clearWatch(); setStatus("paused"); }
    });
    const onPlaying = () => markPlaying();
    const onTime = () => { if (video.currentTime > 0) markPlaying(); };
    const onWaiting = () => { if (started && !destroyed) setStatus("loading"); };
    video.addEventListener("playing", onPlaying);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("waiting", onWaiting);

    const cleanupVideo = () => {
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("waiting", onWaiting);
    };

    // Native HLS (Safari/iOS): the proxied manifest plays directly off the <video> element.
    if (!Hls.isSupported() && video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      const onMeta = () => tryPlay();
      video.addEventListener("loadedmetadata", onMeta, { once: true });
      video.addEventListener("error", fail);
      return () => {
        destroyed = true; clearWatch(); cleanupVideo();
        video.removeEventListener("loadedmetadata", onMeta);
        video.removeEventListener("error", fail);
        video.removeAttribute("src");
        video.load();
      };
    }

    if (!Hls.isSupported()) { fail(); clearWatch(); cleanupVideo(); return; }

    const hls = new Hls({
      // NOTE: lowLatencyMode is intentionally OFF — these are ordinary live HLS feeds (not LL-HLS), and
      // turning it on makes hls.js wait at the live edge for blocking-reload/parts that never arrive,
      // which presents to the user as an endless "loading" spinner.
      enableWorker: true,
      backBufferLength: 30,
      manifestLoadingMaxRetry: 4,
      levelLoadingMaxRetry: 4,
      fragLoadingMaxRetry: 6,
    });
    hlsRef.current = hls;
    hls.loadSource(src);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => tryPlay());
    hls.on(Hls.Events.FRAG_BUFFERED, () => markPlaying());

    let netRetries = 0;
    hls.on(Hls.Events.ERROR, (_evt, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && netRetries < 3) {
        netRetries += 1;
        hls.startLoad(); // re-request from the live edge
        return;
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError();
        return;
      }
      fail();
    });

    return () => {
      destroyed = true;
      clearWatch();
      cleanupVideo();
      hls.destroy();
      hlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream?.url, stream?.referrer, stream?.userAgent]);

  // Live stats (quality/bitrate/buffer), sampled once a second while a stream is attached.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const id = window.setInterval(() => {
      const hls = hlsRef.current;
      const buffered = video.buffered;
      const bufferSec = buffered.length ? Math.max(0, buffered.end(buffered.length - 1) - video.currentTime) : 0;
      const level = hls && hls.currentLevel >= 0 ? hls.levels[hls.currentLevel] : undefined;
      const quality = level?.height ? `${level.height}p` : video.videoHeight ? `${video.videoHeight}p` : null;
      const bitrateKbps = hls ? Math.round((hls.bandwidthEstimate || 0) / 1000) : 0;
      setStats({ quality, bitrateKbps, bufferSec: Number(bufferSec.toFixed(1)), levels: hls?.levels?.length ?? 0 });
    }, 1000);
    return () => window.clearInterval(id);
  }, [videoRef]);

  return { status, stats };
}
