import type { AiProvider } from "./types.js";
import { AiError, resolveKey, runCli, aiFetch, COMPLETION_TIMEOUT_MS } from "./complete.js";

/** One turn of a conversation. Only user/assistant turns travel; the system instruction is
 *  carried separately so each provider kind can place it where it belongs. */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Multi-turn chat completion — the conversational sibling of complete(). Dispatches by provider
 * kind and returns the assistant's reply text. `maxTokens` caps the HTTP-API responses (the CLI
 * kind manages its own length); chat replies run longer than commit messages, hence the default.
 */
export function chat(p: AiProvider, messages: ChatMessage[], system: string, maxTokens = 1200, timeoutMs = COMPLETION_TIMEOUT_MS): Promise<string> {
  if (p.kind === "cli") return cliChat(p, messages, system, timeoutMs);
  if (p.kind === "anthropic") return anthropicChat(p, messages, system, maxTokens, timeoutMs);
  return openaiChat(p, messages, system, maxTokens, timeoutMs); // openai-compatible: OpenAI, DeepSeek, Kimi, OpenRouter, …
}

/** Stateless one-shot CLIs (codex exec, claude -p) have no conversation memory, so the whole
 *  transcript is serialized into a single prompt and piped to stdin each turn. */
function cliChat(p: AiProvider, messages: ChatMessage[], system: string, timeoutMs: number): Promise<string> {
  const transcript = [
    system.trim(),
    "",
    ...messages.map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`),
    "Assistant:",
  ].join("\n");
  return runCli(p.label, p.command ?? [], transcript, timeoutMs);
}

/** OpenAI-compatible chat completion (also covers DeepSeek, Kimi/Moonshot, OpenRouter, local servers). */
async function openaiChat(p: AiProvider, messages: ChatMessage[], system: string, maxTokens: number, timeoutMs: number): Promise<string> {
  const key = resolveKey(p);
  if (!key) throw new AiError(`${p.label}: no API key set`);
  if (!p.model) throw new AiError(`${p.label}: no model set`);
  const base = (p.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const res = await aiFetch(p.label, `${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: p.model,
      messages: [{ role: "system", content: system }, ...messages],
      temperature: 0.3,
      max_tokens: maxTokens,
    }),
  }, timeoutMs);
  if (!res.ok) throw new AiError(`${p.label}: ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const j = await res.json() as { choices?: { message?: { content?: string } }[] };
  const text = j?.choices?.[0]?.message?.content;
  if (!text) throw new AiError(`${p.label}: empty response`);
  return text.trim();
}

/** Anthropic Messages API — the system instruction is a top-level field, not a message. */
async function anthropicChat(p: AiProvider, messages: ChatMessage[], system: string, maxTokens: number, timeoutMs: number): Promise<string> {
  const key = resolveKey(p);
  if (!key) throw new AiError(`${p.label}: no API key set`);
  if (!p.model) throw new AiError(`${p.label}: no model set`);
  const base = (p.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
  const res = await aiFetch(p.label, `${base}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: p.model, max_tokens: maxTokens, system, messages }),
  }, timeoutMs);
  if (!res.ok) throw new AiError(`${p.label}: ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const j = await res.json() as { content?: { text?: string }[] };
  const text = j?.content?.[0]?.text;
  if (!text) throw new AiError(`${p.label}: empty response`);
  return text.trim();
}
