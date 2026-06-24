import { spawn } from "node:child_process";
import type { AiProvider } from "./types.js";
import { cliArgv } from "./cli.js";

/** Thrown for any generation failure (missing key/model/command, non-zero CLI, HTTP error, timeout). */
export class AiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiError";
  }
}

/**
 * Hard ceiling on a single generation. Past this a CLI child is hung (stuck waiting on input, a
 * wedged model) or an HTTP socket is dead — we abort and surface a real error instead of letting
 * the UI spin forever (the bug that left "generate commit message" spinning for 10+ minutes).
 * Generous enough that a legit commit message or chat turn never trips it.
 */
export const COMPLETION_TIMEOUT_MS = 120_000;

/** Usable API key: a stored key wins, else the provider's named env var (Zed's precedence). */
export function resolveKey(p: AiProvider): string | undefined {
  return p.apiKey || (p.apiKeyEnv ? process.env[p.apiKeyEnv] : undefined) || undefined;
}

/**
 * Pipe `input` to a local CLI (e.g. `claude -p`) on stdin and resolve its stdout. Rejects with an
 * AiError on spawn failure, a non-zero exit, or `timeoutMs` elapsing — the timer SIGKILLs the child
 * so a wedged CLI can't hold the request open forever. Shared by the one-shot and chat paths.
 */
export function runCli(label: string, argv: string[], input: string, timeoutMs = COMPLETION_TIMEOUT_MS): Promise<string> {
  if (!argv.length) return Promise.reject(new AiError(`${label}: no command configured`));
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "", settled = false;
    const settle = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(timer); fn(); };
    const timer = setTimeout(() => settle(() => {
      child.kill("SIGKILL"); // a hung child won't emit 'close' on its own; force it
      reject(new AiError(`${label}: timed out after ${Math.round(timeoutMs / 1000)}s`));
    }), timeoutMs);
    child.stdout.on("data", d => (out += d));
    child.stderr.on("data", d => (err += d));
    child.on("error", (e: NodeJS.ErrnoException) =>
      settle(() => reject(new AiError(e.code === "ENOENT" ? `${argv[0]}: command not found` : e.message))));
    child.on("close", code =>
      settle(() => (code === 0 ? resolve(out.trim()) : reject(new AiError(err.trim() || `${argv[0]} exited ${code}`)))));
    child.stdin.end(input);
  });
}

/**
 * fetch() with a hard deadline: aborts after `timeoutMs` and converts the abort (or any network
 * failure) into a clean AiError, so a stalled socket surfaces as "timed out" instead of hanging.
 */
export async function aiFetch(label: string, url: string, init: RequestInit, timeoutMs = COMPLETION_TIMEOUT_MS): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError")
      throw new AiError(`${label}: timed out after ${Math.round(timeoutMs / 1000)}s`);
    throw new AiError(`${label}: ${e?.message ?? "request failed"}`);
  }
}

/**
 * One-shot completion. Dispatches by provider kind; returns the model's text. `maxTokens` caps
 * the HTTP-API responses (the CLI kind manages its own length) — defaults to 500 for short jobs
 * like commit messages; callers wanting longer output (e.g. prompt building) pass more. Every path
 * is bounded by `timeoutMs` so a hung CLI or dead socket fails loudly instead of spinning forever.
 */
export function complete(p: AiProvider, prompt: string, maxTokens = 500, timeoutMs = COMPLETION_TIMEOUT_MS): Promise<string> {
  if (p.kind === "cli") {
    const { argv, stdin } = cliArgv(p.command ?? [], p.model, prompt);
    return runCli(p.label, argv, stdin, timeoutMs);
  }
  if (p.kind === "anthropic") return anthropicComplete(p, prompt, maxTokens, timeoutMs);
  return openaiComplete(p, prompt, maxTokens, timeoutMs); // openai-compatible: OpenAI, OpenRouter, local servers, …
}

/**
 * List the model ids a provider exposes so the settings UI can offer a real dropdown instead of
 * making the user type an id. OpenAI-compatible providers answer `GET <base>/models` (Bearer key);
 * Anthropic answers `GET <base>/v1/models` (x-api-key). CLI kinds have no list (they pick their own
 * model) → []. Throws AiError on a missing key or an HTTP failure. Shorter deadline than a
 * completion — it's a quick metadata call the UI waits on interactively.
 */
export async function listModels(p: AiProvider, timeoutMs = 30_000): Promise<string[]> {
  if (p.kind === "cli") return [];
  const key = resolveKey(p);
  if (!key) throw new AiError(`${p.label}: no API key set`);
  const isAnthropic = p.kind === "anthropic";
  const base = (p.baseUrl || (isAnthropic ? "https://api.anthropic.com" : "https://api.openai.com/v1")).replace(/\/+$/, "");
  const url = isAnthropic ? `${base}/v1/models` : `${base}/models`;
  const headers: Record<string, string> = isAnthropic
    ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
    : { authorization: `Bearer ${key}` };
  const res = await aiFetch(p.label, url, { method: "GET", headers }, timeoutMs);
  if (!res.ok) throw new AiError(`${p.label}: ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const j = await res.json() as { data?: { id?: string }[] };
  const ids = (j?.data ?? []).map(m => m?.id).filter((id): id is string => !!id);
  return [...new Set(ids)].sort();
}

/** OpenAI-compatible chat completion (also covers OpenRouter and local OpenAI servers). */
async function openaiComplete(p: AiProvider, prompt: string, maxTokens: number, timeoutMs: number): Promise<string> {
  const key = resolveKey(p);
  if (!key) throw new AiError(`${p.label}: no API key set`);
  if (!p.model) throw new AiError(`${p.label}: no model set`);
  const base = (p.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const res = await aiFetch(p.label, `${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: p.model, messages: [{ role: "user", content: prompt }], temperature: 0.2, max_tokens: maxTokens }),
  }, timeoutMs);
  if (!res.ok) throw new AiError(`${p.label}: ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const j = await res.json() as { choices?: { message?: { content?: string } }[] };
  const text = j?.choices?.[0]?.message?.content;
  if (!text) throw new AiError(`${p.label}: empty response`);
  return text.trim();
}

/** Anthropic Messages API. */
async function anthropicComplete(p: AiProvider, prompt: string, maxTokens: number, timeoutMs: number): Promise<string> {
  const key = resolveKey(p);
  if (!key) throw new AiError(`${p.label}: no API key set`);
  if (!p.model) throw new AiError(`${p.label}: no model set`);
  const base = (p.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
  const res = await aiFetch(p.label, `${base}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: p.model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
  }, timeoutMs);
  if (!res.ok) throw new AiError(`${p.label}: ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const j = await res.json() as { content?: { text?: string }[] };
  const text = j?.content?.[0]?.text;
  if (!text) throw new AiError(`${p.label}: empty response`);
  return text.trim();
}
