import type {
  CopilotProvider, ToolRegistry, CopilotCtx, CopilotMessage, ContentBlock, ProviderToolCall, ToolResult,
} from "./types.js";

// Events streamed out of one copilot turn. The WS gateway maps these to frames; tests drain them.
export type CopilotEvent =
  | { type: "token"; delta: string }
  | { type: "tool_call"; callId: string; name: string; args: unknown }
  | { type: "tool_result"; callId: string; ok: boolean; summary: string }
  | { type: "confirm_request"; callId: string; name: string; args: unknown }
  | { type: "assistant_message"; message: CopilotMessage }
  | { type: "final"; text: string; messages: CopilotMessage[] }
  | { type: "error"; message: string };

export interface RunTurnOpts {
  provider: CopilotProvider;
  registry: ToolRegistry;
  system: string;
  history: CopilotMessage[];
  userText: string;
  cctx: CopilotCtx;
  enabledSkillIds: string[];
  // Resolve a dangerous-tool confirmation (the WS gateway awaits a 'confirm' frame). Absent = deny.
  confirm?: (call: ProviderToolCall) => Promise<boolean>;
  maxHops?: number;
}

const DEFAULT_MAX_HOPS = 12;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const toolResultBlock = (id: string, r: ToolResult): ContentBlock => ({ type: "tool_result", tool_use_id: id, content: JSON.stringify({ ok: r.ok, summary: r.summary, data: r.data }) });

// The tool-use loop. Calls the model; if it returns tool calls, runs them (confirm-gating dangerous
// ones, skipping them entirely for the scheduler), feeds every result back as one user message, and
// loops until the model gives a final text answer or MAX_HOPS trips. Streamed as events via an
// internal channel so token deltas (delivered through provider.run's callback) interleave with tool
// events in order.
export async function* runCopilotTurn(opts: RunTurnOpts): AsyncGenerator<CopilotEvent> {
  const ch = createChannel<CopilotEvent>();
  const drive = (async () => {
    try {
      const tools = opts.registry.collect(opts.enabledSkillIds);
      const maxHops = opts.maxHops ?? DEFAULT_MAX_HOPS;
      const messages: CopilotMessage[] = [...opts.history, { role: "user", content: [{ type: "text", text: opts.userText }] }];

      for (let hop = 0; hop < maxHops; hop++) {
        const turn = await opts.provider.run({ system: opts.system, messages, tools }, (d) => ch.push({ type: "token", delta: d }));
        messages.push(turn.message);
        ch.push({ type: "assistant_message", message: turn.message });

        if (turn.toolCalls.length === 0) { ch.push({ type: "final", text: turn.text, messages }); return; }

        const resultBlocks: ContentBlock[] = [];
        for (const call of turn.toolCalls) {
          const def = opts.registry.get(call.name);
          const dangerous = !!def?.dangerous;

          if (dangerous && opts.cctx.actor === "scheduler") {
            const r: ToolResult = { ok: false, summary: "Skipped: dangerous tools aren't run on scheduled jobs." };
            ch.push({ type: "tool_result", callId: call.id, ok: r.ok, summary: r.summary });
            resultBlocks.push(toolResultBlock(call.id, r));
            continue;
          }
          if (dangerous && opts.cctx.settings.confirmDangerous) {
            ch.push({ type: "confirm_request", callId: call.id, name: call.name, args: call.input });
            const approved = opts.confirm ? await opts.confirm(call) : false;
            if (!approved) {
              const r: ToolResult = { ok: false, summary: "User declined." };
              ch.push({ type: "tool_result", callId: call.id, ok: r.ok, summary: r.summary });
              resultBlocks.push(toolResultBlock(call.id, r));
              continue;
            }
          }

          ch.push({ type: "tool_call", callId: call.id, name: call.name, args: call.input });
          let r: ToolResult;
          try { r = await opts.registry.run(call.name, call.input, opts.cctx); }
          catch (e) { r = { ok: false, summary: errMsg(e) }; }
          ch.push({ type: "tool_result", callId: call.id, ok: r.ok, summary: r.summary });
          resultBlocks.push(toolResultBlock(call.id, r));
        }
        // Anthropic requires every tool_use to be answered by a tool_result in the next user message.
        messages.push({ role: "user", content: resultBlocks });
      }

      // Ran out of hops without a final answer — close the turn cleanly rather than spin.
      ch.push({ type: "final", text: "(Stopped — too many tool steps without finishing.)", messages });
    } catch (e) {
      ch.push({ type: "error", message: errMsg(e) });
    } finally {
      ch.close();
    }
  })();

  for await (const ev of ch) yield ev;
  await drive;
}

// Minimal single-consumer async channel: push events from the driver task, drain from the generator.
function createChannel<T>() {
  const buf: T[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  return {
    push(v: T) { buf.push(v); wake?.(); wake = null; },
    close() { closed = true; wake?.(); wake = null; },
    async *[Symbol.asyncIterator](): AsyncGenerator<T> {
      for (;;) {
        if (buf.length) { yield buf.shift()!; continue; }
        if (closed) return;
        await new Promise<void>((r) => { wake = r; });
      }
    },
  };
}
