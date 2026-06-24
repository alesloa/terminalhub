import { useEffect, useRef, useState } from "react";
import { useUi } from "../../store/ui";

const prefersReducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** mm:ss for a millisecond remaining, rounded up so a 9.4s countdown still reads "00:10" → "00:09". */
function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

/**
 * The break / stand-up enforcer's visual layer. Mounted once at the app root; renders nothing until
 * the timer (useBreakTimer) signals a pre-warn or an active break through the ui store. NOT a draggable
 * window — it is deliberately a full-screen lock, so it does not use useDraggableWindow.
 *
 * - Pre-warn: a small, non-blocking corner heads-up so the lock never lands mid-keystroke.
 * - Active: a full-screen veil ABOVE every window/modal/toast (z-[200] > the z-[100] stats bar) that
 *   dims + blurs the app, blocks pointer events, and traps keyboard focus so nothing reaches a
 *   terminal underneath. The tmux sessions + agents keep running — only the human's screen is held.
 */
export function BreakOverlay() {
  const active = useUi((s) => s.breakActive);
  const prewarnMs = useUi((s) => s.breakPrewarnMs);
  if (active) return <Veil />;
  if (prewarnMs != null) return <PrewarnBanner ms={prewarnMs} />;
  return null;
}

/** A quiet bottom-right nudge before the hard lock — informational only, never blocks input. */
function PrewarnBanner({ ms }: { ms: number }) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[190] flex items-center gap-2 rounded-lg border border-edge-strong bg-canvas/95 px-3 py-2 text-sm shadow-2xl">
      <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
      <span className="text-fg">Break in <span className="font-semibold tabular-nums text-bright">{Math.max(0, Math.ceil(ms / 1000))}s</span></span>
    </div>
  );
}

function Veil() {
  const remainingMs = useUi((s) => s.breakRemainingMs);
  const isTest = useUi((s) => s.breakIsTest);
  const allowSkip = useUi((s) => s.breaks.allowSkip);
  const skipBreak = useUi((s) => s.skipBreak);
  const snoozeBreak = useUi((s) => s.snoozeBreak);

  const veilRef = useRef<HTMLDivElement>(null);
  const reduce = prefersReducedMotion();
  const [shown, setShown] = useState(reduce); // reduced motion: appear instantly, no fade
  useEffect(() => {
    if (reduce) return;
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [reduce]);

  // Trap focus inside the veil: focus it on mount, and pull focus back whenever it escapes — that
  // alone keeps keystrokes out of any terminal behind the veil (the terminal's textarea never holds
  // focus). Restore the prior focus when the break ends.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const focusInside = () => {
      const el = veilRef.current?.querySelector<HTMLElement>("[data-break-focus]") ?? veilRef.current;
      el?.focus();
    };
    focusInside();
    const onFocusIn = (e: FocusEvent) => {
      if (veilRef.current && !veilRef.current.contains(e.target as Node)) focusInside();
    };
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      try { prev?.focus(); } catch { /* element gone — fine */ }
    };
  }, []);

  // Test previews are always escapable so a hard-lock (allowSkip:false) preview can never trap you.
  const showSkip = allowSkip || isTest;

  return (
    <div
      ref={veilRef}
      role="dialog"
      aria-modal="true"
      aria-label="Break in progress"
      tabIndex={-1}
      data-break-focus
      // Swallow key events so nothing bubbles to app-level/terminal listeners. Buttons still activate
      // (Enter/Space) since that's the browser default on the focused element, not bubbling.
      onKeyDown={(e) => e.stopPropagation()}
      className="fixed inset-0 z-[200] flex items-center justify-center outline-none"
      style={{
        background: "rgba(0,0,0,0.72)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        opacity: shown ? 1 : 0,
        transition: reduce ? undefined : "opacity 280ms ease",
      }}
    >
      <div className="mx-4 flex w-full max-w-md flex-col items-center gap-6 rounded-2xl border border-edge-strong bg-canvas px-8 py-10 text-center shadow-2xl">
        {isTest && <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] uppercase tracking-wide text-dim">Preview</span>}
        <div>
          <h2 className="text-xl font-semibold text-bright">Time to step away</h2>
          <p className="mt-1 text-sm text-dim">Stand up, stretch, rest your eyes for a moment.</p>
        </div>
        <div className="text-6xl font-semibold tabular-nums text-bright" aria-live="off">{clock(remainingMs)}</div>
        <p className="text-xs text-dim">Your terminals and agents keep running — only this screen is paused.</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={snoozeBreak}
            className="rounded-lg bg-surface px-4 py-2 text-sm text-fg hover:bg-elevated"
          >
            Snooze 5 min
          </button>
          {showSkip && (
            <button
              type="button"
              onClick={skipBreak}
              className="rounded-lg px-4 py-2 text-sm text-dim hover:text-fg"
            >
              Skip — keep working
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
