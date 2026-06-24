import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchRoutes } from "./search.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "tr-searchroute-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "a.ts"), "const needle = 1;\nuse(needle);\n");
  writeFileSync(join(root, "readme.md"), "no match\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function build() {
  const app = Fastify();
  app.register(searchRoutes);
  return app;
}

describe("search routes", () => {
  it("POST /api/search returns grouped matches", async () => {
    const app = build();
    const res = await app.inject({ method: "POST", url: "/api/search", payload: { root, query: "needle" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.fileCount).toBe(1);
    expect(body.results[0].name).toBe("a.ts");
  });

  it("POST /api/search 400s without a root", async () => {
    const app = build();
    const res = await app.inject({ method: "POST", url: "/api/search", payload: { query: "x" } });
    expect(res.statusCode).toBe(400);
  });

  it("POST /api/search/replace rewrites the targeted file", async () => {
    const app = build();
    const p = join(root, "src", "a.ts");
    const res = await app.inject({
      method: "POST", url: "/api/search/replace",
      payload: { query: "needle", replace: "pin", targets: [{ path: p }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ replaced: 2, files: 1 });
    expect(readFileSync(p, "utf8")).toBe("const pin = 1;\nuse(pin);\n");
  });
});
