import type { Store } from "../db/store.js";
import type { GitController } from "../git/controller.js";
import type { AiConfig, AiProvider, AiProviderKind, AiProviderPublic } from "./types.js";
import { complete, listModels as fetchModels, resolveKey, AiError } from "./complete.js";
import { CLI_SPECS, CLI_ONESHOT } from "./cli.js";
import { chat, type ChatMessage } from "./chat.js";
import { buildCommitPrompt, buildInitialCommitPrompt } from "./commit.js";
import { buildPrPrompt, splitPrMessage } from "./pr.js";
import { buildPrompterPrompt, buildBlueprintPrompterPrompt, buildChatSystem, type PromptBuilderInputs } from "./promptBuilder.js";
import { parseChatReply, buildManifest, type ChatGraph, type BlueprintOp } from "./chatOps.js";
import { availableEngines, targetToolNames, pickChatEngine, type BuilderEngine } from "./engines.js";
import { detectBuiltins, type DetectedAgent } from "../agents/registry.js";

/** What the Prompt Builder modal needs to populate its dropdowns. */
export interface BuilderInfo {
  engines: BuilderEngine[]; // build-with options: usable providers + detected CLIs
  targetTools: string[]; // target-tool options the user actually has
  defaultEngineId: string | null;
  defaultChatEngineId: string | null; // the canvas chat box's default pick (codex-first priority)
}

/** Live blueprint context the canvas chat box passes along so replies stay grounded. */
export interface ChatContext {
  spec?: string; // the serialized current plan
  targetTool?: string; // the coding agent the blueprint is for
  engineId?: string; // an explicit engine override; else the codex-first default
  graph?: ChatGraph; // the live node graph, so the model can target cards by id (manifest)
  selected?: string[]; // ids of the cards the user currently has selected ("this" / "here")
}

export interface AiController {
  getConfig(): AiConfig;
  listProviders(): AiProviderPublic[]; // secrets stripped
  saveConfig(c: AiConfig): void;
  /**
   * Fetch the model ids a provider exposes, for the settings "refresh models" dropdown. The browser
   * never holds a stored key, so the key is resolved server-side: an inline `apiKey` (a key the user
   * just typed but hasn't saved) wins, else the stored key for `id`, else the named env var. For a CLI
   * provider (which can't self-list), the list comes from the CLI's backing HTTP API (Anthropic /
   * OpenAI / Google) using any available key — the CLI provider's own key, the backing env var, or a
   * matching configured API provider's key. Throws AiError (so the UI can fall back to manual entry)
   * when the CLI has no model API or no key is available.
   */
  listModels(req: { id?: string; kind: AiProviderKind; label?: string; baseUrl?: string; apiKey?: string; apiKeyEnv?: string; command?: string[] }): Promise<string[]>;
  /** Installed coding-agent CLIs we can drive one-shot, as add-ready provider templates (id, label,
   *  argv). Drives the settings "Add:" row so only CLIs actually on $PATH are offered. */
  detectedClis(): { id: string; label: string; command: string[] }[];
  generateCommitMessage(cwd: string): Promise<string>;
  /**
   * Generate the message for a brand-new repo's FIRST commit. There's nothing staged yet, so it
   * summarizes the project from its top-level untracked files/folders (cheap — no `git add -A`),
   * via the same provider + editable commit prompt. Throws AiError when no provider is configured
   * or the folder is empty.
   */
  generateInitialCommitMessage(cwd: string): Promise<string>;
  /**
   * Generate a PR title + body for the current branch over `base` (the repo default branch when
   * omitted), from its commits + changed files via the editable PR prompt. Returns the split
   * title/body. Throws AiError when no provider is configured, no base can be resolved, or the
   * branch has no commits over the base.
   */
  generatePrDescription(cwd: string, base?: string): Promise<{ title: string; body: string }>;
  /**
   * One-shot completion for an arbitrary prompt (e.g. transcript summarization). Uses the given
   * providerId if supplied and enabled, else the configured default/first enabled provider.
   * Throws AiError("no AI provider configured") when none is available.
   */
  generate(prompt: string, providerId?: string): Promise<string>;
  /** Engines + target tools for the Prompt Builder, reflecting only what the user actually has. */
  builderInfo(): BuilderInfo;
  /**
   * Build a production-ready prompt from the wizard inputs via the chosen/default engine (a
   * configured provider or a detected CLI). Allows more output tokens since prompts can be long.
   */
  buildPrompt(inputs: PromptBuilderInputs, engineId?: string): Promise<string>;
  /**
   * Polish a serialized program blueprint (the node-canvas map) into a single implementation
   * prompt for the given target tool, via the chosen/default engine. Larger token cap than a
   * quick prompt since implementation prompts run long.
   */
  buildBlueprintPrompt(spec: string, targetTool: string, engineId?: string): Promise<string>;
  /**
   * Multi-turn chat for the floating canvas assistant. Resolves the engine with the chat box's
   * codex-first priority (an explicit ctx.engineId overrides), grounds it in the live blueprint
   * (plan + node manifest + selection), and returns the assistant's reply plus any canvas ops it
   * asked for (parsed from the model's JSON envelope). Throws AiError when no engine is usable.
   */
  chat(messages: ChatMessage[], ctx?: ChatContext): Promise<{ reply: string; ops: BlueprintOp[] }>;
}

