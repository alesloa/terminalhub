import type { AiProvider } from "../ai/types.js";
import { resolveKey, aiFetch, AiError, complete } from "../ai/complete.js";
import { buildCliPrompt, parseCliEnvelope } from "./cliProtocol.js";
import type {
  ToolDef, CopilotMessage, ContentBlock, AssistantTurn, ProviderToolCall, CopilotProvider, ChatStreamRequest,
} from "./types.js";

// Generous per-turn output cap. Anthropic requires max_tokens; OpenAI treats it as optional.
const MAX_TOKENS = 2048;

const safeParse = (s: string): unknown => { try { return JSON.parse(s); } catch { return {}; } };

// ── Tool-shape converters ────────────────────────────────────────────────────
export const toAnthropicTools = (tools: ToolDef[]) =>
  tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));

export const toOpenAITools = (tools: ToolDef[]) =>
  tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));

// Canonical (Anthropic-block) history → OpenAI's flat message list. Tool results become `role:'tool'`
// messages; an assistant turn's tool_use blocks become `tool_calls`. Text-less assistant turns send
// content:null (what OpenAI expects alongside tool_calls).
export function toOpenAIMessages(system: string, messages: CopilotMessage[]): unknown[] {
  const out: unknown[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") {
      for (const b of m.content) {
        if (b.type === "tool_result") out.push({ role: "tool", tool_call_id: b.tool_use_id, content: b.content });
      }
      const text = m.content.filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text").map((b) => b.text).join("");
      if (text) out.push({ role: "user", content: text });
    } else {
      const text = m.content.filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text").map((b) => b.text).join("");
      const toolUses = m.content.filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use");
      const msg: Record<string, unknown> = { role: "assistant", content: text || null };
      if (toolUses.length) {
        msg.tool_calls = toolUses.map((tu) => ({ id: tu.id, type: "function", function: { name: tu.name, arguments: JSON.stringify(tu.input) } }));
      }
      out.push(msg);
    }
  }
  return out;
}

// ── Stream accumulators ──────────────────────────────────────────────────────
// Anthropic Messages streaming: content blocks arrive by index; text via `text_delta`, tool input
// via `input_json_delta` chunks that concatenate into a JSON string parsed at the end.
type AnthroBlock = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; json: string };
export function createAnthropicAccumulator(onToken: (delta: string) => void) {
  const blocks = new Map<number, AnthroBlock>();
  return {
    event(type: string, data: any) {
      if (type === "content_block_start") {
        const cb = data.content_block ?? {};
        blocks.set(data.index, cb.type === "tool_use"
          ? { type: "tool_use", id: cb.id, name: cb.name, json: "" }
          : { type: "text", text: "" });
      } else if (type === "content_block_delta") {
        const b = blocks.get(data.index);
        if (!b) return;
        const d = data.delta ?? {};
        if (d.type === "text_delta" && b.type === "text") { b.text += d.text; onToken(d.text); }
        else if (d.type === "input_json_delta" && b.type === "tool_use") { b.json += d.partial_json ?? ""; }
      }
    },
    turn(): AssistantTurn { return finalize([...blocks.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1])); },
  };
}

// OpenAI streaming: deltas carry `content` (text) and/or `tool_calls` indexed across chunks; a call's
// `arguments` string concatenates over chunks.
export function createOpenAIAccumulator(onToken: (delta: string) => void) {
  let text = "";
  const calls = new Map<number, { id: string; name: string; args: string }>();
  return {
    chunk(delta: any) {
      if (typeof delta?.content === "string" && delta.content) { text += delta.content; onToken(delta.content); }
      for (const tc of delta?.tool_calls ?? []) {
        const c = calls.get(tc.index) ?? { id: "", name: "", args: "" };
        if (tc.id) c.id = tc.id;
        if (tc.function?.name) c.name = tc.function.name;
        if (tc.function?.arguments) c.args += tc.function.arguments;
        calls.set(tc.index, c);
      }
    },
    turn(): AssistantTurn {
      const blocks: AnthroBlock[] = [];
      if (text) blocks.push({ type: "text", text });
      for (const [, c] of [...calls.entries()].sort((a, b) => a[0] - b[0])) blocks.push({ type: "tool_use", id: c.id, name: c.name, json: c.args });
      return finalize(blocks);
    },
  };
}

