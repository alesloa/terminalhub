import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, get as httpGet, type Server } from "node:http";
import { WebSocket } from "ws";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { buildApp } from "../app.js";
import { createStore } from "../db/store.js";
import { createTmuxController } from "../tmux/controller.js";
import { createSessionsController } from "../presence/sessions.js";
import { previewRoutes } from "./preview.js";
import type { Config } from "../config.js";

const config: Config = { port: 0, host: "127.0.0.1", token: "secret", dbPath: ":memory:", fsRoots: null, reveal: null };

function build() {
  const ctx: any = { store: createStore(":memory:"), tmux: createTmuxController(async () => ""), sessions: createSessionsController() };
  return buildApp(config, ctx);
}

const EXPOSED = { "x-forwarded-for": "203.0.113.7" };

// A throwaway upstream "dev server" on a loopback port — it echoes its path and sends the framing
// headers a real dev server might (which the proxy must strip so the iframe can render it).
let upstream: Server;
let upstreamPort: number;
// A second upstream bound to ::1 ONLY — the IPv6 loopback that Vite (and friends) land on when they
// listen on the `localhost` name. The proxy must reach it too, or such dev servers ECONNREFUSE.
let upstream6: Server;
let upstream6Port: number;
beforeAll(async () => {
  upstream = createServer((req, res) => {
    res.setHeader("x-frame-options", "DENY");
    res.setHeader("content-security-policy", "default-src 'self'; frame-ancestors 'none'");
    // A path ending in .html mimics a dev server's index document with ROOT-absolute module URLs.
    if (req.url?.includes(".html")) {
      res.setHeader("content-type", "text/html");
      res.setHeader("transfer-encoding", "chunked"); // mimic a dev server (e.g. Vite) that streams its HTML
      res.write(`<html><head></head><body><script type="module" src="/src/main.tsx"></script></body></html>`);
      res.end();
      return;
    }
    res.end(`hello from ${req.url}`);
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", () => r()));
  upstreamPort = (upstream.address() as any).port;

  upstream6 = createServer((req, res) => res.end(`hello6 from ${req.url}`));
  await new Promise<void>((r) => upstream6.listen(0, "::1", () => r()));
  upstream6Port = (upstream6.address() as any).port;
});
afterAll(() => { upstream.close(); upstream6.close(); });

describe("preview proxy (HTTP)", () => {
  it("proxies a loopback request to 127.0.0.1:<port>, rewriting the prefix away", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: `/api/preview/${upstreamPort}/foo` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("hello from /foo");
    await app.close();
  });

  it("reaches a dev server bound to ::1 only (IPv6 loopback), not just 127.0.0.1", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: `/api/preview/${upstream6Port}/foo` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("hello6 from /foo");
    await app.close();
  });

  it("re-prefixes an absolute-path sub-resource back to its port using the preview Referer", async () => {
    // The app's HTML asked for /assets/app.css by absolute path; the browser fetched it from the
    // origin root. The Referer marks it as coming from inside the preview iframe → route it upstream.
    const app = await build();
    const res = await app.inject({
      method: "GET",
      url: "/assets/app.css",
      headers: { referer: `http://localhost/api/preview/${upstreamPort}/index.html` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("hello from /assets/app.css");
    await app.close();
  });

  it("rewrites a proxied HTML document so its root-absolute module URLs carry the preview prefix", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: `/api/preview/${upstreamPort}/index.html` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(`src="/api/preview/${upstreamPort}/src/main.tsx"`);
    expect(res.body).toContain(`<base href="/api/preview/${upstreamPort}/">`);
    await app.close();
  });

  it("frames the rewritten HTML so a strict HTTP client doesn't Parse Error (no Content-Length + Transfer-Encoding)", async () => {
    // The upstream streams chunked (no Content-Length); we buffer + resend a fixed-length string, so
    // the upstream's Transfer-Encoding MUST be dropped. Both framing headers on one response is illegal
    // and Node's strict parser (which Vite's dev proxy uses) rejects it. app.inject normalizes headers
    // and can't see this — so hit a real socket with the core http client.
    const app = await build();
    await app.listen({ host: "127.0.0.1", port: 0 });
    const appPort = (app.server.address() as any).port;
    const out = await new Promise<{ err?: string; body: string }>((resolve) => {
      httpGet({ host: "127.0.0.1", port: appPort, path: `/api/preview/${upstreamPort}/index.html` }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => resolve({ body: Buffer.concat(chunks).toString() }));
      }).on("error", (e) => resolve({ err: e.message, body: "" }));
    });
    expect(out.err).toBeUndefined();
    expect(out.body).toContain(`src="/api/preview/${upstreamPort}/src/main.tsx"`);
    await app.close();
  });

  it("strips X-Frame-Options and CSP frame-ancestors so the response can be framed", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: `/api/preview/${upstreamPort}/` });
    expect(res.headers["x-frame-options"]).toBeUndefined();
    expect(res.headers["content-security-policy"]).toBe("default-src 'self'");
    await app.close();
  });

  it("rejects a non-numeric port with 400, never proxying it", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: `/api/preview/notaport/` });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("401s an exposed preview request with no credential", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: `/api/preview/${upstreamPort}/`, headers: EXPOSED });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("serves an exposed request that carries the preview cookie (global auth skips, proxy auth runs)", async () => {
    const app = await build();
    const res = await app.inject({
      method: "GET",
      url: `/api/preview/${upstreamPort}/`,
      headers: { ...EXPOSED, cookie: "tr_preview=secret" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("hello from /");
    await app.close();
  });
});

describe("preview-session cookie", () => {
  it("mints an HttpOnly cookie scoped to /api/preview, gated by normal Bearer auth", async () => {
    const app = await build();
    const res = await app.inject({
      method: "POST",
      url: "/api/preview-session",
      headers: { ...EXPOSED, authorization: "Bearer secret" },
    });
    expect(res.statusCode).toBe(200);
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toContain("tr_preview=secret");
    // Path=/ (not /api/preview): origin-root sub-resources (/assets/…) must carry the cookie too, or
    // they'd 401 after the Referer rewrite re-prefixes them on an exposed instance.
    expect(cookie).toContain("Path=/;");
    expect(cookie).not.toContain("Path=/api/preview");
    expect(cookie).toContain("HttpOnly");
    await app.close();
  });

  it("refuses to mint the cookie for an exposed request with no token", async () => {
    const app = await build();
    const res = await app.inject({ method: "POST", url: "/api/preview-session", headers: EXPOSED });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

// The preview proxy must NOT clobber the @fastify/websocket upgrade handling the terminal/lsp/
// notification gateways rely on. (http-proxy's `websocket:true` would install a second, conflicting
// `upgrade` listener — so it stays off. This guards against it being re-enabled naively.)
describe("preview proxy coexists with @fastify/websocket upgrades", () => {
  it("leaves a real WebSocket route working after the proxy is registered, and still proxies HTTP", async () => {
    const app = Fastify();
    await app.register(websocket);
    app.get("/ws/echo", { websocket: true }, (socket) => {
      socket.on("message", (m: Buffer) => socket.send(`echo:${m.toString()}`));
    });
    await previewRoutes(app, config);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const appPort = (app.server.address() as any).port;

    const echoed = await new Promise<string>((resolve, reject) => {
      const client = new WebSocket(`ws://127.0.0.1:${appPort}/ws/echo`);
      const timer = setTimeout(() => reject(new Error("ws upgrade broken by proxy")), 4000);
      client.on("open", () => client.send("ping"));
      client.on("message", (d) => { clearTimeout(timer); resolve(d.toString()); client.close(); });
      client.on("error", (e) => { clearTimeout(timer); reject(e); });
    });
    expect(echoed).toBe("echo:ping");

    const res = await app.inject({ method: "GET", url: `/api/preview/${upstreamPort}/ok` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("hello from /ok");
    await app.close();
  });
});
