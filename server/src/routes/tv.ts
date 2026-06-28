import type { FastifyInstance } from "fastify";
import { Readable } from "node:stream";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { fetchCatalog } from "../tv/sources.js";
import { isProxyableUrl } from "../tv/proxy.js";
import { rewriteManifest, bodyIsManifest } from "../tv/manifest.js";
import { searchRadio, radioFacets } from "../tv/radio.js";
import { searchYouTube } from "../tv/youtube.js";

// TV / Media tool. The catalog (iptv-org) is fetched + cached by sources.ts; the proxy fetches an
// upstream stream/manifest with the right Referer/User-Agent and re-serves it with CORS (and rewrites
// .m3u8 children back through itself). Radio + YouTube are thin pass-throughs over their public APIs.
// The YouTube key is the user's own and is NEVER returned to the browser (only `hasYoutubeKey`).
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

export async function tvRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/tv/catalog", async (req) => {
    const refresh = (req.query as any).refresh === "1" || (req.query as any).refresh === 1;
    return fetchCatalog(ctx.store, { refresh });
  });

  app.get("/api/tv/proxy", async (req, reply) => {
    // Fastify has already percent-decoded the query, so `url`/`ref`/`ua` arrive in their original
    // form (proxyUrl encodes them once) — no second decodeURIComponent (it would double-decode).
    const q = req.query as { url?: string; ref?: string; ua?: string };
    const url = q.url ?? "";
    if (!isProxyableUrl(url)) return reply.code(400).send({ error: "bad url" });
    const ref = q.ref || undefined;
    const ua = q.ua || DEFAULT_UA;

    // Bound CONNECTION SETUP only (until the response headers arrive), then clear the timer. A blanket
    // AbortSignal.timeout would also abort the BODY — and a radio stream is one endless HTTP body, so a
    // total timeout cuts it off mid-play (~15s). HLS segments are individually finite, so their bodies
    // are unaffected; a stalled segment is the client's (hls.js fragment timeout) job, not ours.
    const ac = new AbortController();
    const connectTimer = setTimeout(() => ac.abort(), 15000);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "user-agent": ua, ...(ref ? { referer: ref } : {}) },
        redirect: "follow",
        signal: ac.signal,
      });
    } catch {
      return reply.code(502).send({ error: "upstream failed" });
    } finally {
      clearTimeout(connectTimer);
    }

    reply.header("access-control-allow-origin", "*");

    // Surface a real upstream error (geo-block / 403 / 5xx) as that status so the player fires a clean
    // error and auto-advances — instead of buffering a dead body or rewriting an error page as media.
    if (res.status >= 400) return reply.code(res.status).send({ error: `upstream ${res.status}` });

    const ct = res.headers.get("content-type") || "";
    const candidateManifest = /mpegurl|m3u8/i.test(ct) || new URL(url).pathname.toLowerCase().endsWith(".m3u8");
    if (candidateManifest) {
      const text = await res.text();
      // A .m3u8 URL can return 200 + an HTML error page (geo-block). Rewriting that as a manifest hangs
      // hls.js forever with no fatal error — so reject non-manifest bodies and let the player advance.
      if (!bodyIsManifest(text)) return reply.code(502).send({ error: "not a manifest" });
      return reply
        .header("content-type", "application/vnd.apple.mpegurl")
        .send(rewriteManifest(text, res.url || url, ref, ua));
    }

    // Everything else (segments, keys, continuous audio) streams straight through with its own
    // content-type — no full-body buffering, so an endless radio body flows without a memory blowup.
    reply.header("content-type", ct || "application/octet-stream");
    if (!res.body) return reply.send();
    return reply.send(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]));
  });

  app.get("/api/tv/radio/search", async (req) => {
    const q = req.query as { q?: string; tag?: string; country?: string; limit?: string };
    const limit = q.limit ? Number(q.limit) : undefined;
    const stations = await searchRadio({
      q: q.q,
      tag: q.tag,
      country: q.country,
      limit: Number.isFinite(limit as number) ? limit : undefined,
    });
    return { stations };
  });

  app.get("/api/tv/radio/facets", async () => radioFacets());

  app.get("/api/tv/youtube/search", async (req, reply) => {
    const key = ctx.store.getSetting("tv_youtube_api_key");
    if (!key) return reply.code(400).send({ error: "no_key" });
    const q = req.query as { q?: string; pageToken?: string };
    return searchYouTube(key, q.q ?? "", q.pageToken || undefined);
  });

  app.get("/api/tv/favorites", async () => ({ favorites: ctx.store.listTvFavorites() }));
  app.post("/api/tv/favorites", async (req, reply) => {
    const b = z.object({
      source: z.enum(["tv", "radio", "youtube"]),
      ref: z.string().min(1),
      name: z.string().min(1),
      logo: z.string().nullish(),
      meta: z.string().nullish(),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const favorite = ctx.store.addTvFavorite({
      source: b.data.source, ref: b.data.ref, name: b.data.name,
      logo: b.data.logo ?? null, meta: b.data.meta ?? null,
    });
    return { favorite };
  });
  app.delete("/api/tv/favorites/:id", async (req) => {
    ctx.store.removeTvFavorite((req.params as any).id as string);
    return { ok: true };
  });

  app.get("/api/tv/recents", async () => ({ recents: ctx.store.listTvRecents() }));
  app.post("/api/tv/recents", async (req, reply) => {
    const b = z.object({
      source: z.enum(["tv", "radio", "youtube"]),
      ref: z.string().min(1),
      name: z.string().min(1),
      logo: z.string().nullish(),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const recent = ctx.store.recordTvRecent({
      source: b.data.source, ref: b.data.ref, name: b.data.name, logo: b.data.logo ?? null,
    });
    return { recent };
  });

  app.get("/api/tv/settings", async () => ({
    hasYoutubeKey: !!ctx.store.getSetting("tv_youtube_api_key"), // never return the key itself
    nsfw: ctx.store.getSetting("tv_nsfw") === "1",
    volume: Number(ctx.store.getSetting("tv_volume") ?? "80"),
  }));
  app.put("/api/tv/settings", async (req, reply) => {
    const b = z.object({
      youtubeApiKey: z.string().optional(), // write-only; empty string clears it
      nsfw: z.boolean().optional(),
      volume: z.number().min(0).max(100).optional(),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    if (b.data.youtubeApiKey !== undefined) ctx.store.setSetting("tv_youtube_api_key", b.data.youtubeApiKey);
    if (b.data.nsfw !== undefined) ctx.store.setSetting("tv_nsfw", b.data.nsfw ? "1" : "0");
    if (b.data.volume !== undefined) ctx.store.setSetting("tv_volume", String(b.data.volume));
    return { ok: true };
  });
}
