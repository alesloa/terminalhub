import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import type { Principal } from "../auth/access.js";

// Owner-only management of temp access links + the live teammate roster. A teammate arriving on a
// link gets FULL room access, but their principal is `{kind:"key"}` — so every route here is gated to
// the main owner. Mints/revokes links, admits/declines pending joins, kicks live sessions.
export async function accessKeyRoutes(app: FastifyInstance, ctx: AppContext) {
  app.addHook("preHandler", async (req, reply) => {
    const principal = (req as { principal?: Principal }).principal;
    if (principal?.kind !== "main") return reply.code(403).send({ error: "forbidden" });
  });

  // Roster for the manager: every link (secret included — owner-only) + the live sessions.
  app.get("/api/access-keys", async () => {
    return { keys: ctx.store.listAccessKeys(), sessions: ctx.sessions.list() };
  });

  // Mint a link. expiresAt is an absolute epoch-ms instant (computed in the browser); null = never.
  app.post("/api/access-keys", async (req, reply) => {
    const b = z.object({
      label: z.string().max(200).optional(),
      workspaceId: z.string().nullable().optional(),
      expiresAt: z.number().int().positive().nullable().optional(),
      mirror: z.boolean().optional(), // push the owner's UI nav to this viewer
      lock: z.boolean().optional(),   // viewer is a passive spectator (no mouse / no typing)
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    return { key: ctx.store.createAccessKey(b.data) };
  });

  // Revoke: the link dies forever AND every socket on it closes immediately.
  app.delete("/api/access-keys/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    ctx.store.revokeAccessKey(id);
    ctx.sessions.killKey(id);
    return { ok: true };
  });

  // Kick: disconnect that teammate now (the link stays valid — they can return and re-request).
  app.post("/api/access-keys/sessions/:sid/kick", async (req) => {
    const sid = (req.params as { sid: string }).sid;
    ctx.sessions.kick(sid);
    return { ok: true };
  });

  // Admit a pending join. Accept lets them in; Decline ends the join AND revokes the key on the spot.
  app.post("/api/access-keys/admit", async (req, reply) => {
    const b = z.object({
      sessionId: z.string(),
      decision: z.enum(["accept", "decline"]),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const { sessionId, decision } = b.data;
    if (decision === "accept") {
      ctx.sessions.admit(sessionId);
    } else {
      const sess = ctx.sessions.list().find((s) => s.sessionId === sessionId);
      ctx.sessions.decline(sessionId);
      if (sess) { ctx.store.revokeAccessKey(sess.keyId); ctx.sessions.killKey(sess.keyId); }
    }
    return { ok: true };
  });
}
