import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { lspRoutes } from "./lsp.js";

function build() {
  const app = Fastify();
  app.register(lspRoutes);
  return app;
}

describe("lsp routes", () => {
  it("GET /api/lsp/servers returns the registry with installed flags and hides bin/args", async () => {
    const app = build();
    const res = await app.inject({ method: "GET", url: "/api/lsp/servers" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.servers.map((s: any) => s.id)).toContain("typescript-language-server");
    expect(typeof body.servers[0].installed).toBe("boolean");
    expect(Array.isArray(body.servers[0].languageIds)).toBe(true);
    expect(body.servers[0].installHint).toBeTruthy();
    expect(body.servers[0].bin).toBeUndefined();
    expect(body.servers[0].args).toBeUndefined();
  });
});
