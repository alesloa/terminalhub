import { describe, it, expect } from "vitest";
import { availableEngines, targetToolNames, pickChatEngine } from "./engines.js";
import type { DetectedAgent } from "../agents/registry.js";
import type { AiConfig } from "./types.js";

const det = (over: Partial<DetectedAgent> & { id: string; installed: boolean }): DetectedAgent =>
  ({ name: over.id, command: over.id, blurb: "", ...over });

const detected: DetectedAgent[] = [
  det({ id: "claude", name: "Claude Code", installed: true }),
  det({ id: "codex", name: "Codex", installed: false }), // installed=false → excluded as engine
  det({ id: "gemini", name: "Gemini", installed: true }), // now has a one-shot command → engine too
];

describe("availableEngines", () => {
  it("offers installed one-shot CLIs as synthetic engines", () => {
    const cfg: AiConfig = { providers: [], defaultProviderId: null };
    const engines = availableEngines(cfg, detected);
    expect(engines.map(e => e.id)).toEqual(["builtin:claude", "builtin:gemini"]); // codex not installed
    expect(engines[0]).toMatchObject({ label: "Claude Code (CLI)", tool: "Claude Code" });
    expect(engines[0].provider.command).toEqual(["claude", "-p"]);
  });

  it("includes usable configured providers and excludes unusable ones", () => {
    const cfg: AiConfig = {
      defaultProviderId: "o",
      providers: [
        { id: "o", kind: "openai-compatible", label: "OpenAI", enabled: true, model: "m", apiKey: "k" }, // usable
        { id: "n", kind: "openai-compatible", label: "NoKey", enabled: true, model: "m" }, // no key → out
        { id: "nm", kind: "openai-compatible", label: "NoModel", enabled: true, apiKey: "k" }, // no model → out
        { id: "d", kind: "anthropic", label: "Disabled", enabled: false, apiKey: "k", model: "m" }, // disabled → out
      ],
    };
    const ids = availableEngines(cfg, []).map(e => e.id);
    expect(ids).toContain("o");
    expect(ids).not.toContain("n");
    expect(ids).not.toContain("nm");
    expect(ids).not.toContain("d");
  });

  it("drops a detected CLI when a configured provider already uses that binary", () => {
    const cfg: AiConfig = {
      defaultProviderId: null,
      providers: [{ id: "mine", kind: "cli", label: "My Claude", enabled: true, command: ["claude", "-p"] }],
    };
    const engines = availableEngines(cfg, detected);
    expect(engines.map(e => e.id)).toEqual(["mine", "builtin:gemini"]); // builtin:claude suppressed (same `claude` binary)
  });
});

describe("targetToolNames", () => {
  it("unions engine tools with every installed CLI name, deduped", () => {
    const cfg: AiConfig = {
      defaultProviderId: null,
      providers: [{ id: "o", kind: "openai-compatible", label: "OpenAI", enabled: true, model: "m", apiKey: "k" }],
    };
    const entries = availableEngines(cfg, detected);
    const tools = targetToolNames(entries, detected);
    expect(tools).toContain("OpenAI"); // configured engine tool
    expect(tools).toContain("Claude Code"); // installed CLI (also an engine)
    expect(tools).toContain("Gemini"); // installed CLI with no one-shot command → still a target
    expect(tools).not.toContain("Codex"); // not installed
    expect(new Set(tools).size).toBe(tools.length); // deduped
  });
});

describe("pickChatEngine", () => {
  const cfgWith = (providers: AiConfig["providers"]): AiConfig => ({ providers, defaultProviderId: null });
  const api = (label: string, baseUrl: string): AiConfig["providers"][number] =>
    ({ id: label, kind: "openai-compatible", label, enabled: true, model: "m", apiKey: "k", baseUrl });

  it("prefers an installed codex CLI over everything else", () => {
    const cfg = cfgWith([api("DeepSeek", "https://api.deepseek.com")]);
    const detected: DetectedAgent[] = [det({ id: "codex", name: "Codex", installed: true })];
    expect(pickChatEngine(availableEngines(cfg, detected))?.id).toBe("builtin:codex");
  });

  it("falls back DeepSeek → Kimi → Anthropic → OpenAI when codex is absent", () => {
    const all = cfgWith([
      api("OpenAI", "https://api.openai.com/v1"),
      { id: "anth", kind: "anthropic", label: "Anthropic", enabled: true, model: "m", apiKey: "k" },
      api("Kimi", "https://api.moonshot.ai/v1"),
      api("DeepSeek", "https://api.deepseek.com"),
    ]);
    expect(pickChatEngine(availableEngines(all, []))?.label).toBe("DeepSeek");

    const noDeepseek = cfgWith([api("OpenAI", "https://api.openai.com/v1"), api("Kimi", "https://api.moonshot.ai/v1")]);
    expect(pickChatEngine(availableEngines(noDeepseek, []))?.label).toBe("Kimi");

    const onlyOpenai = cfgWith([api("OpenAI", "https://api.openai.com/v1")]);
    expect(pickChatEngine(availableEngines(onlyOpenai, []))?.label).toBe("OpenAI");
  });

  it("uses another CLI (claude) only as a last resort, and returns undefined with nothing usable", () => {
    const detected: DetectedAgent[] = [det({ id: "claude", name: "Claude Code", installed: true })];
    expect(pickChatEngine(availableEngines(cfgWith([]), detected))?.id).toBe("builtin:claude");
    expect(pickChatEngine(availableEngines(cfgWith([]), []))).toBeUndefined();
  });
});
