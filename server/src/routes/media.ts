import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { Config } from "../config.js";
import { isForwardedRequest } from "../auth/guard.js";
import { previewAuthorized } from "../preview/auth.js";
import { mediaTypeFor, parseRange } from "../fs/media.js";

/**
 * Stream a media file (video) straight off disk with HTTP byte-range support — what 4K/large files
 * need, since the base64-in-JSON file-bytes route holds the whole file in memory and caps at 25 MiB.
 * The browser's <video> element drives this: it issues `Range` requests for the bytes it's playing,
 * we answer 206 with just that slice, and seeking Just Works.
 *
 * Auth: a <video src> can't send an Authorization header (same constraint as the preview <iframe> and
 * the terminal WebSocket), so this route does its OWN cookie/query/bearer-aware check via
 * previewAuthorized — and app.ts lets `/api/media/` skip the global Bearer-only preHandler so that
 * cookie path isn't pre-empted. Loopback stays relaxed; exposed needs the token (preview cookie set by
 * POST /api/preview-session, or ?token=). File access matches the sibling /api/fs/* routes (resolve +
 * read whatever the server process can reach) — this adds a streaming reader, not new reach.
 */
export async function mediaRoutes(app: FastifyInstance, config: Config) {
  app.route<{ Querystring: { path?: string; token?: string } }>({
    method: ["GET", "HEAD"],
    url: "/api/media/file",
    handler: async (req, reply) => {
      const authed = previewAuthorized({
        remoteAddr: req.ip,
        authorization: req.headers["authorization"],
        cookie: req.headers["cookie"],
        queryToken: req.query.token,
        forwarded: isForwardedRequest(req.headers as Record<string, string | string[] | undefined>),
        token: config.token,
      });
      if (!authed) return reply.code(401).send({ error: "unauthorized" });

      const p = req.query.path;
      if (!p) return reply.code(400).send({ error: "path required" });
      const abs = resolve(p);

      let size: number;
      try {
        const st = await stat(abs);
        if (st.isDirectory()) return reply.code(400).send({ error: "not a file" });
        size = st.size;
      } catch {
        return reply.code(404).send({ error: "not found" });
      }

      reply.header("Accept-Ranges", "bytes");
      reply.header("Content-Type", mediaTypeFor(abs));
      reply.header("Cache-Control", "private, max-age=0");

      const range = parseRange(req.headers["range"], size);
      if (range === "unsatisfiable") {
        reply.header("Content-Range", `bytes */${size}`);
        return reply.code(416).send();
      }

      // HEAD: advertise size + range support without a body (some players probe with it first).
      if (req.method === "HEAD") {
        reply.header("Content-Length", String(size));
        return reply.code(200).send();
      }

      if (range) {
        const { start, end } = range;
        reply.code(206);
        reply.header("Content-Range", `bytes ${start}-${end}/${size}`);
        reply.header("Content-Length", String(end - start + 1));
        const stream = createReadStream(abs, { start, end });
        // A seek aborts the previous response → the read stream errors; swallow it so it never
        // bubbles as an unhandled error (the connection is already gone).
        stream.on("error", () => { if (!reply.sent) reply.code(500).send(); });
        return reply.send(stream);
      }

      reply.code(200);
      reply.header("Content-Length", String(size));
      const stream = createReadStream(abs);
      stream.on("error", () => { if (!reply.sent) reply.code(500).send(); });
      return reply.send(stream);
    },
  });
}
