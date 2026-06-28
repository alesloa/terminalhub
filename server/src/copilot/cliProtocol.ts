// A CLI engine (claude -p, codex exec, …) has no native tool-use API, so the Agent drives it over a
// text protocol — the same trick the blueprint canvas chat (ai/chatOps.ts) uses. We render the system
// prompt, a catalog of the callable tools, and the running transcript into ONE prompt, and ask the CLI
// to answer with a JSON envelope { reply, tool_calls }. We parse that tolerantly and hand the agent
// loop the same normalized turn an API engine would produce, so the loop drives a CLI identically —
// one CLI process per step (it's stateless across spawns, so each step re-sends the whole transcript).
//
// Pure functions, no I/O — trivial to test. The provider adapter (providerAdapter.ts) runs the CLI and
// feeds its raw output through parseCliEnvelope.

import type { ToolDef, CopilotMessage } from "./types.js";

/** One tool call the CLI asked for. Ids are synthesized by the caller (CLIs don't emit them). */
export interface CliToolCall { name: string; input: unknown; }
/** The parsed result of one CLI step: the user-facing text + any tool calls to run. */
export interface CliEnvelope { reply: string; toolCalls: CliToolCall[]; }

/** A compact, readable catalog of the tools the model may call: name, one-line description, and the
 *  JSON schema of the arguments. A CLI has no native tool-use, so this is how it learns what's
 *  callable — mirrors how the blueprint chat lists the node kinds it may emit. */
export function renderToolCatalog(tools: ToolDef[]): string {
  if (!tools.length) return "No tools are available this turn.";
  return tools
    .map((t) => `- ${t.name}: ${t.description}\n  args schema: ${JSON.stringify(t.input_schema ?? {})}`)
    .join("\n");
}

/** Flatten the canonical content-block transcript into plain text the CLI reads fresh each step (it's
 *  stateless across spawns). User/assistant text passes through; an assistant's tool_use blocks and
 *  the following tool_result blocks become labelled lines so the model sees what it already did. */
export function renderTranscript(messages: CopilotMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    for (const b of m.content) {
      if (b.type === "text") {
        if (b.text.trim()) lines.push(`${m.role === "user" ? "User" : "Assistant"}: ${b.text.trim()}`);
      } else if (b.type === "tool_use") {
        lines.push(`Assistant called tool ${b.name}(${JSON.stringify(b.input)})`);
      } else if (b.type === "tool_result") {
        lines.push(`Tool result: ${b.content}`);
      }
    }
  }
  return lines.join("\n");
}

const PROTOCOL = [
  "Reply with a SINGLE JSON object and NOTHING else:",
  '{ "reply": "<message to show the user>", "tool_calls": [ { "name": "<tool>", "input": { ... } } ] }',
  "Rules:",
  '- To use tools, list them in "tool_calls" in the order to run them; set "reply" to a short note or "".',
  '- When you are finished and need no tools, put your answer in "reply" and set "tool_calls": [].',
  '- Each "input" must match that tool\'s args schema. Use ONLY the tools listed above.',
  "- Output the JSON object only — no prose, no code fences, no text around it.",
].join("\n");

/** Build the one prompt delivered to the CLI for a single step of the agent loop. */
export function buildCliPrompt(system: string, messages: CopilotMessage[], tools: ToolDef[]): string {
  return [
    system,
    "",
    "## Available tools",
    renderToolCatalog(tools),
    "",
    "## Conversation so far",
    renderTranscript(messages) || "(no messages yet)",
    "",
    "## How to respond",
    PROTOCOL,
  ].join("\n");
}

/** Pull { reply, tool_calls } out of the CLI's raw output. Tolerant by design (models wrap JSON in
 *  prose or code fences): extract a fenced ```json block or the first balanced {…}, validate each
 *  tool call (must have a string name; input defaults to {}), and — when there is no usable envelope
 *  — return the whole text as the reply with no tool calls, so plain conversational replies work. */
export function parseCliEnvelope(raw: string): CliEnvelope {
  const text = (raw ?? "").trim();
  const json = extractJson(text);
  if (json) {
    try {
      const parsed = JSON.parse(json) as Record<string, unknown>;
      if (parsed && typeof parsed === "object" && ("reply" in parsed || "tool_calls" in parsed)) {
        const reply = typeof parsed.reply === "string" ? parsed.reply : "";
        const rawCalls = Array.isArray(parsed.tool_calls) ? parsed.tool_calls : [];
        const toolCalls: CliToolCall[] = [];
        for (const c of rawCalls) {
          if (c && typeof c === "object" && typeof (c as any).name === "string" && (c as any).name) {
            const input = "input" in (c as any) && (c as any).input != null ? (c as any).input : {};
            toolCalls.push({ name: (c as any).name, input });
          }
        }
        return { reply, toolCalls };
      }
    } catch {
      // fall through to the plain-text fallback
    }
  }
  return { reply: text, toolCalls: [] };
}

/** Find a JSON object in model output: prefer a fenced ```json block, else the first balanced {…}
 *  (brace-counting, string-aware so braces inside strings don't end it early). Mirrors ai/chatOps.ts. */
function extractJson(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1].trim() : text;
  const start = body.indexOf("{");
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return body.slice(start, i + 1);
  }
  return null;
}