/** `detect` is injectable so tests don't probe the real $PATH. */
export function createAiController(store: Store, git: GitController, detect: () => DetectedAgent[] = detectBuiltins): AiController {
  // The active provider: the chosen default if it's enabled, else the first enabled one.
  const pick = (cfg: AiConfig): AiProvider | undefined => {
    const enabled = cfg.providers.filter(p => p.enabled);
    return enabled.find(p => p.id === cfg.defaultProviderId) ?? enabled[0];
  };
  // Resolve the provider to use: an explicit enabled providerId wins, else the default pick.
  const resolve = (cfg: AiConfig, providerId?: string): AiProvider | undefined => {
    const explicit = providerId ? cfg.providers.find(p => p.enabled && p.id === providerId) : undefined;
    return explicit ?? pick(cfg);
  };
  // Resolve a build engine (configured provider OR detected CLI) for the Prompt Builder: the
  // explicit engineId wins, else the configured default, else the first available. Shared by the
  // quick-prompt and blueprint paths. Throws AiError when the user has no usable engine at all.
  const resolveEngine = (engineId?: string) => {
    const cfg = store.getAiConfig();
    const entries = availableEngines(cfg, detect());
    const entry =
      (engineId ? entries.find(e => e.id === engineId) : undefined) ??
      entries.find(e => e.id === cfg.defaultProviderId) ??
      entries[0];
    if (!entry) throw new AiError("no AI engine available — add a provider in settings, or install a CLI like claude/codex");
    return entry;
  };
  // The chat box's engine: an explicit engineId wins, else the codex-first priority pick. Distinct
  // from resolveEngine (which honours the configured default) so chat always defaults to codex.
  const resolveChatEngine = (engineId?: string) => {
    const cfg = store.getAiConfig();
    const entries = availableEngines(cfg, detect());
    const entry = (engineId ? entries.find(e => e.id === engineId) : undefined) ?? pickChatEngine(entries);
    if (!entry) throw new AiError("no AI engine — install codex, or add an API key (DeepSeek, Kimi, Anthropic, OpenAI) in settings");
    return entry;
  };
  // A configured API provider whose kind + base URL matches a CLI's backing API — its key lets us list
  // that CLI's real models without the user re-entering it (e.g. a Codex CLI reuses an OpenAI key).
  const matchingApiKey = (cfg: AiConfig, backing: { kind: string; baseUrl: string }): string | undefined => {
    const norm = (u?: string) => (u ?? "").replace(/\/+$/, "");
    const hit = cfg.providers.find(p => p.kind === backing.kind && norm(p.baseUrl) === norm(backing.baseUrl));
    return hit ? resolveKey(hit) : undefined;
  };

  return {
    getConfig: () => store.getAiConfig(),

    listProviders() {
      return store.getAiConfig().providers.map(({ apiKey, ...rest }): AiProviderPublic => ({
        ...rest,
        apiKeySet: Boolean(apiKey),
        apiKeyFromEnv: Boolean(!apiKey && rest.apiKeyEnv && process.env[rest.apiKeyEnv]),
      }));
    },

    saveConfig(c) {
      // The browser never receives stored keys, so a saved provider with apiKey omitted
      // means "keep the existing secret" — never wipe a key just because other fields changed.
      // Likewise an omitted commitPrompt (undefined) means "keep the existing one"; null/""
      // clears it back to the built-in default.
      const prev = store.getAiConfig();
      store.setAiConfig({
        defaultProviderId: c.defaultProviderId,
        commitPrompt: c.commitPrompt !== undefined ? c.commitPrompt : prev.commitPrompt,
        prPrompt: c.prPrompt !== undefined ? c.prPrompt : prev.prPrompt,
        providers: c.providers.map(p => {
          if (p.apiKey != null) return p; // explicit new key (may be "" to clear)
          const old = prev.providers.find(o => o.id === p.id);
          return old?.apiKey ? { ...p, apiKey: old.apiKey } : p;
        }),
      });
    },

    async generateCommitMessage(cwd) {
      const cfg = store.getAiConfig();
      const provider = pick(cfg);
      if (!provider) throw new AiError("no AI provider configured — add one in settings");
      const diff = await git.stagedDiff(cwd);
      if (!diff.trim()) throw new AiError("nothing staged to summarize");
      const names = await git.stagedNameStatus(cwd);
      return complete(provider, buildCommitPrompt(diff, names, cfg.commitPrompt));
    },

    async generateInitialCommitMessage(cwd) {
      const cfg = store.getAiConfig();
      const provider = pick(cfg);
      if (!provider) throw new AiError("no AI provider configured — add one in settings");
      const entries = await git.listUntracked(cwd);
      if (!entries.length) throw new AiError("nothing to summarize — the folder is empty");
      return complete(provider, buildInitialCommitPrompt(entries, cfg.commitPrompt));
    },

    async generatePrDescription(cwd, base) {
      const cfg = store.getAiConfig();
      const provider = pick(cfg);
      if (!provider) throw new AiError("no AI provider configured — add one in settings");
      const target = base?.trim() || (await git.defaultBranch(cwd));
      if (!target) throw new AiError("couldn't determine a base branch — pick one in the dialog");
      const { commits, files } = await git.prContext(cwd, target);
      if (!commits.trim()) throw new AiError(`no commits on this branch over ${target}`);
      return splitPrMessage(await complete(provider, buildPrPrompt(commits, files, cfg.prPrompt), 1000));
    },

    async listModels(req) {
      const cfg = store.getAiConfig();
      const stored = req.id ? cfg.providers.find(p => p.id === req.id) : undefined;

      if (req.kind === "cli") {
        const bin = (req.command ?? stored?.command ?? [])[0];
        const spec = bin ? CLI_SPECS[bin] : undefined;
        if (!spec?.backing) throw new AiError(`${req.label ?? bin ?? "CLI"}: this CLI can't list models — type the model id manually`);
        // A CLI can't self-list, so we hit its backing HTTP API. Find a key: an inline (just-typed)
        // key, a key stored on this CLI provider, the request's env var, the backing default env var,
        // or a matching configured API provider's key. None → tell the user to add one or type it.
        const key =
          req.apiKey ||
          stored?.apiKey ||
          (req.apiKeyEnv ? process.env[req.apiKeyEnv] : undefined) ||
          process.env[spec.backing.apiKeyEnv] ||
          matchingApiKey(cfg, spec.backing);
        if (!key) throw new AiError(`${req.label ?? bin}: no key to list ${bin} models — add an API key (or set $${spec.backing.apiKeyEnv}), or type the model id`);
        return fetchModels({ id: "probe", kind: spec.backing.kind, label: req.label ?? bin, enabled: true, baseUrl: spec.backing.baseUrl, apiKey: key });
      }

      return fetchModels({
        id: req.id ?? "probe",
        kind: req.kind,
        label: req.label ?? stored?.label ?? "provider",
        enabled: true,
        baseUrl: req.baseUrl ?? stored?.baseUrl,
        apiKey: req.apiKey || stored?.apiKey, // inline (just-typed) key wins over the stored one
        apiKeyEnv: req.apiKeyEnv ?? stored?.apiKeyEnv,
      });
    },

    detectedClis() {
      return detect()
        .filter(a => a.installed && CLI_ONESHOT[a.id])
        .map(a => ({ id: a.id, label: `${a.name} (CLI)`, command: CLI_ONESHOT[a.id] }));
    },

    async generate(prompt, providerId) {
      const provider = resolve(store.getAiConfig(), providerId);
      if (!provider) throw new AiError("no AI provider configured");
      return complete(provider, prompt);
    },

    builderInfo() {
      const cfg = store.getAiConfig();
      const detected = detect();
      const entries = availableEngines(cfg, detected);
      const defaultEngineId =
        (entries.find(e => e.id === cfg.defaultProviderId) ?? entries[0])?.id ?? null;
      return {
        engines: entries.map(({ id, label, tool }) => ({ id, label, tool })),
        targetTools: targetToolNames(entries, detected),
        defaultEngineId,
        defaultChatEngineId: pickChatEngine(entries)?.id ?? null,
      };
    },

    async buildPrompt(inputs, engineId) {
      return complete(resolveEngine(engineId).provider, buildPrompterPrompt(inputs), 1500);
    },

    async buildBlueprintPrompt(spec, targetTool, engineId) {
      return complete(resolveEngine(engineId).provider, buildBlueprintPrompterPrompt(spec, targetTool), 2000);
    },

    async chat(messages, ctx = {}) {
      const entry = resolveChatEngine(ctx.engineId);
      const manifest = ctx.graph ? buildManifest(ctx.graph, ctx.selected) : undefined;
      const raw = await chat(entry.provider, messages, buildChatSystem({ spec: ctx.spec, targetTool: ctx.targetTool, manifest }));
      return parseChatReply(raw);
    },
  };
}
