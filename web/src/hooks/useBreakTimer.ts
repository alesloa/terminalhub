import { useCallback, useEffect, useRef } from "react";
import { useUi } from "../store/ui";
import { speak } from "../lib/speech";
import { readBreakAnchor, writeBreakAnchor } from "../lib/breaks";

const SNOOZE_MS = 5 * 60_000;

type Runtime = { breakActive: boolean; breakRemainingMs: number; breakPrewarnMs: number | null; breakIsTest: boolean };
const IDLE: Runtime = { breakActive: false, breakRemainingMs: 0, breakPrewarnMs: null, breakIsTest: false };

const minMs = (m: number) => Math.max(1, m) * 60_000;

/**
 * Drives the recurring break / stand-up enforcer. Counts down to each break off a localStorage anchor
 * (so a refresh doesn't reset it), freezes accrual while the tab is hidden (`pauseWhenHidden`), shows
 * a pre-warn heads-up, then fires a break and counts its duration down. All visual state is pushed to
 * the ui store for BreakOverlay to render; skip / snooze / test arrive as store command nonces.
 * Mount once, at the app root.
 */
export function useBreakTimer() {
  const breaks = useUi((s) => s.breaks);
  const setBreakRuntime = useUi((s) => s.setBreakRuntime);
  const skipSeq = useUi((s) => s.breakSkipSeq);
  const snoozeSeq = useUi((s) => s.breakSnoozeSeq);
  const testSeq = useUi((s) => s.breakTestSeq);
  const voiceName = useUi((s) => s.voiceName);
  const voiceRate = useUi((s) => s.voiceRate);
  const voiceVolume = useUi((s) => s.voiceVolume);

  // Live config/voice the 1s tick reads without re-subscribing the interval.
  const cfg = useRef(breaks); cfg.current = breaks;
  const voice = useRef({ voiceName, voiceRate, voiceVolume }); voice.current = { voiceName, voiceRate, voiceVolume };

  const phase = useRef<"counting" | "onbreak">("counting");
  const remaining = useRef(0);   // ms until the next break (counting phase)
  const breakEndsAt = useRef(0); // epoch ms the active break ends (onbreak phase)
  const lastTick = useRef(Date.now());
  const isTest = useRef(false);
  const lastRt = useRef<Runtime>(IDLE);

  // Push runtime to the store only when it actually changes, so an idle second never re-renders.
  const pushRuntime = useCallback((rt: Runtime) => {
    const p = lastRt.current;
    if (p.breakActive === rt.breakActive && p.breakRemainingMs === rt.breakRemainingMs && p.breakPrewarnMs === rt.breakPrewarnMs && p.breakIsTest === rt.breakIsTest) return;
    lastRt.current = rt;
    setBreakRuntime(rt);
  }, [setBreakRuntime]);

  // Timing actions, recreated each render so the interval/command effects always run the latest
  // closures (they only read refs + the stable pushRuntime).
  const scheduleNext = (now: number) => {
    phase.current = "counting";
    isTest.current = false;
    remaining.current = minMs(cfg.current.intervalMinutes);
    writeBreakAnchor(now + remaining.current);
  };
  const startBreak = (now: number, durationMinutes: number, speakOn: boolean, test: boolean) => {
    phase.current = "onbreak";
    isTest.current = test;
    breakEndsAt.current = now + minMs(durationMinutes);
    if (speakOn) speak("Time for a break. Stand up and stretch.", voice.current.voiceName, voice.current.voiceRate, voice.current.voiceVolume);
    pushRuntime({ breakActive: true, breakRemainingMs: breakEndsAt.current - now, breakPrewarnMs: null, breakIsTest: test });
  };
  const endBreak = (now: number) => {
    scheduleNext(now);
    lastTick.current = now;
    pushRuntime(IDLE);
  };
  const snooze = (now: number) => {
    phase.current = "counting";
    isTest.current = false;
    remaining.current = SNOOZE_MS;
    writeBreakAnchor(now + SNOOZE_MS);
    lastTick.current = now;
    pushRuntime(IDLE);
  };
  const tick = () => {
    const now = Date.now();
    const dt = now - lastTick.current;
    lastTick.current = now;
    const c = cfg.current;

    if (phase.current === "onbreak") {
      const rem = Math.max(0, breakEndsAt.current - now);
      pushRuntime({ breakActive: true, breakRemainingMs: rem, breakPrewarnMs: null, breakIsTest: isTest.current });
      if (rem <= 0) endBreak(now);
      return;
    }
    // counting phase — never accrue (or fire) while disabled or, when configured, while the tab is hidden
    if (!c.enabled) { pushRuntime(IDLE); return; }
    if (c.pauseWhenHidden && typeof document !== "undefined" && document.hidden) return;

    remaining.current -= dt;
    writeBreakAnchor(now + Math.max(0, remaining.current));

    if (remaining.current <= 0) { startBreak(now, c.durationMinutes, c.speak, false); return; }
    const preWarnMs = Math.max(0, c.preWarnSeconds) * 1000;
    if (preWarnMs > 0 && remaining.current <= preWarnMs) {
      pushRuntime({ breakActive: false, breakRemainingMs: 0, breakPrewarnMs: remaining.current, breakIsTest: false });
    } else {
      pushRuntime(IDLE);
    }
  };

  const apiRef = useRef({ tick, endBreak, snooze, startBreak });
  apiRef.current = { tick, endBreak, snooze, startBreak };

  // (Re)initialize the counting anchor when breaks are enabled or the interval changes. Resume only
  // from a FUTURE anchor (a refresh mid-cycle) — a missing or already-past one (fresh enable, or the
  // tab was closed past the break) starts a clean interval instead of firing instantly.
  useEffect(() => {
    if (!breaks.enabled) return;
    if (phase.current === "onbreak") return; // don't interrupt a running break (e.g. a test)
    const now = Date.now();
    const stored = readBreakAnchor();
    const intervalMs = minMs(breaks.intervalMinutes);
    if (stored != null && stored > now) {
      remaining.current = Math.min(stored - now, intervalMs);
    } else {
      remaining.current = intervalMs;
      writeBreakAnchor(now + remaining.current);
    }
    lastTick.current = now;
    phase.current = "counting";
  }, [breaks.enabled, breaks.intervalMinutes]);

  // One 1-second tick for the whole lifetime, plus a visibility hook: on returning to a paused tab,
  // reset the accrual baseline so the hidden gap isn't counted (honors pauseWhenHidden).
  useEffect(() => {
    const onVis = () => { if (!document.hidden && cfg.current.pauseWhenHidden) lastTick.current = Date.now(); };
    document.addEventListener("visibilitychange", onVis);
    const id = window.setInterval(() => apiRef.current.tick(), 1000);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  // Command nonces from the overlay / Settings. Each effect acts only when its seq actually changed
  // from the last value it handled — NOT a boolean mount-guard. StrictMode (dev) double-invokes mount
  // effects (setup → cleanup → setup on the same instance/ref); a boolean toggled inside the effect
  // is already flipped on the second invoke, so it would fire the command on every refresh — that
  // surfaced as a "Test now" preview popping up on every page load. Seeding each ref with the current
  // seq makes both StrictMode invokes a no-op (seq === lastHandled), while a real bump still fires once.
  // Skip ends the break + reschedules; snooze pushes it out 5 min; test fires a preview break now.
  const lastSkip = useRef(skipSeq);
  useEffect(() => {
    if (skipSeq === lastSkip.current) return;
    lastSkip.current = skipSeq;
    apiRef.current.endBreak(Date.now());
  }, [skipSeq]);
  const lastSnooze = useRef(snoozeSeq);
  useEffect(() => {
    if (snoozeSeq === lastSnooze.current) return;
    lastSnooze.current = snoozeSeq;
    apiRef.current.snooze(Date.now());
  }, [snoozeSeq]);
  const lastTest = useRef(testSeq);
  useEffect(() => {
    if (testSeq === lastTest.current) return;
    lastTest.current = testSeq;
    const t = useUi.getState().breakTestCfg;
    apiRef.current.startBreak(Date.now(), t.durationMinutes, t.speak, true);
  }, [testSeq]);
}
