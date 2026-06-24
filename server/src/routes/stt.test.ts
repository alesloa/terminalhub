import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { sttRoutes } from "./stt.js";

function build(stt: any) {
  const app = Fastify();
  app.register(async (a) => sttRoutes(a, { stt } as any));
  return app;
}

describe("stt routes", () => {
  it("GET /api/stt/status returns the controller status verbatim", async () => {
    const app = build({ status: async () => ({ local: { running: true, ffmpeg: true }, openai: { configured: false } }) });
    const res = await app.inject({ method: "GET", url: "/api/stt/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ local: { running: true, ffmpeg: true }, openai: { configured: false } });
  });

  it("POST /api/stt/transcribe decodes base64 audio into a Buffer and returns the transcript", async () => {
    let received: any;
    const app = build({ transcribe: async (input: any) => { received = input; return { text: "hello", providerUsed: "openai" }; } });
    const audioBase64 = Buffer.from("rawaudio").toString("base64");
    const res = await app.inject({ method: "POST", url: "/api/stt/transcribe", payload: { provider: "openai", model: "whisper-1", audioBase64, mimeType: "audio/webm" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ text: "hello", providerUsed: "openai" });
    expect(received.provider).toBe("openai");
    expect(received.model).toBe("whisper-1");
    expect(received.mimeType).toBe("audio/webm");
    expect(Buffer.isBuffer(received.audio)).toBe(true);
    expect(received.audio.toString()).toBe("rawaudio");
  });

  it("400s when audioBase64 is missing", async () => {
    const app = build({ transcribe: async () => ({ text: "", providerUsed: "openai" }) });
    const res = await app.inject({ method: "POST", url: "/api/stt/transcribe", payload: { provider: "openai" } });
    expect(res.statusCode).toBe(400);
  });

  it("surfaces a transcription failure as a non-2xx with the error message", async () => {
    const app = build({ transcribe: async () => { throw new Error("OpenAI API key not set."); } });
    const audioBase64 = Buffer.from("x").toString("base64");
    const res = await app.inject({ method: "POST", url: "/api/stt/transcribe", payload: { provider: "openai", audioBase64, mimeType: "audio/webm" } });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatch(/key/i);
  });
});
