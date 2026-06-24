import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { api } from "../../api/client";
import { isLocalHost } from "../../lib/host";

const MAX_ZOOM = 8;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Inline viewer for video files (mp4, mov, webm, mkv, …) — renders in the editor tab area exactly like
 * ImageView / PdfView, so clicking a video in the explorer plays it RIGHT THERE instead of dead-ending
 * on "File is too large." Streams the file straight off disk with HTTP byte-range support
 * (api.mediaFileUrl → /api/media/file), so a 4K/multi-GB file plays + seeks without ever loading into
 * memory (the base64 file-bytes route the other previews use caps at 25 MiB). Native <video controls>
 * handle play/seek/volume/PiP; scroll-to-zoom + drag-to-pan inspect detail, and a Fullscreen button
 * gives the crisp full view. A format the browser can't decode shows a Reveal / Open-externally
 * fallback. Reused by the File Browser's Quick Look for the same inline playback.
 */
export function VideoView({ path, name }: { path: string; name: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rate, setRate] = useState(1);

  // Mint the preview cookie before pointing <video> at the stream so the request carries auth on an
  // exposed (tunnelled) instance — a <video src> can't send a Bearer header (loopback needs neither).
  // previewSession no-ops on a tokenless/loopback instance, so this is safe everywhere.
  useEffect(() => {
    let alive = true;
    setErr(false); setSrc(null); setZoom(1); setPan({ x: 0, y: 0 }); setRate(1);
    api.previewSession().catch(() => {}).then(() => { if (alive) setSrc(api.mediaFileUrl(path)); });
    return () => { alive = false; };
  }, [path]);

  // Apply the chosen playback rate live; re-apply on src change in case the new media resets it.
  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = rate; }, [rate, src]);

  // Wheel-to-zoom over the video. Non-passive so preventDefault stops the pane from scrolling.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => clamp(+(z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)).toFixed(3), 1, MAX_ZOOM));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => { if (zoom === 1) setPan({ x: 0, y: 0 }); }, [zoom]);

  // Drag-to-pan when zoomed. No preventDefault, so a stationary click still reaches the controls.
  const onStagePointerDown = (e: ReactPointerEvent) => {
    if (zoom === 1) return;
    const sx = e.clientX, sy = e.clientY, start = pan;
    const move = (ev: PointerEvent) => setPan({ x: start.x + (ev.clientX - sx), y: start.y + (ev.clientY - sy) });
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const stepZoom = (factor: number) => setZoom((z) => clamp(+(z * factor).toFixed(3), 1, MAX_ZOOM));
  const fitZoom = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  const goFullscreen = () => { void videoRef.current?.requestFullscreen?.().catch(() => {}); };

  return (
    <div className="h-full flex flex-col bg-black">
      <div ref={stageRef} onPointerDown={onStagePointerDown} onDoubleClick={() => setZoom((z) => (z === 1 ? 2 : 1))}
        className="flex-1 min-h-0 relative flex items-center justify-center overflow-hidden"
        style={{ cursor: zoom > 1 ? "grab" : "default" }}>
        {src && !err && (
          <video ref={videoRef} src={src} controls playsInline onError={() => setErr(true)}
            onLoadedMetadata={() => { if (videoRef.current) videoRef.current.playbackRate = rate; }}
            className="max-w-full max-h-full"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "center center" }} />
        )}
        {!src && !err && <Centered>Loading…</Centered>}
        {err && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6">
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
      {/* Bottom toolbar — same shape as ImageView's: zoom controls + Fullscreen. */}
      <div className="shrink-0 flex items-center gap-1 h-7 px-3 text-xs text-dim border-t border-edge bg-panel">
        <button onClick={() => stepZoom(1 / 1.25)} disabled={err} title="Zoom out" className="px-1.5 hover:text-fg disabled:opacity-40">−</button>
        <span className="w-11 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
        <button onClick={() => stepZoom(1.25)} disabled={err} title="Zoom in" className="px-1.5 hover:text-fg disabled:opacity-40">+</button>
        <button onClick={fitZoom} disabled={err || zoom === 1} title="Reset zoom" className="px-1.5 hover:text-fg disabled:opacity-40">Fit</button>
        <span className="mx-1.5 w-px h-3.5 bg-edge" />
        <span>Speed</span>
        <input type="range" min={0.2} max={4} step={0.1} value={rate} disabled={err}
          onChange={(e) => setRate(+e.target.value)} title={`Playback speed ${rate.toFixed(1)}×`}
          className="w-24 accent-blue-500 cursor-pointer disabled:opacity-40" />
        <button onClick={() => setRate(1)} disabled={err} title="Reset speed to 1×"
          className="w-9 text-center tabular-nums hover:text-fg disabled:opacity-40">{rate.toFixed(1)}×</button>
        <span className="flex-1 min-w-0 truncate pl-2">scroll to zoom · drag to pan</span>
        <button onClick={goFullscreen} disabled={err} title="Fullscreen" className="hover:text-fg disabled:opacity-40">⤢ Fullscreen</button>
      </div>
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="h-full flex items-center justify-center text-dim text-sm">{children}</div>;
}
