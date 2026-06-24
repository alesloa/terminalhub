import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useToasts } from "../store/toasts";
import { useUi } from "../store/ui";
import { dictationCue } from "../lib/speech";
import { useMicRecorder } from "./useMicRecorder";

/** Base64-encode a Blob in chunks (avoids a call-stack overflow on large byte arrays). */
async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

export interface Dictation {
  recording: boolean;
  busy: boolean;
  micMode: "toggle" | "hold";
  onClick: () => void;
  onHoldStart: (e: ReactPointerEvent) => void;
  onHoldEnd: (e: ReactPointerEvent) => void;
  toggle: () => void;     // keyboard press-to-toggle: tap on, tap off
  holdStart: () => void;  // keyboard push-to-talk: combo pressed
  holdEnd: () => void;    // keyboard push-to-talk: combo released
}

/**
 * Mic capture + transcription, decoupled from any sink: records audio and feeds the transcribed
 * text to `onText`. Engine (local whisper.cpp vs OpenAI) and click-vs-hold behavior come from
 * Settings → Speech-to-Text. Shared by the room mic (types into the focused terminal) and the
 * Notes mic (inserts into the note at the cursor). `enabled` gates recording when there's no sink.
 */
export function useDictation(onText: (text: string) => void, enabled: boolean): Dictation {
  const push = useToasts((s) => s.push);
  const dictationSound = useUi((s) => s.dictationSound);
  const { recording, start, stop } = useMicRecorder();
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });

  const transcribe = useMutation({
    // Send the user's chosen provider; the server owns the local→OpenAI fallback (it re-probes
    // whisper live, which is fresher than this client's polled status).
    mutationFn: async (blob: Blob) => api.stt.transcribe({
      provider: settings?.sttProvider ?? "local",
      model: settings?.openaiSttModel,
      audioBase64: await blobToBase64(blob),
      mimeType: blob.type || "audio/webm",
    }),
    onSuccess: (res) => {
      const text = res.text.trim();
      if (!text) { push("No speech detected."); return; }
      onText(text);
    },
    onError: (e: Error) => push(`Transcription failed: ${e.message}`),
  });

  const busy = transcribe.isPending;

  // "toggle" = click to start, click again to stop. "hold" = push-to-talk: record while the
  // button is held, transcribe on release. Refs (not the recorder's `recording` state) drive the
  // control logic so the hold handlers stay correct across the async getUserMedia gap.
  const micMode = settings?.micMode ?? "toggle";
  const heldRef = useRef(false);     // hold mode: pointer is currently down
  const kbHeldRef = useRef(false);   // push-to-talk: the shortcut combo is currently held
  const liveRef = useRef(false);     // a recorder is started and capturing
  const startingRef = useRef(false); // start() is in flight (mic permission / getUserMedia)

  const finishRec = async () => {
    if (!liveRef.current) return;
    liveRef.current = false;
    if (dictationSound) dictationCue(false);
    try { transcribe.mutate(await stop()); }
    catch (e) { push(e instanceof Error ? e.message : "Recording failed."); }
  };

  // `stillHeld` is the push-to-talk safety: if the mic was let go before getUserMedia finished
  // opening, stop right away so we don't get stuck recording. Toggle paths pass nothing, so the
  // recorder stays open until the next stop.
  const startRec = async (stillHeld?: () => boolean) => {
    if (busy || !enabled || liveRef.current || startingRef.current) return;
    startingRef.current = true;
    try {
      await start();
      liveRef.current = true;
      if (dictationSound) dictationCue(true);
      if (stillHeld && !stillHeld()) finishRec(); // released before the mic opened — stop now
    } catch (e) {
      push(e instanceof Error ? e.message : "Couldn't access the microphone.");
    } finally {
      startingRef.current = false;
    }
  };

  // Toggle mode: a plain click flips recording on/off.
  const onClick = () => {
    if (micMode !== "toggle" || busy) return;
    if (liveRef.current) finishRec(); else startRec();
  };

  // Hold mode: record only while the button is pressed. Capture the pointer so releasing the
  // mouse anywhere (off the button) still stops; pointercancel covers an interrupted gesture.
  const onHoldStart = (e: ReactPointerEvent) => {
    if (micMode !== "hold" || busy || !enabled) return;
    e.preventDefault();
    heldRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    startRec(() => heldRef.current);
  };
  const onHoldEnd = (e: ReactPointerEvent) => {
    if (micMode !== "hold" || !heldRef.current) return;
    heldRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    finishRec();
  };

  // Keyboard shortcut — press-to-toggle: tap to start, tap again to stop, whatever the button's
  // own click/hold setting is. Keeps the mic open until the next tap.
  const toggle = () => {
    if (busy || !enabled) return;
    if (liveRef.current) finishRec(); else startRec();
  };

  // Keyboard shortcut — push-to-talk: record while the combo is held, stop on release. Mirrors the
  // pointer hold path but keyed off the combo instead of the pointer.
  const holdStart = () => {
    if (busy || !enabled || liveRef.current) return;
    kbHeldRef.current = true;
    startRec(() => kbHeldRef.current);
  };
  const holdEnd = () => {
    if (!kbHeldRef.current) return;
    kbHeldRef.current = false;
    finishRec();
  };

  return { recording, busy, micMode, onClick, onHoldStart, onHoldEnd, toggle, holdStart, holdEnd };
}
