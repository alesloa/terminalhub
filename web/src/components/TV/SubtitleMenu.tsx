import { useEffect, useRef, useState } from "react";
import type { MediaTrack } from "./useHlsPlayer";
import { CcIcon } from "./icons";
import { Tooltip } from "./Tooltip";

// Caption colors (default white). Applied to video::cue by TvMode's managed <style>.
const SWATCHES = ["#ffffff", "#ffe34d", "#6ee787", "#56d4dd", "#ffa657", "#ff8ad8"];

/** CC control: a button (tinted green when a track is on) opening a popover to turn captions off, pick a
 *  track, or choose a caption color. Tracks are data-dependent — many streams carry none. */
export function SubtitleMenu({ tracks, active, color, onSelect, onColor }: {
  tracks: MediaTrack[];
  active: number; // -1 = off
  color: string;
  onSelect: (id: number) => void;
  onColor: (c: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  const on = active >= 0;
  return (
    <div ref={ref} className="relative">
      <Tooltip label="Subtitles">
        <button onClick={() => setOpen((o) => !o)}
          className={`w-[34px] h-[34px] rounded-[9px] grid place-items-center ${on ? "bg-accent/15 text-accent" : "text-muted hover:bg-elevated hover:text-fg"}`}>
          <CcIcon />
        </button>
      </Tooltip>
      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-[210px] rounded-lg border border-edge-strong bg-elevated shadow-xl p-1.5 text-[12.5px] z-50">
          <Row label="Off" active={!on} onClick={() => onSelect(-1)} />
          {tracks.map((t) => <Row key={t.id} label={t.label} active={active === t.id} onClick={() => onSelect(t.id)} />)}
          {tracks.length === 0 && <div className="px-2.5 py-2 text-dim text-[11.5px]">No subtitle tracks in this stream.</div>}
          <div className="border-t border-edge mt-1 pt-2 px-1.5">
            <div className="text-dim text-[10.5px] font-bold tracking-wider uppercase mb-1.5">Caption color</div>
            <div className="flex gap-1.5">
              {SWATCHES.map((c) => (
                <button key={c} onClick={() => onColor(c)} title={c} style={{ background: c }}
                  className={`w-6 h-6 rounded-md ${color.toLowerCase() === c ? "ring-2 ring-accent ring-offset-1 ring-offset-elevated" : "border border-edge"}`} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left ${active ? "text-bright" : "text-muted hover:bg-surface hover:text-fg"}`}>
      <span className={`w-3.5 text-[11px] ${active ? "text-accent" : "text-dim"}`}>{active ? "✓" : ""}</span>
      <span className="truncate flex-1">{label}</span>
    </button>
  );
}
