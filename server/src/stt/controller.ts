import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export type SttProvider = "local" | "openai";

export interface SttStatus {
  local: { running: boolean; ffmpeg: boolean };
  openai: { configured: boolean };
}

export interface TranscribeInput {
  provider: SttProvider;
  model?: string;        // OpenAI model override; falls back to the stored default
  audio: Buffer;
  mimeType: string;      // e.g. "audio/webm;codecs=opus"
}

export interface TranscribeResult { text: string; providerUsed: SttProvider }

export interface SttController {
  status(): Promise<SttStatus>;
  transcribe(input: TranscribeInput): Promise<TranscribeResult>;
}

/** Only the slice of settings STT needs — keeps the controller decoupled + easy to fake in tests. */
interface SttSettings { openaiApiKey: string | null; openaiSttModel: string }

export interface SttDeps {
  store: { getSettings(): SttSettings };
  fetchFn?: typeof fetch;
  execFileFn?: (file: string, args: string[]) => Promise<{ stdout: unknown; stderr: unknown }>;
  fs?: { writeFile(path: string, data: Buffer): Promise<void>; readFile(path: string): Promise<Buffer>; unlink(path: string): Promise<void> };
  whisperUrl?: string;   // local whisper.cpp HTTP server, default 127.0.0.1:8080
  ffmpegPath?: string;   // ffmpeg binary, default "ffmpeg" (resolved via PATH)
  tmpDir?: string;
}

const OPENAI_URL = "https://api.openai.com/v1/audio/transcriptions";
const DEFAULT_OPENAI_MODEL = "gpt-4o-transcribe";

/** Filename extension from a MIME type ("audio/webm;codecs=opus" -> "webm"). OpenAI sniffs format from it. */
function extFor(mimeType: string): string {
  const sub = (mimeType.split("/")[1] ?? "").split(";")[0].trim();
  return sub || "webm";
}

/** whisper.cpp returns text with a leading space and embedded newlines; normalize to one clean line. */
function cleanText(raw: unknown): string {
  return String(raw ?? "").replace(/\r?\n/g, " ").trim();
}

export function createSttController(deps: SttDeps): SttController {
  const fetchFn = deps.fetchFn ?? fetch;
  const execFileFn = deps.execFileFn ?? (promisify(execFile) as SttDeps["execFileFn"])!;
  const fsImpl = deps.fs ?? { writeFile, readFile, unlink };
  const whisperUrl = (deps.whisperUrl ?? process.env.WHISPER_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
  const ffmpegPath = deps.ffmpegPath ?? process.env.FFMPEG_PATH ?? "ffmpeg";
  const tmpDir = deps.tmpDir ?? tmpdir();

  async function probeRunning(): Promise<boolean> {
    try {
      await fetchFn(`${whisperUrl}/`, { signal: AbortSignal.timeout(500) } as RequestInit);
      return true;
    } catch {
      return false;
    }
  }

  async function probeFfmpeg(): Promise<boolean> {
    try { await execFileFn(ffmpegPath, ["-version"]); return true; } catch { return false; }
  }

  async function transcribeOpenai(audio: Buffer, mimeType: string, model: string, key: string): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: mimeType }), `audio.${extFor(mimeType)}`);
    form.append("model", model);
    form.append("response_format", "json");
    const res = await fetchFn(OPENAI_URL, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form });
    if (!res.ok) throw new Error(`OpenAI transcription failed: ${res.status}`);
    return cleanText((await res.json() as { text?: string }).text);
  }

  async function transcribeLocal(audio: Buffer, mimeType: string): Promise<string> {
    const base = join(tmpDir, `stt_${randomUUID()}`);
    const inPath = `${base}.${extFor(mimeType)}`;
    const outPath = `${base}.wav`;
    try {
      await fsImpl.writeFile(inPath, audio);
      // whisper.cpp only accepts 16 kHz / mono / 16-bit PCM WAV — normalize before sending.
      await execFileFn(ffmpegPath, ["-y", "-i", inPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", outPath]);
      const wav = await fsImpl.readFile(outPath);
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "audio.wav");
      form.append("response_format", "json");
      form.append("language", "auto");
      const res = await fetchFn(`${whisperUrl}/inference`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`Local Whisper transcription failed: ${res.status}`);
      return cleanText((await res.json() as { text?: string }).text);
    } finally {
      await fsImpl.unlink(inPath).catch(() => {});
      await fsImpl.unlink(outPath).catch(() => {});
    }
  }

  return {
    async status() {
      const settings = deps.store.getSettings();
      const [running, ffmpeg] = await Promise.all([probeRunning(), probeFfmpeg()]);
      return { local: { running, ffmpeg }, openai: { configured: Boolean(settings.openaiApiKey) } };
    },

    async transcribe({ provider, model, audio, mimeType }) {
      const settings = deps.store.getSettings();
      const key = settings.openaiApiKey;
      let useProvider: SttProvider = provider;

      // Picked local but it isn't up → fall back to OpenAI when a key exists.
      if (provider === "local" && !(await probeRunning())) {
        if (!key) throw new Error("Local Whisper isn't running and no OpenAI API key is set.");
        useProvider = "openai";
      }

      if (useProvider === "openai") {
        if (!key) throw new Error("OpenAI API key not set.");
        return { text: await transcribeOpenai(audio, mimeType, model ?? settings.openaiSttModel ?? DEFAULT_OPENAI_MODEL, key), providerUsed: "openai" };
      }
      return { text: await transcribeLocal(audio, mimeType), providerUsed: "local" };
    },
  };
}
