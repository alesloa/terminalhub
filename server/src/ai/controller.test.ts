import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createStore } from "../db/store.js";
import { createAiController } from "./controller.js";
import type { GitController } from "../git/controller.js";
import type { DetectedAgent } from "../agents/registry.js";

// The staged-diff helpers (commit messages) plus the PR-context helpers (PR descriptions).
const fakeGit = {
  stagedDiff: async () => "+const x = 1;",
  stagedNameStatus: async () => "M src/x.ts",
  listUntracked: async () => ["src/", "package.json", "README.md"],
  defaultBranch: async () => "main",
  prContext: async (_cwd: string, base: string) => ({ commits: `- feat: thing over ${base}`, files: "M src/x.ts" }),
} as unknown as GitController;

// No CLIs detected by default, so tests don't depend on the real $PATH.
function build(detect: () => DetectedAgent[] = () => []) {
  const store = createStore(":memory:");
  return { store, ai: createAiController(store, fakeGit, detect) };
}

describe("ai controller", () => {
  let h: ReturnType<typeof build>;
  beforeEach(() => { h = build(); });

  it("redacts api keys in listProviders", () => {
    h.store.setAiConfig({ defaultProviderId: "o", providers: [{ id: "o", kind: "openai-compatible", label: "OpenAI", enabled: true, model: "m", apiKey: "secret" }] });
    const list = h.ai.listProviders();
    expect((list[0] as Record<string, unknown>).apiKey).toBeUndefined();
    expect(list[0].apiKeySet).toBe(true);
  });

  it("preserves the stored key when saving a provider with apiKey omitted", () => {
    h.store.setAiConfig({ defaultProviderId: "o", providers: [{ id: "o", kind: "openai-compatible", label: "OpenAI", enabled: true, model: "m", apiKey: "secret" }] });
    h.ai.saveConfig({ defaultProviderId: "o", providers: [{ id: "o", kind: "openai-compatible", label: "OpenAI renamed", enabled: true, model: "m2" }] });
    const saved = h.store.getAiConfig().providers[0];
    expect(saved.apiKey).toBe("secret");
    expect(saved.label).toBe("OpenAI renamed");
  });

  it("generates a commit message via a cli provider (cat echoes the prompt)", async () => {
    h.store.setAiConfig({ defaultProviderId: "c", providers: [{ id: "c", kind: "cli", label: "cat", enabled: true, command: ["cat"] }] });
    const msg = await h.ai.generateCommitMessage("/repo");
    expect(msg).toContain("+const x = 1;");
  });

  it("throws when no provider is configured", async () => {
    await expect(h.ai.generateCommitMessage("/repo")).rejects.toThrow(/no AI provider/);
  });

  it("generates an initial-commit message from the top-level listing, not a staged diff", async () => {
    h.store.setAiConfig({ defaultProviderId: "c", providers: [{ id: "c", kind: "cli", label: "cat", enabled: true, command: ["cat"] }] });
    const msg = await h.ai.generateInitialCommitMessage("/repo");
    expect(msg).toContain("FIRST commit"); // the initial-commit framing
    expect(msg).toContain("package.json"); // the file listing, not the staged diff
    expect(msg).not.toContain("+const x = 1;");
  });

  it("uses a custom commit prompt, still appending the diff", async () => {
    h.store.setAiConfig({ defaultProviderId: "c", commitPrompt: "MAKE IT RHYME",
      providers: [{ id: "c", kind: "cli", label: "cat", enabled: true, command: ["cat"] }] });
    const msg = await h.ai.generateCommitMessage("/repo");
    expect(msg).toContain("MAKE IT RHYME");
    expect(msg).toContain("+const x = 1;");
  });

  it("keeps the stored commit prompt when saveConfig omits it; clears it on empty string", () => {
    h.store.setAiConfig({ defaultProviderId: null, commitPrompt: "custom", providers: [] });
    h.ai.saveConfig({ defaultProviderId: null, providers: [] }); // omitted → keep
    expect(h.store.getAiConfig().commitPrompt).toBe("custom");
    h.ai.saveConfig({ defaultProviderId: null, commitPrompt: "", providers: [] }); // "" → reset
    expect(h.store.getAiConfig().commitPrompt).toBe("");
  });

  it("generates a PR description, splitting the first line as the title (cat echoes the prompt)", async () => {
    h.store.setAiConfig({ defaultProviderId: "c", providers: [{ id: "c", kind: "cli", label: "cat", enabled: true, command: ["cat"] }] });
    const { title, body } = await h.ai.generatePrDescription("/repo");
    expect(title.length).toBeGreaterThan(0);
    expect(body).toContain("feat: thing over main"); // prContext fed into the prompt, echoed by cat
  });

  it("scopes PR generation to the given base branch", async () => {
    h.store.setAiConfig({ defaultProviderId: "c", providers: [{ id: "c", kind: "cli", label: "cat", enabled: true, command: ["cat"] }] });
    const { body } = await h.ai.generatePrDescription("/repo", "release");
    expect(body).toContain("feat: thing over release");
  });

  it("throws when no provider is configured for a PR description", async () => {
    await expect(h.ai.generatePrDescription("/repo")).rejects.toThrow(/no AI provider/);
  });

  it("throws when the branch has no commits over the base", async () => {
    const git = { defaultBranch: async () => "main", prContext: async () => ({ commits: "", files: "" }) } as unknown as GitController;
    const store = createStore(":memory:");
    store.setAiConfig({ defaultProviderId: "c", providers: [{ id: "c", kind: "cli", label: "cat", enabled: true, command: ["cat"] }] });
    await expect(createAiController(store, git).generatePrDescription("/repo")).rejects.toThrow(/no commits/);
  });

  it("keeps the stored PR prompt when saveConfig omits it; clears it on empty string", () => {
    h.store.setAiConfig({ defaultProviderId: null, prPrompt: "custom pr", providers: [] });
    h.ai.saveConfig({ defaultProviderId: null, providers: [] }); // omitted → keep
    expect(h.store.getAiConfig().prPrompt).toBe("custom pr");
    h.ai.saveConfig({ defaultProviderId: null, prPrompt: "", providers: [] }); // "" → reset
    expect(h.store.getAiConfig().prPrompt).toBe("");
  });

  it("builderInfo surfaces detected CLIs even with no configured providers", () => {
    const h2 = build(() => [
      { id: "claude", name: "Claude Code", command: "claude", blurb: "", installed: true },
      { id: "codex", name: "Codex", command: "codex", blurb: "", installed: false },
    ]);
    const info = h2.ai.builderInfo();
    expect(info.engines.map(e => e.id)).toEqual(["builtin:claude"]);
    expect(info.targetTools).toContain("Claude Code");
    expect(info.defaultEngineId).toBe("builtin:claude");
  });

  it("buildPrompt runs through a detected CLI (cat stands in, echoing the prompt)", async () => {
    // Map the detected "claude" engine onto `cat` so the one-shot pipe echoes our built prompt.
    const h2 = build(() => [{ id: "claude", name: "Claude Code", command: "claude", blurb: "", installed: true }]);
    h2.store.setAiConfig({ defaultProviderId: null, providers: [{ id: "cat", kind: "cli", label: "cat", enabled: true, command: ["cat"] }] });
    const out = await h2.ai.buildPrompt({ idea: "summarize a PDF", targetTool: "Claude" }, "cat");
    expect(out).toContain("Target tool: Claude");
    expect(out).toContain("Task: summarize a PDF");
  });

  it("buildPrompt throws when there is no engine at all", async () => {
    await expect(h.ai.buildPrompt({ idea: "x", targetTool: "Claude" })).rejects.toThrow(/no AI engine/);
  });

  it("buildBlueprintPrompt runs the serialized spec through an engine (cat echoes it)", async () => {
    h.store.setAiConfig({ defaultProviderId: "cat", providers: [{ id: "cat", kind: "cli", label: "cat", enabled: true, command: ["cat"] }] });
    const spec = "1. Create a file\n2. Check: empty?\n   - If yes: 3. Write hello";
    const out = await h.ai.buildBlueprintPrompt(spec, "Claude Code");
    expect(out).toContain("Target tool: Claude Code");
    expect(out).toContain("1. Create a file");
    expect(out).toContain("If yes: 3. Write hello");
  });

  it("buildBlueprintPrompt throws when there is no engine at all", async () => {
    await expect(h.ai.buildBlueprintPrompt("1. do thing", "Claude")).rejects.toThrow(/no AI engine/);
  });

  it("builderInfo reports a codex-first default chat engine when codex is installed", () => {
    const h2 = build(() => [{ id: "codex", name: "Codex", command: "codex", blurb: "", installed: true }]);
    h2.store.setAiConfig({ defaultProviderId: "o", providers: [{ id: "o", kind: "openai-compatible", label: "OpenAI", enabled: true, model: "m", apiKey: "k", baseUrl: "https://api.openai.com/v1" }] });
    const info = h2.ai.builderInfo();
    expect(info.defaultEngineId).toBe("o"); // build engine still honours the configured default
    expect(info.defaultChatEngineId).toBe("builtin:codex"); // chat box prefers codex
  });

  it("chat runs the transcript through the resolved engine (cat echoes it) and includes the plan", async () => {
    h.store.setAiConfig({ defaultProviderId: "cat", providers: [{ id: "cat", kind: "cli", label: "cat", enabled: true, command: ["cat"] }] });
    const out = await h.ai.chat(
      [{ role: "user", content: "what edge cases am I missing?" }],
      { spec: "1. Read a file\n2. Check: empty?", targetTool: "Codex", engineId: "cat" },
    );
    // cat echoes the whole prompt; with no valid JSON envelope, parseChatReply returns it as reply.
    expect(out.reply).toContain("what edge cases am I missing?"); // the user turn is in the piped transcript
    expect(out.reply).toContain("1. Read a file"); // the live plan is injected into the system prompt
    expect(out.reply).toContain("Codex"); // the target tool too
    expect(out.ops).toEqual([]);
  });

  it("chat preserves the FULL multi-turn transcript (no history dropped)", async () => {
    h.store.setAiConfig({ defaultProviderId: "cat", providers: [{ id: "cat", kind: "cli", label: "cat", enabled: true, command: ["cat"] }] });
    const out = await h.ai.chat([
      { role: "user", content: "my favorite color is teal" },
      { role: "assistant", content: "Got it — teal." },
      { role: "user", content: "what is my favorite color?" },
    ], { engineId: "cat" });
    // Every turn must appear in the piped transcript, in order — this is what the model reads as memory.
    expect(out.reply).toContain("User: my favorite color is teal");
    expect(out.reply).toContain("Assistant: Got it — teal.");
    expect(out.reply).toContain("what is my favorite color?");
    expect(out.reply.indexOf("teal")).toBeLessThan(out.reply.lastIndexOf("favorite color"));
  });

  it("chat parses a JSON envelope from the engine into reply + ops", async () => {
    // printf ignores stdin and prints its arg verbatim — a deterministic stand-in for a model that
    // returns the canvas-editing envelope.
    const envelope = JSON.stringify({ reply: "Added a validate step.", ops: [{ op: "add", tempId: "t1", kind: "action", label: "Validate" }] });
    h.store.setAiConfig({ defaultProviderId: "p", providers: [{ id: "p", kind: "cli", label: "printf", enabled: true, command: ["printf", "%s", envelope] }] });
    const out = await h.ai.chat([{ role: "user", content: "add a validate step" }], { engineId: "p" });
    expect(out.reply).toBe("Added a validate step.");
    expect(out.ops).toEqual([{ op: "add", tempId: "t1", kind: "action", label: "Validate" }]);
  });

  it("chat injects a node manifest with real ids when a graph is provided", async () => {
    h.store.setAiConfig({ defaultProviderId: "cat", providers: [{ id: "cat", kind: "cli", label: "cat", enabled: true, command: ["cat"] }] });
    const out = await h.ai.chat([{ role: "user", content: "rename it" }], {
      engineId: "cat",
      graph: { nodes: [{ id: "n_42", type: "action", data: { label: "Fetch data" } }], edges: [] },
      selected: ["n_42"],
    });
    expect(out.reply).toContain("n_42"); // the id the model needs to target the card
    expect(out.reply).toContain("Fetch data");
    expect(out.reply).toContain("SELECTED"); // the selection hint is passed through
  });

  it("chat throws when there is no engine at all", async () => {
    await expect(h.ai.chat([{ role: "user", content: "hi" }])).rejects.toThrow(/no AI engine/);
  });

  describe("listModels", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("uses the stored key when refreshing by id with no inline key", async () => {
      h.store.setAiConfig({ defaultProviderId: "k", providers: [{ id: "k", kind: "openai-compatible", label: "Kimi", enabled: true, apiKey: "stored", baseUrl: "https://api.moonshot.ai/v1" }] });
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "kimi-k2-0905-preview" }] }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const models = await h.ai.listModels({ id: "k", kind: "openai-compatible" });
      expect(models).toEqual(["kimi-k2-0905-preview"]);
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer stored");
    });

    it("prefers a just-typed inline key over the stored one", async () => {
      h.store.setAiConfig({ defaultProviderId: "k", providers: [{ id: "k", kind: "openai-compatible", label: "Kimi", enabled: true, apiKey: "stored", baseUrl: "https://api.moonshot.ai/v1" }] });
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      await h.ai.listModels({ id: "k", kind: "openai-compatible", apiKey: "typed" });
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer typed");
    });

    it("CLI: lists from the backing API using the backing env var key", async () => {
      process.env.ANTHROPIC_API_KEY = "env-key";
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "claude-sonnet-4" }] }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const models = await h.ai.listModels({ kind: "cli", label: "Claude (CLI)", command: ["claude", "-p"] });
      expect(models).toEqual(["claude-sonnet-4"]);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.anthropic.com/v1/models");
      expect((init.headers as Record<string, string>)["x-api-key"]).toBe("env-key");
      delete process.env.ANTHROPIC_API_KEY;
    });

    it("CLI: reuses a matching configured API provider's key when no env var is set", async () => {
      delete process.env.OPENAI_API_KEY;
      h.store.setAiConfig({ defaultProviderId: null, providers: [
        { id: "oa", kind: "openai-compatible", label: "OpenAI", enabled: true, apiKey: "from-api-provider", baseUrl: "https://api.openai.com/v1" },
      ] });
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "gpt-5" }] }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const models = await h.ai.listModels({ kind: "cli", label: "Codex (CLI)", command: ["codex", "exec"] });
      expect(models).toEqual(["gpt-5"]);
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer from-api-provider");
    });

    it("CLI with no backing model API (cursor) throws so the UI falls back to manual entry", async () => {
      await expect(h.ai.listModels({ kind: "cli", label: "Cursor (CLI)", command: ["cursor-agent", "-p"] }))
        .rejects.toThrow(/type the model id manually/);
    });

    it("CLI with a backing API but no key anywhere throws a helpful message", async () => {
      delete process.env.ANTHROPIC_API_KEY;
      await expect(h.ai.listModels({ kind: "cli", label: "Claude (CLI)", command: ["claude", "-p"] }))
        .rejects.toThrow(/no key to list/);
    });
  });

  describe("detectedClis", () => {
    it("offers only installed CLIs that have a one-shot command", () => {
      const h2 = build(() => [
        { id: "claude", name: "Claude Code", command: "claude", blurb: "", installed: true },
        { id: "gemini", name: "Gemini", command: "gemini", blurb: "", installed: true },
        { id: "codex", name: "Codex", command: "codex", blurb: "", installed: false }, // not installed → omitted
      ]);
      const clis = h2.ai.detectedClis();
      expect(clis.map(c => c.id)).toEqual(["claude", "gemini"]);
      expect(clis.find(c => c.id === "gemini")?.command).toEqual(["gemini", "-o", "text"]);
    });
  });
});
