import { useEffect, useRef, type RefObject } from "react";

// Bridges the shared transport store <-> a YouTube IFrame Player (YT.Player). A bare <iframe> can't be
// driven by external play/pause/volume buttons — the official API can. Two hard-won fixes live here:
//   1. SWAP GUARD — loadVideoById emits the OUTGOING video's transitional PAUSED(2)/ENDED(0) during the
//      swap; unguarded, the PAUSED immediately re-pauses the new video (so "every other one" failed) and
//      the ENDED fires autoplay-next. We ignore 2/0 while `swapping` is set, clearing it on PLAYING(1).
//   2. onReady gating — volume/mute and the desired video are applied inside onReady (commands sent before
//      ready are dropped → first video played at full volume / a pre-ready selection was lost).

interface YTPlayer {
  loadVideoById(id: string): void;
  playVideo(): void;
  pauseVideo(): void;
  setVolume(v: number): void;
  mute(): void;
  unMute(): void;
  destroy(): void;
}

let apiPromise: Promise<any> | null = null;
/** Load https://www.youtube.com/iframe_api once; resolves with window.YT when ready. */
function loadYT(): Promise<any> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const w = window as any;
    if (w.YT && w.YT.Player) { resolve(w.YT); return; }
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => { prev?.(); resolve(w.YT); };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(s);
    }
  });
  return apiPromise;
}

export function useYouTubePlayer(opts: {
  hostRef: RefObject<HTMLDivElement>;
  videoId: string | null;
  playing: boolean;
  volume: number;
  muted: boolean;
  onEnded: () => void;
  onError: (code: number) => void;
  onPlaying: () => void;
  setPlaying: (p: boolean) => void;
}) {
  const { hostRef, videoId, playing, volume, muted } = opts;
  const playerRef = useRef<YTPlayer | null>(null);
  const readyRef = useRef(false);
  const swappingRef = useRef(false);
  const desiredRef = useRef<string | null>(videoId);
  // Keep the latest callbacks + state in a ref so the once-created player always reads fresh values.
  const cb = useRef(opts);
  cb.current = opts;
  desiredRef.current = videoId;

  // Create the player ONCE, into an imperatively-created child node (YT replaces the node with its
  // iframe; doing that to a React-managed node throws removeChild on a later diff).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let destroyed = false;
    const mount = document.createElement("div");
    mount.style.width = "100%";
    mount.style.height = "100%";
    host.appendChild(mount);

    loadYT().then((YT) => {
      if (destroyed) return;
      playerRef.current = new YT.Player(mount, {
        width: "100%",
        height: "100%",
        videoId: desiredRef.current ?? undefined,
        playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: () => {
            readyRef.current = true;
            const p = playerRef.current;
            if (!p) return;
            p.setVolume(cb.current.muted ? 0 : cb.current.volume);
            if (cb.current.muted) p.mute(); else p.unMute();
            if (desiredRef.current) { swappingRef.current = true; p.loadVideoById(desiredRef.current); }
          },
          onStateChange: (e: { data: number }) => {
            if (e.data === 1) { // PLAYING — the swap is done; the new video is live
              swappingRef.current = false;
              cb.current.onPlaying();
              cb.current.setPlaying(true);
            } else if (e.data === 2) { // PAUSED — ignore the transitional pause emitted mid-swap
              if (!swappingRef.current) cb.current.setPlaying(false);
            } else if (e.data === 0) { // ENDED — ignore the transitional end emitted mid-swap
              if (!swappingRef.current) cb.current.onEnded();
            }
          },
          onError: (e: { data: number }) => { swappingRef.current = false; cb.current.onError(e.data); },
        },
      });
    });

    return () => {
      destroyed = true;
      readyRef.current = false;
      try { playerRef.current?.destroy(); } catch { /* already gone */ }
      playerRef.current = null;
      try { mount.remove(); } catch { /* already detached */ }
    };
  }, [hostRef]);

  // Switch the video when the selection changes (guarded so transitional events are ignored).
  useEffect(() => {
    if (!videoId || !readyRef.current || !playerRef.current) return;
    swappingRef.current = true;
    playerRef.current.loadVideoById(videoId);
  }, [videoId]);

  // Mirror play/pause intent onto the player.
  useEffect(() => {
    const p = playerRef.current;
    if (!p || !readyRef.current) return;
    if (playing) p.playVideo(); else p.pauseVideo();
  }, [playing]);

  // Mirror volume / mute onto the player.
  useEffect(() => {
    const p = playerRef.current;
    if (!p || !readyRef.current) return;
    p.setVolume(muted ? 0 : volume);
    if (muted) p.mute(); else p.unMute();
  }, [volume, muted]);
}
