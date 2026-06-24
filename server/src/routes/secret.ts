import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { encryptSymmetric } from "../secret/gpg.js";
import { onetimeConfig, onetimeCreate, onetimeBurn } from "../secret/onetime.js";

interface SecretConfig {
  onetimeBase: string | null;
}

/**
 * Server-side proxy for the "burnable secret link" feature. The browser sends plaintext plus a
 * randomly-generated key; the server symmetric-encrypts it with the host's gpg (spawned,
 * arms-length — so no crypto library ships in the web bundle) and forwards ONLY the ciphertext to
 * the configured onetime/Yopass instance. The onetime host is set via ONETIME_BASE; when unset the
 * feature is simply disabled — no instance is baked in.
 */
export async function secretRoutes(app: FastifyInstance, config: SecretConfig) {
  const base = config.onetimeBase;

  app.get("/api/secret/config", async () => {
    if (!base) return { enabled: false };
    try {
      const c = await onetimeConfig(base);
      const publicUrl = typeof c.PUBLIC_URL === "string" && c.PUBLIC_URL ? c.PUBLIC_URL.replace(/\/$/, "") : base;
      return { enabled: true, base: publicUrl, config: c };
    } catch {
      // instance configured but unreachable — let the UI fall back to presets-only
      return { enabled: true, base, config: {} };
    }
  });

  app.post("/api/secret", async (req, reply) => {
    if (!base) return reply.code(503).send({ error: "Secret links are not configured (set ONETIME_BASE)." });
    const parsed = z
      .object({
        message: z.string().min(1).max(100_000),
        key: z.string().min(1).max(512),
        expiration: z.number().int().positive(),
        one_time: z.boolean(),
        views: z.number().int().positive().optional(),
        creator_burn_only: z.boolean(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });
    const d = parsed.data;

    let ciphertext: string;
    try {
      ciphertext = await encryptSymmetric(d.message, d.key);
    } catch (e) {
      return reply.code(500).send({ error: `encryption failed (is gpg installed?): ${(e as Error).message}` });
    }
    try {
      const { id, burnToken } = await onetimeCreate(base, {
        message: ciphertext,
        expiration: d.expiration,
        one_time: d.one_time,
        views: d.views,
        creator_burn_only: d.creator_burn_only,
      });
      return { id, burnToken };
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  app.delete("/api/secret/:id", async (req, reply) => {
    if (!base) return reply.code(503).send({ error: "Secret links are not configured." });
    const id = (req.params as { id: string }).id;
    const burnToken = (req.headers["x-yopass-burn-token"] as string | undefined) || undefined;
    const ok = await onetimeBurn(base, id, burnToken);
    return reply.code(ok ? 204 : 502).send();
  });
}
