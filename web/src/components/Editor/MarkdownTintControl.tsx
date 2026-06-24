import { useEffect, useRef, useState } from "react";
import { useUi } from "../../store/ui";

/**
 * A small popover in the Markdown editor header: two sliders that dim the reader's letter and
 * background brightness (per-browser) so a bright dark-theme document is easier on the eyes.
 * It only drives the store values; MarkdownPreview applies them to the editor's CSS vars. The
 * trigger stays lit while either level is off the theme default so the adjustment is discoverable.
 */
export function MarkdownTintControl() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const mdTextLevel = useUi(s => s.mdTextLevel);
  const mdBgLevel = useUi(s => s.mdBgLevel);
  const setMdTextLevel = useUi(s => s.setMdTextLevel);
  const setMdBgLevel = useUi(s => s.setMdBgLevel);
  const tuned = mdTextLevel !== 100 || mdBgLevel !== 100;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)} title="Adjust letter & background brightness" aria-label="Brightness"
        className={`grid h-6 w-6 place-items-center rounded ${open || tuned ? "bg-elevated text-bright" : "text-muted hover:bg-surface hover:text-fg"}`}>
        <BrightnessIcon />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-56 rounded border border-edge bg-panel p-3 text-xs shadow-lg">
          <TintRow label="Letters" value={mdTextLevel} min={40} max={100} onChange={setMdTextLevel} />
          <TintRow label="Background" value={mdBgLevel} min={60} max={180} onChange={setMdBgLevel} />
          <button onClick={() => { setMdTextLevel(100); setMdBgLevel(100); }}
            className="mt-1 w-full rounded px-2 py-1 text-[11px] text-muted hover:bg-elevated hover:text-fg">
            Reset to theme default
          </button>
        </div>
      )}
    </div>
  );
}

function TintRow({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number; onChange: (n: number) => void;
}) {
  return (
    <div className="mb-2 last:mb-0">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-fg">{label}</span>
        <span className="tabular-nums text-muted">{value}%</span>
      </div>
      <input type="range" min={min} max={max} step={1} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-blue-500" />
    </div>
  );
}

function BrightnessIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </svg>
  );
}
