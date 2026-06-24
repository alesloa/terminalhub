// AI provider config for one-shot text generation (commit messages, …). Modeled on
// Zed's language-model provider settings: each provider is either a local CLI we shell
// to, or an HTTP API (OpenAI-compatible or Anthropic). Mirrored by hand in
// web/src/api/types.ts — keep in sync (no shared package, see CLAUDE.md).

export type AiProviderKind = "cli" | "openai-compatible" | "anthropic";

export interface AiProvider {
  id: string;
  kind: AiProviderKind;
  label: string; // shown in the UI, e.g. "Claude CLI", "OpenAI", "OpenRouter"
  enabled: boolean;
  model?: string; // model id (required for API kinds; CLI uses its own default)
  baseUrl?: string; // API endpoint base, e.g. https://openrouter.ai/api/v1
  apiKey?: string; // stored secret — NEVER returned to the browser (see AiProviderPublic)
  apiKeyEnv?: string; // env var checked when no key is stored, e.g. OPENAI_API_KEY
  command?: string[]; // argv for the "cli" kind; the prompt is piped to the process stdin
}

export interface AiConfig {
  providers: AiProvider[];
  defaultProviderId: string | null; // which provider generate uses; falls back to first enabled
  commitPrompt?: string; // custom instructions for commit-message generation; unset = built-in default
  prPrompt?: string; // custom instructions for PR-description generation; unset = built-in default
}

/** An AiProvider with the secret stripped — the shape the REST API hands the browser. */
export type AiProviderPublic = Omit<AiProvider, "apiKey"> & {
  apiKeySet: boolean; // a key is stored on the server
  apiKeyFromEnv: boolean; // no stored key, but the named env var is present
};
