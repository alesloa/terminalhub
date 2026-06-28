import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import Hls from "hls.js";
import { api } from "../../api/client";
import { useTv } from "./store";
import type { TvStream } from "../../api/types";

// Robust HLS playback for the TV tool. Every stream is loaded through /api/tv/proxy (server injects
// Referer/User-Agent + CORS and rewrites .m3u8 children back through itself), so the browser only ever
// talks same-origin. Safari plays the proxied manifest natively; everyone else gets hls.js with
// network/media auto-recovery + a stall watchdog. `stats` drives the status strip; `status` the overlay.
// The hook ALSO captures (data-dependent) subtitle tracks, audio tracks, and the now-playing programme
// title, and exposes select* controls so the transport bar can drive the live instance.

export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "error";
export interface PlayerStats {
  quality: string | null; // e.g. "1080p"
  bitrateKbps: number; // bandwidth estimate
  bufferSec: number; // seconds buffered ahead of playhead
  levels: number; // number of quality renditions
}

export interface MediaTrack { id: number; label: string; lang: string }
export interface TrackState { tracks: MediaTrack[]; active: number } // active = -1 when none/off

const EMPTY_STATS: PlayerStats = { quality: null, bitrateKbps: 0, bufferSec: 0, levels: 0 };
const EMPTY_TRACKS: TrackState = { tracks: [], active: -1 };
const STALL_MS = 16000; // give up on a stream that hasn't produced a frame in this long → onFatal

/** Junk filter for a now-playing title: reject URLs, pure numbers/timestamps, and trivially-short
 *  strings, so we only ever surface a real programme/movie name. Broadcaster-dependent — most streams
 *  carry nothing, and that's expected (we show nothing). The channel-name echo is filtered by the caller. */
