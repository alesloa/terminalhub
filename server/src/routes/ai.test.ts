import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { aiRoutes } from "./ai.js";
import { AiError } from "../ai/complete.js";
import type { AppContext } from "../context.js";

function build(ai: Partial<AppContext["ai"]>) {
  const app = Fastify();
  app.register(async a => aiRoutes(a, { ai } as AppContext));
  return app;
}

describe("ai routes", () => {
  it("GET /api/ai/providers returns providers + default", async () => {
    const app = build({
      listProviders: () => [{ id: "o", kind: "openai-compatible", label: "OpenAI", enabled: true, apiKeySet: true, apiKeyFromEnv: false }],
      getConfig: () => ({ providers: [], defaultProviderId: "o" }),
      detectedClis: () => [{ id: "claude", label: "Claude Code (CLI)", command: ["claude", "-p"] }],
    });
    const res = await app.inject({ method: "GET", url: "/api/ai/providers" });
    expect(res.statusCode).toBe(200);
    expect(res.json().defaultProviderId).toBe("o");
    expect(res.json().providers[0].apiKeySet).toBe(true);
    expect(res.json().detectedClis[0].id).toBe("claude");
  });

  it("POST /api/ai/commit-message returns the generated message", async () => {
    const app = build({ generateCommitMessage: async () => "feat: add thing" });
    const res = await app.inject({ method: "POST", url: "/api/ai/commit-message", payload: { path: "/repo" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().message).toBe("feat: add thing");
  });

  it("maps AiError to 400", async () => {
    const app = build({ generateCommitMessage: async () => { throw new AiError("nothing staged"); } });
    const res = await app.inject({ method: "POST", url: "/api/ai/commit-message", payload: { path: "/repo" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("nothing staged");
  });

  it("400s without a path", async () => {
    const app = build({});
    expect((await app.inject({ method: "POST", url: "/api/ai/commit-message", payload: {} })).statusCode).toBe(400);
  });

  it("POST /api/ai/initial-commit-message returns the generated message", async () => {
    const app = build({ generateInitialCommitMessage: async () => "chore: initial commit" });
    const res = await app.inject({ method: "POST", url: "/api/ai/initial-commit-message", payload: { path: "/repo" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().message).toBe("chore: initial commit");
  });

  it("maps a failed initial-commit generation (AiError) to 400", async () => {
    const app = build({ generateInitialCommitMessage: async () => { throw new AiError("the folder is empty"); } });
    const res = await app.inject({ method: "POST", url: "/api/ai/initial-commit-message", payload: { path: "/repo" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("the folder is empty");
  });

  it("POST /api/ai/pr-description returns the generated title + body", async () => {
    const app = build({ generatePrDescription: async (_p, base) => ({ title: "feat: add x", body: `over ${base ?? "default"}` }) });
    const res = await app.inject({ method: "POST", url: "/api/ai/pr-description", payload: { path: "/repo", base: "main" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ title: "feat: add x", body: "over main" });
  });

  it("pr-description maps AiError to 400", async () => {
    const app = build({ generatePrDescription: async () => { throw new AiError("no commits on this branch over main"); } });
    const res = await app.inject({ method: "POST", url: "/api/ai/pr-description", payload: { path: "/repo" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("no commits on this branch over main");
  });

  it("pr-description 400s without a path", async () => {
    const app = build({});
    expect((await app.inject({ method: "POST", url: "/api/ai/pr-description", payload: {} })).statusCode).toBe(400);
  });

  it("GET /api/ai/builder returns engines, target tools, and a default", async () => {
    const app = build({
      builderInfo: () => ({
        engines: [{ id: "builtin:claude", label: "Claude Code (CLI)", tool: "Claude Code" }],
        targetTools: ["Claude Code", "Gemini"],
        defaultEngineId: "builtin:claude",
        defaultChatEngineId: "builtin:claude",
      }),
    });
    const res = await app.inject({ method: "GET", url: "/api/ai/builder" });
    expect(res.statusCode).toBe(200);
    expect(res.json().engines[0].id).toBe("builtin:claude");
    expect(res.json().targetTools).toContain("Gemini");
    expect(res.json().defaultEngineId).toBe("builtin:claude");
  });

  it("POST /api/ai/build-prompt returns the built prompt", async () => {
    const app = build({ buildPrompt: async () => "You are a senior analyst…" });
    const res = await app.inject({ method: "POST", url: "/api/ai/build-prompt", payload: { inputs: { idea: "summarize", targetTool: "Claude" } } });
    expect(res.statusCode).toBe(200);
    expect(res.json().prompt).toContain("senior analyst");
  });

  it("build-prompt 400s when idea or targetTool is missing", async () => {
    const app = build({});
    expect((await app.inject({ method: "POST", url: "/api/ai/build-prompt", payload: { inputs: { idea: "x" } } })).statusCode).toBe(400);
  });

  it("build-prompt maps AiError to 400", async () => {
    const app = build({ buildPrompt: async () => { throw new AiError("no AI provider configured"); } });
    const res = await app.inject({ method: "POST", url: "/api/ai/build-prompt", payload: { inputs: { idea: "x", targetTool: "Claude" } } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("no AI provider");
  });

  it("POST /api/ai/build-prompt-from-blueprint returns the polished prompt", async () => {
    const app = build({ buildBlueprintPrompt: async () => "Implement the following…" });
    const res = await app.inject({ method: "POST", url: "/api/ai/build-prompt-from-blueprint", payload: { spec: "1. do thing", targetTool: "Claude Code" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().prompt).toContain("Implement the following");
  });

  it("build-prompt-from-blueprint 400s when spec or targetTool is missing", async () => {
    const app = build({});
    expect((await app.inject({ method: "POST", url: "/api/ai/build-prompt-from-blueprint", payload: { spec: "x" } })).statusCode).toBe(400);
  });

  it("build-prompt-from-blueprint maps AiError to 400", async () => {
    const app = build({ buildBlueprintPrompt: async () => { throw new AiError("no AI engine available"); } });
    const res = await app.inject({ method: "POST", url: "/api/ai/build-prompt-from-blueprint", payload: { spec: "1. x", targetTool: "Claude" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("no AI engine");
  });

  it("POST /api/ai/chat returns the assistant reply + ops and forwards context", async () => {
    let got: any;
    const app = build({
      chat: async (messages, ctx) => {
        got = { messages, ctx };
        return { reply: "add an error-handling branch", ops: [{ op: "add", tempId: "t1", kind: "try", label: "Try fetch" }] };
      },
    });
    const res = await app.inject({
      method: "POST", url: "/api/ai/chat",
      payload: {
        messages: [{ role: "user", content: "what's missing?" }], spec: "1. fetch", targetTool: "Codex",
        graph: { nodes: [{ id: "n1" }], edges: [] }, selected: ["n1"],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().reply).toContain("error-handling");
    expect(res.json().ops[0]).toEqual({ op: "add", tempId: "t1", kind: "try", label: "Try fetch" });
    expect(got.messages).toEqual([{ role: "user", content: "what's missing?" }]);
    expect(got.ctx).toEqual({ spec: "1. fetch", targetTool: "Codex", graph: { nodes: [{ id: "n1" }], edges: [] }, selected: ["n1"] });
  });

  it("chat 400s with no messages", async () => {
    const app = build({});
    expect((await app.inject({ method: "POST", url: "/api/ai/chat", payload: { messages: [] } })).statusCode).toBe(400);
  });

  it("chat maps AiError to 400", async () => {
    const app = build({ chat: async () => { throw new AiError("no AI engine"); } });
    const res = await app.inject({ method: "POST", url: "/api/ai/chat", payload: { messages: [{ role: "user", content: "hi" }] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("no AI engine");
  });
});
