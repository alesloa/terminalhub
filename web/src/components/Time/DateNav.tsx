interface Props {
  label: string;          // e.g. "Today, Sat 27 Jun" or "Jun 2026"
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}

/** ← [Today] label → navigation strip shared by the Day / Week / Calendar views. */
export function DateNav({ label, onPrev, onNext, onToday }: Props) {
  const btn = "w-7 h-7 inline-flex items-center justify-center rounded bg-elevated hover:bg-edge text-fg";
  return (
    <div className="flex items-center gap-2">
      <button onClick={onToday} className="px-2 h-7 inline-flex items-center rounded bg-elevated hover:bg-edge text-xs">Today</button>
      <div className="flex items-center gap-1">
        <button onClick={onPrev} title="Previous" className={btn}>←</button>
        <span className="px-2 text-sm min-w-[10rem] text-center select-none">{label}</span>
        <button onClick={onNext} title="Next" className={btn}>→</button>
      </div>
    </div>
  );
}
