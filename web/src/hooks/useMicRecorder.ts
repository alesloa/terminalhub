import { useCallback, useRef, useState } from "react";

export interface MicRecorder {
  recording: boolean;
  /** Begin capturing from the microphone. Rejects if permission is denied or unsupported. */
  start: () => Promise<void>;
  /** Stop capturing and resolve the recorded audio as a Blob (webm/opus on Chrome). */
  stop: () => Promise<Blob>;
}

/**
 * Press-to-start / press-to-stop microphone capture via MediaRecorder. getUserMedia requires a
 * secure context (https or localhost) — over plain http on a LAN IP the browser blocks it, which
 * surfaces here as a rejected start().
 */
export function useMicRecorder(): MicRecorder {
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      throw new Error("Microphone recording isn't supported in this browser.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    chunksRef.current = [];
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorderRef.current = rec;
    rec.start();
    setRecording(true);
  }, []);

  const stop = useCallback(() => {
    return new Promise<Blob>((resolve, reject) => {
      const rec = recorderRef.current;
      if (!rec) { reject(new Error("Not recording")); return; }
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        streamRef.current?.getTracks().forEach((t) => t.stop()); // release the mic
        streamRef.current = null;
        recorderRef.current = null;
        setRecording(false);
        resolve(blob);
      };
      rec.stop();
    });
  }, []);

  return { recording, start, stop };
}
