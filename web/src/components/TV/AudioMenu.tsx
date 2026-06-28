import { useEffect, useRef, useState } from "react";
import type { MediaTrack } from "./useHlsPlayer";
import { LanguagesIcon } from "./icons";
import { Tooltip } from "./Tooltip";

/** Audio-language control (globe). Rendered only when a stream carries more than one audio track — a
 *  single-language feed has nothing to switch to. Picking a track also remembers the language so future
 *  multi-audio channels auto-select it. */
export function AudioMenu({ tracks, active, onPick }: {
  tracks: MediaTrack[];
  active: number;
  onPick: (t: MediaTrack) => void;
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

  return (
    <div ref={ref} className="relative">
      <Tooltip label="Audio language">
        <button onClick={() => setOpen((o) => !o)}
          className="w-[34px] h-[34px] rounded-[9px] grid place-items-center text-muted hover:bg-elevated hover:text-fg">
          <LanguagesIcon />
        </button>
      </Tooltip>
      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-[190px] rounded-lg border border-edge-strong bg-elevated shadow-xl p-1.5 text-[12.5px] z-50">
          <div className="text-dim text-[10.5px] font-bold tracking-wider uppercase px-2.5 pt-1 pb-1.5">Audio language</div>
          {tracks.map((t) => (
            <button key={t.id} onClick={() => { onPick(t); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left ${active === t.id ? "text-bright" : "text-muted hover:bg-surface hover:text-fg"}`}>
              <span className={`w-3.5 text-[11px] ${active === t.id ? "text-accent" : "text-dim"}`}>{active === t.id ? "✓" : ""}</span>
              <span className="truncate flex-1">{t.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
