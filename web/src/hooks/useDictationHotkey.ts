import { useEffect, useRef } from "react";
import { useUi } from "../store/ui";
import { matchesHotkey } from "../lib/hotkey";

/**
 * Global dictation shortcut. `enabled` should be true only for the focused room so that with
 * several rooms open exactly one responds.
 *
 * - "toggle": each press flips recording on/off (`onToggle`).
 * - "hold" (push-to-talk): record while the combo is held (`onHoldStart`), stop on release
 *   (`onHoldEnd`). On macOS the keyup for a normal key is suppressed while ⌘ is down, so we also
 *   treat the release of any modifier the combo requires as "let go" — otherwise a ⌘ combo would
 *   never stop.
 *
 * Listeners run in the capture phase so the combo beats xterm's own key handling, and
 * preventDefault stops the browser default (e.g. ⌘⇧R reload) where the browser allows it.
 */
export function useDictationHotkey(opts: {
  enabled: boolean;
  mode: "toggle" | "hold";
  onToggle: () => void;
  onHoldStart: () => void;
  onHoldEnd: () => void;
}): void {
  const hotkey = useUi((s) => s.dictationHotkey);
  const cb = useRef(opts);
  cb.current = opts;
  const holdingRef = useRef(false);

  useEffect(() => {
    if (!opts.enabled || !hotkey.code) return; // disabled, or no key bound (empty code) → attach nothing
    const { mode } = opts;

    const onDown = (e: KeyboardEvent) => {
      if (!matchesHotkey(e, hotkey)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return; // ignore auto-repeat while held
      if (mode === "toggle") {
        cb.current.onToggle();
      } else if (!holdingRef.current) {
        holdingRef.current = true;
        cb.current.onHoldStart();
      }
    };

    const onUp = (e: KeyboardEvent) => {
      if (mode !== "hold" || !holdingRef.current) return;
      const releasedComboKey =
        e.code === hotkey.code ||
        (hotkey.mod && (e.key === "Meta" || e.key === "Control")) ||
        (hotkey.shift && e.key === "Shift") ||
        (hotkey.alt && e.key === "Alt");
      if (!releasedComboKey) return;
      holdingRef.current = false;
      cb.current.onHoldEnd();
    };

    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      // If we unmount or disarm mid-hold, make sure we don't leave the mic stuck open.
      if (holdingRef.current) { holdingRef.current = false; cb.current.onHoldEnd(); }
    };
  }, [opts.enabled, opts.mode, hotkey]);
}
