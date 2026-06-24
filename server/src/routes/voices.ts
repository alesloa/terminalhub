import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";

// The curated voice roster. Browsers enumerate the OS's speech-synthesis voices client-side, the
// user trims that list in Settings, and the kept set is mirrored here so two things can read it:
// the dashboard's voice picker, and — via GET — any coding agent that wants to pick a voice to
// "be" (so you can tell which agent is talking). Empty = the user hasn't curated; agents then just
// omit a voice and the browser default is used.
export async function voicesRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/voices", async () => {
    return { voices: ctx.store.getKeptVoices() };
  });

  app.put("/api/voices", async (req, reply) => {
    const b = z.object({
      voices: z.array(z.object({
        name: z.string().min(1).max(120),
        lang: z.string().max(40),
      })).max(500),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    ctx.store.setKeptVoices(b.data.voices);
    return { ok: true };
  });
}
