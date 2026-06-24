import { useEffect, useState } from "react";

/**
 * Browser text-to-speech via the Web Speech API (`window.speechSynthesis`), spoken with the OS's
 * installed voices. Zero dependencies, zero network — Chrome, Firefox, Edge and Safari all ship it.
 * Everything here fails silently where the API is missing, so a notification can never throw.
 */
export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

/** The system voices available to the browser. Chrome populates these asynchronously, so this can
 *  be empty on the very first call until `voiceschanged` fires (see useVoices). */
export function listVoices(): SpeechSynthesisVoice[] {
  return speechSupported() ? window.speechSynthesis.getVoices() : [];
}

// Chrome's speechSynthesis has two long-standing failure modes this guards against:
//   1) The wedge — a speak() fired without a user gesture (an auto attention alert) and/or on a flaky
//      network voice (Google UK English, etc.) can jam the engine into speaking:true forever with no
//      audio and no end/error event. Every later speak() then queues behind the jam and is never
//      heard — the Test button goes silent too. `cancel()` before each speak flushes the jam.
//   2) The ~15s cutoff — Chrome silently pauses any utterance after roughly 15 seconds. A periodic
//      resume() while speaking keeps long messages going AND nudges a stalled engine back to life,
//      which is the same cancel/resume kick that clears a wedge in flight.
let resumeTimer: ReturnType<typeof setInterval> | null = null;

function stopKeepAlive(): void {
  if (resumeTimer) {
    clearInterval(resumeTimer);
    resumeTimer = null;
  }
}

/** Speak `text` with the named system voice, or the browser default when the name is blank/unknown.
 *  `rate` is the speaking speed (1 = normal); clamped to the Web Speech API's valid 0.1–10 range.
 *  `volume` is the playback loudness (1 = full); clamped to the API's 0–1 range. Hardened against
 *  Chrome's speechSynthesis wedge (see the note above) so every voice stays reliable; back-to-back
 *  alerts now interrupt rather than queue, which is what you want for "needs attention" pings. */
export function speak(text: string, voiceName?: string, rate = 1, volume = 1): void {
  if (!speechSupported() || !text.trim()) return;
  const synth = window.speechSynthesis;
  synth.cancel(); // flush any wedged/stuck utterance so this one is never trapped behind it
  const u = new SpeechSynthesisUtterance(text);
  if (voiceName) {
    const v = synth.getVoices().find((vc) => vc.name === voiceName);
    if (v) u.voice = v;
  }
  u.rate = Math.min(10, Math.max(0.1, rate));
  u.volume = Math.min(1, Math.max(0, volume));
  u.onend = stopKeepAlive;
  u.onerror = stopKeepAlive;
  synth.speak(u);
  stopKeepAlive();
  resumeTimer = setInterval(() => {
    if (synth.speaking) synth.resume(); // defeat Chrome's ~15s auto-pause and nudge a stall loose
    else stopKeepAlive();
  }, 5000);
}

// One shared AudioContext for the attention chime — created lazily on first use (a fresh one per
// beep would leak). The browser may start it suspended until a user gesture; we resume best-effort.
let audioCtx: AudioContext | null = null;

/** A short two-note "ding-dong" chime via the Web Audio API — played before a spoken message so it
 *  grabs your attention first. Independent of speech synthesis; fails silently if audio is blocked. */
export function beep(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audioCtx ??= new Ctx();
    const ctx = audioCtx;
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    for (const { f, t } of [{ f: 880, t: 0 }, { f: 1318.5, t: 0.13 }]) { // A5 → E6
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, now + t);
      gain.gain.exponentialRampToValueAtTime(0.22, now + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + t);
      osc.stop(now + t + 0.13);
    }
  } catch { /* audio blocked (no gesture yet) or unsupported — stay silent */ }
}

/** A short blip when dictation toggles — rising when the mic goes live, falling when it stops — so
 *  you get an audible confirmation without watching the button. Reuses the lazy AudioContext above;
 *  fails silently if audio is blocked. */
export function dictationCue(on: boolean): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audioCtx ??= new Ctx();
    const ctx = audioCtx;
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(on ? 660 : 560, now);             // start: rises, stop: falls
    osc.frequency.exponentialRampToValueAtTime(on ? 990 : 415, now + 0.11);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.2, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.16);
  } catch { /* audio blocked (no gesture yet) or unsupported — stay silent */ }
}

/** Live list of system voices that stays correct across Chrome's async voice loading. */
export function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => listVoices());
  useEffect(() => {
    if (!speechSupported()) return;
    const update = () => setVoices(listVoices());
    update();
    window.speechSynthesis.addEventListener("voiceschanged", update);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", update);
  }, []);
  return voices;
}
