interface Props {
  label: string;            // the date / range / month, e.g. "Saturday, 27 Jun" or "Jun 22 – Jun 28"
  prefix?: string;          // bold leading word ("Today") — day view shows it only when the day is today
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}

/** Harvest-style date nav: a single bordered pill with ← / → arrows around a calendar-icon label. No
 *  standalone "Today" button on any view — clicking the label jumps back to today, and the day view
 *  shows "Today" only as the bold prefix when the shown day is today. */
export function DateNav({ label, prefix, onPrev, onNext, onToday }: Props) {
  const arrow = "w-[34px] h-[32px] flex items-center justify-center text-dim hover:text-fg hover:bg-panel/60 transition-colors";
  return (
    <div className="flex items-center h-[34px] border-2 border-edge rounded-lg overflow-hidden select-none">
      <button onClick={onPrev} title="Previous" className={arrow}><ChevronLeft /></button>
      <button onClick={onToday} title="Jump to today" className="flex items-center gap-1.5 px-3 min-w-[190px] justify-center text-sm hover:bg-panel/40">
        <CalGlyph />
        <span>
          {prefix && <span className="font-semibold text-bright">{prefix} </span>}
          <span className="text-fg">{label}</span>
        </span>
      </button>
      <button onClick={onNext} title="Next" className={arrow}><ChevronRight /></button>
    </div>
  );
}

function CalGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-dim" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}
function ChevronLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
    </svg>
  );
}
function ChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
    </svg>
  );
}
