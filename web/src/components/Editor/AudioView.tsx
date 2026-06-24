import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../../api/client";
import { isLocalHost } from "../../lib/host";

/**
 * Inline viewer for audio files (mp3, m4a, aac, wav, flac, ogg, opus, …) — renders in the editor tab
 * area and the File Browser's Quick Look exactly like VideoView, so clicking an audio file plays it
 * RIGHT THERE instead of dead-ending on "binary file". Streams off disk with HTTP byte-range support
 * (api.mediaFileUrl → /api/media/file), so seeking works without loading the whole file into memory.
 * Native <audio controls> handles play/seek/volume. A container/codec the browser can't decode shows
 * a Reveal / Open-externally fallback. Reused by the File Browser's Quick Look for the same playback.
 */
export function AudioView({ path, name }: { path: string; name: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const [rate, setRate] = useState(1);

  // Mint the preview cookie before pointing <audio> at the stream so the request carries auth on an
  // exposed (tunnelled) instance — an <audio src> can't send a Bearer header (loopback needs neither).
  // previewSession no-ops on a tokenless/loopback instance, so this is safe everywhere.
  useEffect(() => {
    let alive = true;
    setErr(false); setSrc(null); setRate(1);
    api.previewSession().catch(() => {}).then(() => { if (alive) setSrc(api.mediaFileUrl(path)); });
    return () => { alive = false; };
  }, [path]);

  // Apply the chosen playback rate live; re-apply on src change in case the new media resets it.
  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = rate; }, [rate, src]);

  return (
    <div className="h-full flex flex-col items-center justify-center gap-5 bg-black px-6">
      {src && !err && (
        <>
          <NoteIcon />
          <div className="text-sm text-bright truncate max-w-[80%] text-center">{name}</div>
          <audio ref={audioRef} src={src} controls onError={() => setErr(true)}
            onLoadedMetadata={() => { if (audioRef.current) audioRef.current.playbackRate = rate; }}
            className="w-full max-w-md" />
          <div className="flex items-center gap-2 text-xs text-dim w-full max-w-md">
            <span>Speed</span>
            <input type="range" min={0.2} max={4} step={0.1} value={rate}
              onChange={(e) => setRate(+e.target.value)} title={`Playback speed ${rate.toFixed(1)}×`}
              className="flex-1 accent-blue-500 cursor-pointer" />
            <button onClick={() => setRate(1)} title="Reset speed to 1×"
              className="w-9 text-center tabular-nums hover:text-fg">{rate.toFixed(1)}×</button>
          </div>
        </>
      )}
      {!src && !err && <Centered>Loading…</Centered>}
      {err && (
        <div className="flex flex-col items-center justify-center gap-3 text-center">
          <div className="text-sm text-muted">Can’t play <span className="text-bright">{name}</span> in the browser.</div>
          <div className="text-xs text-dim">The browser doesn’t support this container/codec.</div>
          {isLocalHost && (
            <div className="flex gap-2 mt-1">
              <button onClick={() => void api.revealPath(path).catch(() => {})}
                className="px-3 py-1.5 bg-elevated hover:bg-edge rounded text-xs">Reveal in Finder</button>
              <button onClick={() => void api.openPath(path).catch(() => {})}
                className="px-3 py-1.5 bg-elevated hover:bg-edge rounded text-xs">Open externally</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NoteIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"
      strokeLinecap="round" strokeLinejoin="round" className="text-dim">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="h-full flex items-center justify-center text-dim text-sm">{children}</div>;
}