function looksLikeTitle(s: string): boolean {
  const t = s.trim();
  if (t.length < 2) return false;
  if (/:\/\//.test(t) || /^https?:/i.test(t)) return false; // a URL, not a title
  if (/^[\d:.\s/_-]+$/.test(t)) return false; // timestamps / numeric tokens
  return true;
}

export function useHlsPlayer(
  videoRef: RefObject<HTMLVideoElement>,
  stream: TvStream | null,
  opts: { onFatal?: () => void } = {},
) {
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [stats, setStats] = useState<PlayerStats>(EMPTY_STATS);
  const [programTitle, setProgramTitle] = useState<string | null>(null);
  const [subtitles, setSubtitles] = useState<TrackState>(EMPTY_TRACKS);
  const [audio, setAudio] = useState<TrackState>(EMPTY_TRACKS);
  const hlsRef = useRef<Hls | null>(null);
  const modeRef = useRef<"hls" | "native" | null>(null);
  const onFatalRef = useRef(opts.onFatal);
  onFatalRef.current = opts.onFatal;

  // (Re)attach the source whenever the stream changes.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) {
      setStatus("idle");
      setStats(EMPTY_STATS);
      setProgramTitle(null);
      setSubtitles(EMPTY_TRACKS);
      setAudio(EMPTY_TRACKS);
      modeRef.current = null;
      return;
    }
    const src = api.tv.proxyUrl(stream);
    let destroyed = false;
    let started = false;
    setStatus("loading");
    setStats(EMPTY_STATS);
    setProgramTitle(null);
    setSubtitles(EMPTY_TRACKS);
    setAudio(EMPTY_TRACKS);

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

    // --- Now-playing programme title from ID3 metadata cues (works for hls.js id3 + native) ---
    const pushTitle = (raw?: string | null) => { if (!destroyed && raw && looksLikeTitle(raw)) setProgramTitle(raw.trim()); };
    const metaTracks = new Set<TextTrack>();
    const onCueChange = (ev: Event) => {
      const tt = ev.target as TextTrack;
      const cues = tt.activeCues;
      if (!cues) return;
      for (let i = 0; i < cues.length; i++) {
        const cue = cues[i] as VTTCue & { value?: { key?: string; data?: unknown } };
        if (cue.value?.key === "TIT2" && typeof cue.value.data === "string") pushTitle(cue.value.data);
        else if (typeof cue.text === "string") pushTitle(cue.text);
      }
    };
    const watchMeta = (tt: TextTrack) => {
      if (tt.kind !== "metadata" || metaTracks.has(tt)) return;
      metaTracks.add(tt);
      tt.mode = "hidden"; // cuechange fires without rendering the (non-text) metadata
      tt.addEventListener("cuechange", onCueChange);
    };
    const onAddTrack = (ev: Event) => { const t = (ev as TrackEvent).track; if (t) watchMeta(t); };
    for (let i = 0; i < video.textTracks.length; i++) watchMeta(video.textTracks[i]);
    video.textTracks.addEventListener("addtrack", onAddTrack);

    const cleanupVideo = () => {
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("waiting", onWaiting);
      video.textTracks.removeEventListener("addtrack", onAddTrack);
      metaTracks.forEach((tt) => tt.removeEventListener("cuechange", onCueChange));
      metaTracks.clear();
    };

    // Native HLS (Safari/iOS): the proxied manifest plays directly off the <video> element.
    if (!Hls.isSupported() && video.canPlayType("application/vnd.apple.mpegurl")) {
      modeRef.current = "native";
      video.src = src;
      const captureNative = () => {
        if (destroyed) return;
        const tt = video.textTracks;
        const subs: MediaTrack[] = [];
        let subActive = -1;
        for (let i = 0; i < tt.length; i++) {
          const t = tt[i];
          if (t.kind === "subtitles" || t.kind === "captions") {
            subs.push({ id: i, label: t.label || t.language || `Track ${subs.length + 1}`, lang: t.language || "" });
            if (t.mode === "showing") subActive = i;
          }
        }
        setSubtitles({ tracks: subs, active: subActive });

        const at = (video as unknown as { audioTracks?: ArrayLike<{ label: string; language: string; enabled: boolean }> }).audioTracks;
        if (at) {
          const auds: MediaTrack[] = [];
          let audActive = -1;
          for (let i = 0; i < at.length; i++) {
            const t = at[i];
            auds.push({ id: i, label: t.label || t.language || `Audio ${i + 1}`, lang: t.language || "" });
            if (t.enabled) audActive = i;
          }
          // Auto-apply the remembered language when more than one track is offered.
          const pref = useTv.getState().preferredAudioLang.trim().toLowerCase();
          if (pref && auds.length > 1) {
            const m = auds.find((t) => t.lang.toLowerCase().includes(pref) || t.label.toLowerCase().includes(pref));
            if (m && !at[m.id].enabled) { for (let i = 0; i < at.length; i++) at[i].enabled = i === m.id; audActive = m.id; }
          }
          setAudio({ tracks: auds, active: audActive });
        }
      };
      const onMeta = () => { tryPlay(); captureNative(); };
      video.addEventListener("loadedmetadata", onMeta);
      video.textTracks.addEventListener("change", captureNative);
      video.addEventListener("error", fail);
      return () => {
        destroyed = true; clearWatch(); cleanupVideo();
        video.removeEventListener("loadedmetadata", onMeta);
        video.textTracks.removeEventListener("change", captureNative);
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
    modeRef.current = "hls";
    hls.loadSource(src);
    hls.attachMedia(video);
    hls.subtitleDisplay = false; // default captions OFF until the user turns them on
    hls.on(Hls.Events.MANIFEST_PARSED, () => tryPlay());
    hls.on(Hls.Events.FRAG_BUFFERED, () => markPlaying());

    // Subtitle / audio track capture + the now-playing title from EXTINF (FAST/movie channels).
    hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_e, data) => {
      if (destroyed) return;
      const tracks = data.subtitleTracks.map((t) => ({ id: t.id, label: t.name || t.lang || `Track ${t.id + 1}`, lang: t.lang || "" }));
      setSubtitles({ tracks, active: hls.subtitleDisplay ? hls.subtitleTrack : -1 });
    });
    hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_e, data) => {
      if (!destroyed) setSubtitles((s) => ({ ...s, active: hls.subtitleDisplay ? data.id : -1 }));
    });
    hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_e, data) => {
      if (destroyed) return;
      const tracks = data.audioTracks.map((t) => ({ id: t.id, label: t.name || t.lang || `Audio ${t.id + 1}`, lang: t.lang || "" }));
      setAudio({ tracks, active: hls.audioTrack });
      // Auto-select the remembered language on multi-audio streams (single-audio feeds can't switch).
      const pref = useTv.getState().preferredAudioLang.trim().toLowerCase();
      if (pref && tracks.length > 1) {
        const m = tracks.find((t) => t.lang.toLowerCase().includes(pref) || t.label.toLowerCase().includes(pref));
        if (m && m.id !== hls.audioTrack) hls.audioTrack = m.id;
      }
    });
    hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_e, data) => { if (!destroyed) setAudio((a) => ({ ...a, active: data.id })); });
    hls.on(Hls.Events.FRAG_CHANGED, (_e, data) => { pushTitle(data.frag?.title); });

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
      modeRef.current = null;
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

  // Off = -1. hls.js drives the live instance; native flips textTrack/audioTrack modes directly.
  const selectSubtitle = useCallback((id: number) => {
    const hls = hlsRef.current;
    if (modeRef.current === "hls" && hls) {
      if (id < 0) { hls.subtitleDisplay = false; hls.subtitleTrack = -1; }
      else { hls.subtitleDisplay = true; hls.subtitleTrack = id; }
      setSubtitles((s) => ({ ...s, active: id }));
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    const tt = video.textTracks;
    for (let i = 0; i < tt.length; i++) {
      const t = tt[i];
      if (t.kind === "subtitles" || t.kind === "captions") t.mode = i === id ? "showing" : "disabled";
    }
    setSubtitles((s) => ({ ...s, active: id }));
  }, [videoRef]);

  const selectAudio = useCallback((id: number) => {
    const hls = hlsRef.current;
    if (modeRef.current === "hls" && hls) { hls.audioTrack = id; setAudio((a) => ({ ...a, active: id })); return; }
    const video = videoRef.current;
    const at = video && (video as unknown as { audioTracks?: ArrayLike<{ enabled: boolean }> }).audioTracks;
    if (!at) return;
    for (let i = 0; i < at.length; i++) at[i].enabled = i === id;
    setAudio((a) => ({ ...a, active: id }));
  }, [videoRef]);

  return { status, stats, programTitle, subtitles, audio, selectSubtitle, selectAudio };
}
