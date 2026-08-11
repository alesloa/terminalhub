import { useCallback, useState } from "react";

/**
 * Text-size zoom for the GUI chat — the +/− cluster that floats in the chat's top-right corner.
 *
 * The chat is ordinary DOM, not an xterm grid, so there is no font-size knob to turn: it scales with
 * CSS `zoom` on the whole chat subtree, which takes the transcript, the tool cards, the approval bar
 * and the composer you type into with it, in one number. `zoom` (unlike a transform) participates in
 * layout, so lines re-wrap at the new size instead of being stretched and clipped.
 *
 * The preference is per-device and shared by every chat, not per terminal: "I can't read this" is
 * about the screen, not about one conversation.
 */

const ZOOM_KEY = "tr:guiZoom";

// Held as whole percent, not as a multiplier: one press is exactly five percent, and integers can't
// drift the way repeatedly adding 0.05 to a float would.
const ZOOM_MIN = 75;
const ZOOM_MAX = 250;
const ZOOM_STEP = 5;
const ZOOM_DEFAULT = 100;

const clamp = (pct: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pct));

export interface GuiZoom {
  /** The CSS `zoom` multiplier. */
  zoom: number;
  percent: number;
  step: (delta: 1 | -1) => void;
  reset: () => void;
  atMin: boolean;
  atMax: boolean;
}

const save = (percent: number) => {
  try { localStorage.setItem(ZOOM_KEY, String(percent)); } catch { /* private mode / quota — ignore */ }
};

export function useGuiZoom(): GuiZoom {
  const [percent, setPercent] = useState<number>(() => {
    const saved = Number(localStorage.getItem(ZOOM_KEY));
    // Must still be a stop on the current scale: an older build stored a multiplier, and anything
    // off the grid would leave every subsequent press landing on a stray value.
    const valid = Number.isInteger(saved) && saved >= ZOOM_MIN && saved <= ZOOM_MAX
      && saved % ZOOM_STEP === 0;
    return valid ? saved : ZOOM_DEFAULT;
  });

  const step = useCallback((delta: 1 | -1) => {
    setPercent((prev) => {
      const next = clamp(prev + delta * ZOOM_STEP);
      save(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => { save(ZOOM_DEFAULT); setPercent(ZOOM_DEFAULT); }, []);

  return {
    zoom: percent / 100,
    percent,
    step,
    reset,
    atMin: percent <= ZOOM_MIN,
    atMax: percent >= ZOOM_MAX,
  };
}

/** Floating +/− with the current percentage between them, five percent a press; the percentage is a
 *  button that goes back to 100%. Faint until hovered, same treatment as the terminal pane's own
 *  control cluster — and it lives OUTSIDE the zoomed subtree, so it stays the same size whatever the
 *  chat is set to. */
export function ZoomControl({ percent, step, reset, atMin, atMax }: GuiZoom) {
  const cell = "inline-flex h-6 items-center justify-center bg-panel/85 leading-none hover:bg-surface hover:text-bright disabled:opacity-30 disabled:hover:bg-panel/85";
  return (
    <div
      // mousedown is swallowed so clicking a button doesn't pull focus out of the composer — you can
      // resize mid-sentence and keep typing.
      onMouseDown={(e) => e.preventDefault()}
      className="absolute right-3 top-1.5 z-20 flex gap-px overflow-hidden rounded-md border border-edge bg-edge text-muted opacity-40 shadow-md transition-opacity hover:opacity-100 focus-within:opacity-100"
    >
      <button
        type="button" onClick={() => step(-1)} disabled={atMin}
        title="Smaller text" aria-label="Make the chat text smaller"
        className={`${cell} w-6 text-base`}
      >−</button>
      <button
        type="button" onClick={reset} disabled={percent === ZOOM_DEFAULT}
        title="Reset to 100%" aria-label="Reset the chat text size"
        className={`${cell} min-w-[2.6rem] px-1 text-[10px] tabular-nums`}
      >{percent}%</button>
      <button
        type="button" onClick={() => step(1)} disabled={atMax}
        title="Bigger text" aria-label="Make the chat text bigger"
        className={`${cell} w-6 text-base`}
      >+</button>
    </div>
  );
}
