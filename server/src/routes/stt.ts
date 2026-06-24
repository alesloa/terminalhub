import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";

const MB = 1024 * 1024;

export async function sttRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/stt/status", async () => ctx.stt.status());

  // Audio arrives base64-encoded in a JSON body (keeps the all-JSON route style; no multipart
  // dependency). 40 MB leaves room for OpenAI's 25 MB audio cap plus base64's ~33% inflation.
  app.post("/api/stt/transcribe", { bodyLimit: 40 * MB }, async (req, reply) => {
    const b = z.object({
      provider: z.enum(["local", "openai"]),
      model: z.string().optional(),
      audioBase64: z.string().min(1),
      mimeType: z.string().default("audio/webm"),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid body" });

    try {
      const audio = Buffer.from(b.data.audioBase64, "base64");
      return await ctx.stt.transcribe({ provider: b.data.provider, model: b.data.model, audio, mimeType: b.data.mimeType });
    } catch (e) {
      return reply.code(502).send({ error: e instanceof Error ? e.message : "transcription failed" });
    }
  });
}
