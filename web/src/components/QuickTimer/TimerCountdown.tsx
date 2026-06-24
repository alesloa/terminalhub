import { useEffect, useState } from "react";
import { useTimers } from "../../store/timers";

// The live countdown pill that sits beside the launcher button while a Quick Timer is running.
// Ticks every second, shows the soonest timer's remaining mm:ss (h:mm:ss past an hour), and clears
// itself the moment a timer reaches zero (the notification fires server-side). Renders nothing when
// no timer is set.

/** Remaining ms → "mm:ss", or "h:mm:ss" once an hour or more is left. */
function fmt(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function TimerCountdown() {
  const timers = useTimers((s) => s.timers);
  const removeTimer = useTimers((s) => s.removeTimer);
  const [now, setNow] = useState(() => Date.now());

  // Tick once a second only while something is running; tear the interval down when nothing is.
  useEffect(() => {
    if (timers.length === 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [timers.length]);

  // Retire any timer that has reached its fire instant — its notification has gone out.
  useEffect(() => {
    for (const t of timers) if (t.fireAt - now <= 0) removeTimer(t.id);
  }, [now, timers, removeTimer]);

  if (timers.length === 0) return null;
  const soonest = timers.reduce((a, b) => (a.fireAt <= b.fireAt ? a : b));
  const remaining = soonest.fireAt - now;
  if (remaining <= 0) return null;
  const extra = timers.length - 1;

  return (
    <div title={`${soonest.title} · fires in ${fmt(remaining)}`}
      className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded bg-elevated text-bright text-xs select-none">
      <StopwatchIcon />
      <span className="tabular-nums font-medium">{fmt(remaining)}</span>
      {extra > 0 && <span className="text-dim">+{extra}</span>}
    </div>
  );
}

/** Compact stopwatch — matches the Timer launcher tile glyph. */
function StopwatchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-blue-400">
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 13.5V9.5" />
      <path d="M9.5 2.5h5" />
      <path d="M12 2.5v2.2" />
      <path d="M19.4 6.6l1.1-1.1" />
    </svg>
  );
}
