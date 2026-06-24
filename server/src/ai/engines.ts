// Resolves which AI engines the Prompt Builder can offer: the user's usable configured providers
// PLUS coding-agent CLIs detected on $PATH that we know how to run one-shot. This is what makes
// the builder show "only the ones you actually have" — installed CLIs appear without manual setup.

import { resolveKey } from "./complete.js";
import type { DetectedAgent } from "../agents/registry.js";
import type { AiConfig, AiProvider } from "./types.js";
import { CLI_ONESHOT } from "./cli.js";

// The one-shot CLI invocations live in ./cli.js alongside their model-flag / prompt-delivery specs;
// re-exported here so existing importers (and the engines below) keep their import site.
export { CLI_ONESHOT };

/** A provider is usable now if it's enabled and actually runnable end-to-end: a CLI with a
 *  command, or an API kind with BOTH a key (stored or via env var) AND a model. The model check
 *  matters — an API provider with a key but no model would show up but fail at request time. */
function usable(p: AiProvider): boolean {
  if (!p.enabled) return false;
  if (p.kind === "cli") return !!p.command?.length;
  return !!resolveKey(p) && !!p.model?.trim();
}

/** The public shape of one engine offered in the build-with dropdown (no secrets). */
export interface BuilderEngine {
  id: string; // configured provider id, or `builtin:<agent>` for a detected CLI
  label: string; // shown in the dropdown, e.g. "OpenAI" or "Claude Code (CLI)"
  tool: string; // the human tool name this engine targets by default, e.g. "Claude Code"
}

/** An engine plus the full provider object (incl. secrets) needed to actually run it. */
export interface EngineEntry extends BuilderEngine {
  provider: AiProvider;
}

/** Every engine the builder can drive: usable configured providers + detected one-shot CLIs.
 *  A detected CLI is dropped if a configured CLI already uses the same binary (no duplicates). */
export function availableEngines(cfg: AiConfig, detected: DetectedAgent[]): EngineEntry[] {
  const configured: EngineEntry[] = cfg.providers.filter(usable)
    .map(p => ({ id: p.id, label: p.label, tool: p.label, provider: p }));
  const haveBin = new Set(
    configured.filter(e => e.provider.kind === "cli").map(e => e.provider.command?.[0]),
  );
  const fromCli: EngineEntry[] = detected
    .filter(a => a.installed && CLI_ONESHOT[a.id] && !haveBin.has(CLI_ONESHOT[a.id][0]))
    .map(a => ({
      id: `builtin:${a.id}`,
      label: `${a.name} (CLI)`,
      tool: a.name,
      provider: { id: `builtin:${a.id}`, kind: "cli", label: `${a.name} (CLI)`, enabled: true, command: CLI_ONESHOT[a.id] },
    }));
  return [...configured, ...fromCli];
}

/** Target-tool options: the tools behind every available engine, plus any other installed CLI
 *  (you may want a prompt *formatted* for a tool you don't build with). Deduped, order preserved. */
export function targetToolNames(entries: EngineEntry[], detected: DetectedAgent[]): string[] {
  return [...new Set([...entries.map(e => e.tool), ...detected.filter(a => a.installed).map(a => a.name)])];
}

/** The chat box's preferred default, lower = preferred. The order is Ale's spec: codex CLI first
 *  (free + local, the default whenever installed), then DeepSeek → Kimi → Anthropic → OpenAI by
 *  key; any other OpenAI-compatible API next, and finally other CLIs (claude, …) as a last resort. */
function chatRank(e: EngineEntry): number {
  const p = e.provider;
  if (p.kind === "cli" && p.command?.[0] === "codex") return 0;
  const url = (p.baseUrl ?? "").toLowerCase();
  if (url.includes("deepseek")) return 1;
  if (url.includes("moonshot")) return 2; // Kimi
  if (p.kind === "anthropic") return 3;
  if (url.includes("api.openai.com")) return 4;
  if (p.kind === "openai-compatible") return 5; // other OpenAI-compatible (Gemini, OpenRouter, …)
  return 6; // other CLIs (claude, …)
}

/** Which engine the floating chat box uses by default: the codex-first priority winner, or
 *  undefined when the user has nothing usable. Array#sort is stable, so ties keep input order. */
export function pickChatEngine(entries: EngineEntry[]): EngineEntry | undefined {
  return [...entries].sort((a, b) => chatRank(a) - chatRank(b))[0];
}
