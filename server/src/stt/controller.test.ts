import { describe, it, expect, vi } from "vitest";
import { createSttController } from "./controller.js";

function fakeStore(over: Partial<{ openaiApiKey: string | null; openaiSttModel: string }> = {}) {
  return { getSettings: () => ({ openaiApiKey: null, openaiSttModel: "gpt-4o-transcribe", ...over }) } as any;
}
function okJson(body: any) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe("stt controller — status", () => {
  it("reports local.running true when the whisper probe resolves", async () => {
    const fetchFn = vi.fn(async () => okJson({}));
    const execFileFn = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const stt = createSttController({ store: fakeStore(), fetchFn: fetchFn as any, execFileFn, whisperUrl: "http://w:8080" });
    const s = await stt.status();
    expect(s.local.running).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith("http://w:8080/", expect.anything());
  });

  it("reports local.running false when the whisper probe throws (server down)", async () => {
    const fetchFn = vi.fn(async (url: any) => { if (String(url).endsWith("/")) throw new Error("ECONNREFUSED"); return okJson({}); });
    const stt = createSttController({ store: fakeStore(), fetchFn: fetchFn as any, whisperUrl: "http://w:8080" });
    expect((await stt.status()).local.running).toBe(false);
  });

  it("reports ffmpeg presence from execFile success/failure", async () => {
    const up = createSttController({ store: fakeStore(), fetchFn: (vi.fn(async () => okJson({})) as any), execFileFn: vi.fn(async () => ({ stdout: "", stderr: "" })) });
    expect((await up.status()).local.ffmpeg).toBe(true);
    const down = createSttController({ store: fakeStore(), fetchFn: (vi.fn(async () => okJson({})) as any), execFileFn: vi.fn(async () => { throw new Error("ENOENT"); }) });
    expect((await down.status()).local.ffmpeg).toBe(false);
  });

  it("reports openai.configured from the stored key", async () => {
    const yes = createSttController({ store: fakeStore({ openaiApiKey: "sk-x" }), fetchFn: (vi.fn(async () => okJson({})) as any) });
    expect((await yes.status()).openai.configured).toBe(true);
    const no = createSttController({ store: fakeStore({ openaiApiKey: null }), fetchFn: (vi.fn(async () => okJson({})) as any) });
    expect((await no.status()).openai.configured).toBe(false);
  });
});

describe("stt controller — transcribe via OpenAI", () => {
  it("POSTs audio to OpenAI with the bearer key + selected model and returns trimmed text", async () => {
    const fetchFn = vi.fn(async () => okJson({ text: "  hello world " }));
    const stt = createSttController({ store: fakeStore({ openaiApiKey: "sk-key", openaiSttModel: "gpt-4o-transcribe" }), fetchFn: fetchFn as any });
    const r = await stt.transcribe({ provider: "openai", audio: Buffer.from("abc"), mimeType: "audio/webm" });
    expect(r).toEqual({ text: "hello world", providerUsed: "openai" });
    const [url, init] = fetchFn.mock.calls[0] as any;
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer sk-key");
    expect((init.body as FormData).get("model")).toBe("gpt-4o-transcribe");
  });

  it("honors an explicit per-request model override", async () => {
    const fetchFn = vi.fn(async () => okJson({ text: "x" }));
    const stt = createSttController({ store: fakeStore({ openaiApiKey: "sk" }), fetchFn: fetchFn as any });
    await stt.transcribe({ provider: "openai", model: "whisper-1", audio: Buffer.from("a"), mimeType: "audio/webm" });
    expect(((fetchFn.mock.calls[0] as any)[1].body as FormData).get("model")).toBe("whisper-1");
  });

  it("throws when OpenAI is selected but no key is set", async () => {
    const stt = createSttController({ store: fakeStore({ openaiApiKey: null }), fetchFn: vi.fn() as any });
    await expect(stt.transcribe({ provider: "openai", audio: Buffer.from("a"), mimeType: "audio/webm" })).rejects.toThrow(/key/i);
  });

  it("throws a clear error when OpenAI responds non-ok", async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) } as unknown as Response));
    const stt = createSttController({ store: fakeStore({ openaiApiKey: "sk" }), fetchFn: fetchFn as any });
    await expect(stt.transcribe({ provider: "openai", audio: Buffer.from("a"), mimeType: "audio/webm" })).rejects.toThrow(/401|openai/i);
  });
});

describe("stt controller — transcribe via local whisper.cpp", () => {
  function localDeps(over: any = {}) {
    const fetchFn = vi.fn(async (url: any) => {
      if (String(url).endsWith("/inference")) return okJson({ text: " transcribed text\n" });
      return okJson({}); // the running probe at "/"
    });
    const execFileFn = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const fs = { writeFile: vi.fn(async () => {}), readFile: vi.fn(async () => Buffer.from("WAVDATA")), unlink: vi.fn(async () => {}) };
    return { store: fakeStore(), fetchFn, execFileFn, fs, whisperUrl: "http://w:8080", ffmpegPath: "ffmpeg", tmpDir: "/tmp", ...over };
  }

  it("normalizes with ffmpeg (16k/mono/s16le), POSTs the wav to /inference, returns cleaned text", async () => {
    const d = localDeps();
    const stt = createSttController(d as any);
    const r = await stt.transcribe({ provider: "local", audio: Buffer.from("webmbytes"), mimeType: "audio/webm" });
    expect(r.providerUsed).toBe("local");
    expect(r.text).toBe("transcribed text"); // leading space stripped, newline -> nothing/trimmed
    const [bin, args] = d.execFileFn.mock.calls[0] as any;
    expect(bin).toBe("ffmpeg");
    expect(args).toEqual(expect.arrayContaining(["-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"]));
    const infCall = (d.fetchFn.mock.calls as any[]).find((c) => String(c[0]).endsWith("/inference"));
    expect(infCall).toBeTruthy();
    expect(infCall[1].method).toBe("POST");
    expect(d.fs.writeFile).toHaveBeenCalled();
    expect(d.fs.unlink).toHaveBeenCalled(); // temp files cleaned up
  });

  it("falls back to OpenAI when local is selected but whisper.cpp isn't running", async () => {
    const fetchFn = vi.fn(async (url: any) => {
      if (String(url).endsWith("/")) throw new Error("ECONNREFUSED"); // probe: not running
      if (String(url).includes("openai.com")) return okJson({ text: "via openai" });
      throw new Error("unexpected " + url);
    });
    const stt = createSttController({ store: fakeStore({ openaiApiKey: "sk" }), fetchFn: fetchFn as any, ffmpegPath: "ffmpeg" });
    const r = await stt.transcribe({ provider: "local", audio: Buffer.from("a"), mimeType: "audio/webm" });
    expect(r).toEqual({ text: "via openai", providerUsed: "openai" });
  });

  it("throws when local isn't running and there's no OpenAI key to fall back to", async () => {
    const fetchFn = vi.fn(async (url: any) => { if (String(url).endsWith("/")) throw new Error("down"); return okJson({}); });
    const stt = createSttController({ store: fakeStore({ openaiApiKey: null }), fetchFn: fetchFn as any });
    await expect(stt.transcribe({ provider: "local", audio: Buffer.from("a"), mimeType: "audio/webm" })).rejects.toThrow();
  });
});
