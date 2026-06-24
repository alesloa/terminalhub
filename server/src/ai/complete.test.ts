import { describe, it, expect, vi, afterEach } from "vitest";
import { complete, listModels, resolveKey, AiError } from "./complete.js";
import { buildCommitPrompt } from "./commit.js";
import type { AiProvider } from "./types.js";

afterEach(() => { vi.unstubAllGlobals(); delete process.env.TEST_AI_KEY; });

describe("resolveKey", () => {
  it("prefers a stored key over the env var", () => {
    process.env.TEST_AI_KEY = "from-env";
    expect(resolveKey({ apiKey: "stored", apiKeyEnv: "TEST_AI_KEY" } as AiProvider)).toBe("stored");
  });
  it("falls back to the env var when no key is stored", () => {
    process.env.TEST_AI_KEY = "from-env";
    expect(resolveKey({ apiKeyEnv: "TEST_AI_KEY" } as AiProvider)).toBe("from-env");
  });
  it("returns undefined when neither is set", () => {
    expect(resolveKey({} as AiProvider)).toBeUndefined();
  });
});

describe("buildCommitPrompt", () => {
  it("includes the conventional-commit types, file list, and diff", () => {
    const p = buildCommitPrompt("+added line", "M src/foo.ts");
    expect(p).toContain("feat, fix");
    expect(p).toContain("M src/foo.ts");
    expect(p).toContain("+added line");
  });
});

describe("complete (cli)", () => {
  it("pipes the prompt to stdin and returns stdout", async () => {
    const p: AiProvider = { id: "c", kind: "cli", label: "cat", enabled: true, command: ["cat"] };
    expect(await complete(p, "hello-prompt")).toBe("hello-prompt");
  });
  it("rejects with AiError when the binary is missing", async () => {
    const p: AiProvider = { id: "c", kind: "cli", label: "nope", enabled: true, command: ["definitely-not-a-real-binary-xyz"] };
    await expect(complete(p, "x")).rejects.toBeInstanceOf(AiError);
  });
});

describe("complete (openai-compatible)", () => {
  it("posts to /chat/completions with a bearer key and returns the content", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "feat: do thing" } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const p: AiProvider = { id: "o", kind: "openai-compatible", label: "OpenAI", enabled: true, model: "gpt-4o-mini", apiKey: "k", baseUrl: "https://api.openai.com/v1" };
    expect(await complete(p, "prompt")).toBe("feat: do thing");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer k");
  });
  it("throws AiError without a key", async () => {
    const p: AiProvider = { id: "o", kind: "openai-compatible", label: "OpenAI", enabled: true, model: "m" };
    await expect(complete(p, "x")).rejects.toThrow(/no API key/);
  });
  it("throws AiError without a model", async () => {
    const p: AiProvider = { id: "o", kind: "openai-compatible", label: "OpenAI", enabled: true, apiKey: "k" };
    await expect(complete(p, "x")).rejects.toThrow(/no model/);
  });
});

describe("listModels", () => {
  it("GETs <base>/models with a bearer key and returns sorted ids", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: "moonshot-v1-32k" }, { id: "kimi-k2-0905-preview" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const p: AiProvider = { id: "o", kind: "openai-compatible", label: "Kimi", enabled: true, apiKey: "k", baseUrl: "https://api.moonshot.ai/v1" };
    expect(await listModels(p)).toEqual(["kimi-k2-0905-preview", "moonshot-v1-32k"]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.moonshot.ai/v1/models");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer k");
  });
  it("uses the anthropic /v1/models endpoint with the x-api-key header", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: "claude-3-5-sonnet" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const p: AiProvider = { id: "a", kind: "anthropic", label: "Anthropic", enabled: true, apiKey: "k", baseUrl: "https://api.anthropic.com" };
    expect(await listModels(p)).toEqual(["claude-3-5-sonnet"]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/models");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("k");
  });
  it("throws AiError without a key", async () => {
    const p: AiProvider = { id: "o", kind: "openai-compatible", label: "Kimi", enabled: true, baseUrl: "https://api.moonshot.ai/v1" };
    await expect(listModels(p)).rejects.toThrow(/no API key/);
  });
  it("returns [] for a CLI provider", async () => {
    const p: AiProvider = { id: "c", kind: "cli", label: "Claude", enabled: true, command: ["claude", "-p"] };
    expect(await listModels(p)).toEqual([]);
  });
});
