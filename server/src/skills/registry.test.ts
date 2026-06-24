import { describe, it, expect } from "vitest";
import { searchRegistry } from "./registry.js";

const fakeFetcher = (body: unknown, ok = true, status = 200) => {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    return { ok, status, json: async () => body };
  };
  return { fetcher, calls };
};

describe("skills/registry: searchRegistry", () => {
  const body = {
    query: "pdf",
    skills: [
      { id: "openai/skills/pdf", skillId: "pdf", name: "pdf", installs: 6375, source: "openai/skills" },
    ],
  };

  it("hits /api/search with the url-encoded query", async () => {
    const { fetcher, calls } = fakeFetcher(body);
    await searchRegistry("a b", { fetcher });
    expect(calls[0]).toBe("https://skills.sh/api/search?q=a%20b");
  });
  it("maps the response skills into RegistrySkill rows", async () => {
    const { fetcher } = fakeFetcher(body);
    expect(await searchRegistry("pdf", { fetcher })).toEqual([
      { id: "openai/skills/pdf", skillId: "pdf", name: "pdf", installs: 6375, source: "openai/skills" },
    ]);
  });
  it("returns [] when the payload has no skills array", async () => {
    const { fetcher } = fakeFetcher({ query: "x" });
    expect(await searchRegistry("x", { fetcher })).toEqual([]);
  });
  it("honors a custom base url", async () => {
    const { fetcher, calls } = fakeFetcher(body);
    await searchRegistry("x", { fetcher, baseUrl: "https://reg.example" });
    expect(calls[0]).toBe("https://reg.example/api/search?q=x");
  });
  it("throws when the registry responds non-ok", async () => {
    const { fetcher } = fakeFetcher({}, false, 502);
    await expect(searchRegistry("x", { fetcher })).rejects.toThrow(/502/);
  });
});