function finalize(blocks: AnthroBlock[]): AssistantTurn {
  const content: ContentBlock[] = [];
  const toolCalls: ProviderToolCall[] = [];
  let text = "";
  for (const b of blocks) {
    if (b.type === "text") { content.push({ type: "text", text: b.text }); text += b.text; }
    else {
      const input = b.json ? safeParse(b.json) : {};
      content.push({ type: "tool_use", id: b.id, name: b.name, input });
      toolCalls.push({ id: b.id, name: b.name, input });
    }
  }
  return { text, toolCalls, message: { role: "assistant", content } };
}

// ── SSE plumbing ─────────────────────────────────────────────────────────────
// Yield each parsed `data:` JSON object from an SSE response. Anthropic and OpenAI both use the
// `data: {json}` line form (Anthropic's also has `event:` lines, but its JSON carries `type`, so we
// ignore the event line and key off the payload). `[DONE]` (OpenAI) ends the stream.
async function* sseData(res: Response): AsyncGenerator<any> {
  if (!res.body) return;
  const reader = (res.body as any).getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return;
      try { yield JSON.parse(payload); } catch { /* keepalive / partial line */ }
    }
  }
}

async function checkOk(p: AiProvider, res: Response) {
  if (!res.ok) throw new AiError(`${p.label}: ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
}

// ── Provider ─────────────────────────────────────────────────────────────────
// Wrap an AiProvider as a tool-calling CopilotProvider. API engines (Anthropic / OpenAI-compatible)
// stream with native tool-use; CLI engines have no tool-use API, so they're driven over a JSON text
// protocol (see runCliEngine) — the agent loop treats both the same.
export function createProvider(p: AiProvider): CopilotProvider {
  return {
    async run(req, onToken) {
      if (p.kind === "anthropic") return runAnthropic(p, req, onToken);
      if (p.kind === "openai-compatible") return runOpenAI(p, req, onToken);
      if (p.kind === "cli") return runCliEngine(p, req, onToken);
      throw new AiError(`${p.label}: unsupported engine kind`);
    },
  };
}

// A CLI engine (claude -p, codex exec, …) one-shot per step: render the turn into a single prompt,
// run the CLI, and parse its { reply, tool_calls } envelope back into the SAME normalized turn an API
// engine produces — so the agent loop drives a CLI identically. No live streaming (the CLI is
// one-shot), so the reply is emitted once. Tool calls get synthesized ids (CLIs don't supply them).
async function runCliEngine(p: AiProvider, req: ChatStreamRequest, onToken: (delta: string) => void): Promise<AssistantTurn> {
  const prompt = buildCliPrompt(req.system, req.messages, req.tools);
  const raw = await complete(p, prompt, MAX_TOKENS);
  const { reply, toolCalls } = parseCliEnvelope(raw);
  if (reply) onToken(reply);
  const blocks: AnthroBlock[] = [];
  if (reply) blocks.push({ type: "text", text: reply });
  toolCalls.forEach((c, i) => blocks.push({ type: "tool_use", id: `call_${i}_${c.name}`, name: c.name, json: JSON.stringify(c.input ?? {}) }));
  return finalize(blocks);
}

async function runAnthropic(p: AiProvider, req: ChatStreamRequest, onToken: (d: string) => void): Promise<AssistantTurn> {
  const key = resolveKey(p);
  if (!key) throw new AiError(`${p.label}: no API key set`);
  if (!p.model) throw new AiError(`${p.label}: no model set`);
  const base = (p.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
  const body: Record<string, unknown> = { model: p.model, max_tokens: MAX_TOKENS, system: req.system, messages: req.messages, stream: true };
  if (req.tools.length) body.tools = toAnthropicTools(req.tools);
  const res = await aiFetch(p.label, `${base}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  await checkOk(p, res);
  const acc = createAnthropicAccumulator(onToken);
  for await (const data of sseData(res)) if (data?.type) acc.event(data.type, data);
  return acc.turn();
}

async function runOpenAI(p: AiProvider, req: ChatStreamRequest, onToken: (d: string) => void): Promise<AssistantTurn> {
  const key = resolveKey(p);
  if (!key) throw new AiError(`${p.label}: no API key set`);
  if (!p.model) throw new AiError(`${p.label}: no model set`);
  const base = (p.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const body: Record<string, unknown> = { model: p.model, messages: toOpenAIMessages(req.system, req.messages), stream: true, temperature: 0.2 };
  if (req.tools.length) { body.tools = toOpenAITools(req.tools); body.tool_choice = "auto"; }
  const res = await aiFetch(p.label, `${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  await checkOk(p, res);
  const acc = createOpenAIAccumulator(onToken);
  for await (const data of sseData(res)) { const delta = data?.choices?.[0]?.delta; if (delta) acc.chunk(delta); }
  return acc.turn();
}
