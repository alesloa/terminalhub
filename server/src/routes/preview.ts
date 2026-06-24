import type { FastifyInstance } from "fastify";
import httpProxy from "@fastify/http-proxy";
import type { Config } from "../config.js";
import { previewAuthorized, PREVIEW_COOKIE } from "../preview/auth.js";
import { isForwardedRequest } from "../auth/guard.js";
import { prefixPreviewHtml, prefixModuleSpecifiers, prefixAssetUrls } from "../preview/rewrite.js";

// Localhost preview proxy. ONE dynamic registration relays HTTP for any host-local port:
// /api/preview/<port>/<path> -> localhost:<port>/<path> (loopback, either IP family). The browser's
// localhost is not the host's when terminalhub is reached remotely, so this is the bridge.
//
// WebSocket is intentionally OFF. @fastify/http-proxy's `websocket:true` installs its own
// server-wide `upgrade` listener, which collides with the @fastify/websocket listener the terminal/
// lsp/notification gateways depend on (both call assignSocket on the same socket -> "already
// assigned socket", and http-proxy's listener fires for EVERY upgrade incl. /ws/terminal). Enabling
// it would regress the terminal durability. Cost: live HMR doesn't tunnel through the proxy — the
// app still loads and is fully interactive; manual refresh shows code changes. See preview.test.ts
// for the coexistence guard. Don't add `websocket:true` without a single shared upgrade dispatcher.
//
// Auth: the proxy paths do their OWN cookie-aware auth (the global /api/* preHandler skips
// /api/preview/ — an <iframe> can't send a Bearer header), while the cookie-minting endpoint below
// rides the normal global Bearer auth. `upstream: ""` makes getUpstream drive the dynamic target.
export async function previewRoutes(app: FastifyInstance, config: Config) {
  // Mint the preview cookie. NOT under /api/preview/, so the global preHandler Bearer-gates it; the
  // browser then sends this cookie on every iframe sub-resource and the HMR WS upgrade. No-ops on a
  // tokenless (loopback-only) instance — those requests are relaxed anyway.
  app.post("/api/preview-session", async (req, reply) => {
    if (!config.token) return reply.code(204).send();
    const https = req.headers["x-forwarded-proto"] === "https" || req.protocol === "https";
    reply.header(
      "set-cookie",
      // Path=/ (not /api/preview): a framed app's absolute-path assets are fetched from the ORIGIN
      // root (/assets/…), so the browser only attaches this cookie if it's scoped to /. The Referer
      // rewrite (see app.ts/preview/rewrite.ts) then re-prefixes them to the proxy, where this cookie
      // is what authorizes them on an exposed instance.
      `${PREVIEW_COOKIE}=${encodeURIComponent(config.token)}; Path=/; HttpOnly; SameSite=Lax${https ? "; Secure" : ""}`,
    );
    return { ok: true };
  });

  await app.register(httpProxy, {
    upstream: "", // empty => getUpstream drives the dynamic target
    prefix: "/api/preview/:port",
    rewritePrefix: "/", // /api/preview/3000/x -> /x upstream
    // Proxy via Node's core http agent (not undici 5.x, which has no Happy-Eyeballs) with
    // autoSelectFamily on, so connecting to the `localhost` upstream below reaches a dev server bound
    // to EITHER ::1 (Vite's default) or 127.0.0.1. Hardcoding 127.0.0.1 missed ::1-only servers
    // (ECONNREFUSED); hardcoding ::1 would miss IPv4-only ones.
    http: { agentOptions: { autoSelectFamily: true } },
    preHandler: async (req, reply) => {
      const port = Number((req.params as any).port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return reply.code(400).send({ error: "invalid preview port" });
      }
      const url = new URL(req.url, "http://localhost");
      const ok = previewAuthorized({
        remoteAddr: req.ip,
        authorization: req.headers["authorization"],
        cookie: req.headers["cookie"],
        queryToken: url.searchParams.get("token") ?? undefined,
        forwarded: isForwardedRequest(req.headers as Record<string, string | string[] | undefined>),
        token: config.token,
      });
      if (!ok) return reply.code(401).send({ error: "unauthorized" });
    },
    replyOptions: {
      // SSRF chokepoint: a path segment can never become an arbitrary outbound target — always
      // loopback, always a validated port (the preHandler already rejected bad ports).
      getUpstream(req) {
        const port = Number((req.params as any).port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("bad preview port");
        // `localhost` (a loopback name, still SSRF-safe) + autoSelectFamily above lets the connect
        // fall over to whichever of ::1 / 127.0.0.1 the dev server actually bound to.
        return `http://localhost:${port}`;
      },
      // Strip headers that would make a browser refuse to render the response inside our iframe.
      rewriteHeaders(headers) {
        delete headers["x-frame-options"];
        // Drop the upstream's body-framing headers and let Fastify set the right one for what WE send
        // (Content-Length for the buffered/rewritten HTML string; chunked for a streamed body). A dev
        // server that streams chunked HTML would otherwise leave Transfer-Encoding alongside the
        // Content-Length we add — illegal framing that a strict client (Node, Vite's proxy) rejects
        // with "Content-Length can't be present with Transfer-Encoding".
        delete headers["transfer-encoding"];
        delete headers["content-length"];
        const csp = headers["content-security-policy"];
        if (typeof csp === "string") {
          const stripped = csp.split(";").filter((d) => !/^\s*frame-ancestors/i.test(d)).join(";").trim();
          if (stripped) headers["content-security-policy"] = stripped;
          else delete headers["content-security-policy"];
        }
        delete headers["content-security-policy-report-only"];
        return headers;
      },
      // Force an uncompressed upstream response so the HTML below can be rewritten reliably (and
      // JS/CSS just stream through). The localhost→server hop is local; the edge re-compresses to the
      // browser, so this costs nothing real.
      rewriteRequestHeaders(_req, headers) {
        delete headers["accept-encoding"];
        // Force a full 200 (never a 304): the body must reach onResponse to be URL-rewritten. With a
        // conditional request the upstream returns 304 + no body, so the browser keeps its cached —
        // possibly pre-rewrite — copy and the module graph silently breaks.
        delete headers["if-none-match"];
        delete headers["if-modified-since"];
        return headers;
      },
      // Make the previewed app's module graph load UNDER /api/preview/<port>/ so it doesn't collide
      // with terminalhub's own dev server. HTML: prefix entry URLs + <base>. JS: prefix the absolute
      // module specifiers Vite emits, so each module's children stay prefixed too (deterministic — no
      // reliance on an import map, which extensions can break). Everything else streams through.
      onResponse(request: any, reply: any, res: any) {
        const ct = String(reply.getHeader("content-type") ?? "").toLowerCase();
        const isHtml = ct.includes("text/html");
        const isJs = ct.includes("javascript");
        if (!isHtml && !isJs) { reply.send(res); return; }
        const prefix = `/api/preview/${Number((request.params as any).port)}`;
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
        res.on("end", () => {
          if (reply.sent) return;
          const body = Buffer.concat(chunks).toString("utf8");
          const out = isHtml ? prefixPreviewHtml(body, prefix) : prefixAssetUrls(prefixModuleSpecifiers(body, prefix), prefix);
          reply.removeHeader("content-length"); // body length changed — let Fastify recompute it
          reply.send(out);
        });
        res.on("error", () => { if (!reply.sent) reply.send(""); });
      },
    },
  });
}
