import { describe, it, expect } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createNormalizer } from "./normalize.js";
import type { GuiEvent } from "./types.js";

// Fixtures mirror the real frames the Agent SDK emits — field names are taken verbatim from
// node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts (SDKPartialAssistantMessage,
// SDKAssistantMessage, SDKUserMessage, SDKResultSuccess/Error, SDKSystemMessage) — but carry only
// the fields the normalizer actually reads. The cast keeps ~30 bookkeeping fields per frame out of
// every test without inventing a shape the normalizer would never see in production.
const frame = (f: Record<string, unknown>): SDKMessage => f as unknown as SDKMessage;

const SESSION = "11112222-3333-4444-5555-666677778888";

let uuidSeq = 0;
const uuid = () => `f5a1c0de-0000-0000-0000-${String(++uuidSeq).padStart(12, "0")}`;

function streamEvent(event: Record<string, unknown>, over: Record<string, unknown> = {}): SDKMessage {
  return frame({ type: "stream_event", event, parent_tool_use_id: null, uuid: uuid(), session_id: SESSION, ...over });
}

const blockStart = (index: number, contentBlock: Record<string, unknown>, over: Record<string, unknown> = {}) =>
  streamEvent({ type: "content_block_start", index, content_block: contentBlock }, over);
const textDelta = (index: number, text: string) =>
  streamEvent({ type: "content_block_delta", index, delta: { type: "text_delta", text } });
const thinkingDelta = (index: number, thinking: string) =>
  streamEvent({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking } });
const jsonDelta = (index: number, partialJson: string) =>
  streamEvent({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: partialJson } });
const blockStop = (index: number) => streamEvent({ type: "content_block_stop", index });
const messageStart = () =>
  streamEvent({
    type: "message_start",
    message: {
      id: "msg_02", type: "message", role: "assistant", model: "claude-opus-4-5",
      content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 4, output_tokens: 0 },
    },
  });

function assistant(content: unknown[], over: Record<string, unknown> = {}): SDKMessage {
  return frame({
    type: "assistant",
    message: {
      id: "msg_01", type: "message", role: "assistant", model: "claude-opus-4-5",
      content, stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: 12, output_tokens: 34 },
    },
    parent_tool_use_id: null,
    uuid: uuid(),
    session_id: SESSION,
    ...over,
  });
}

function user(content: unknown, over: Record<string, unknown> = {}): SDKMessage {
  return frame({
    type: "user",
    message: { role: "user", content },
    parent_tool_use_id: null,
    uuid: uuid(),
    session_id: SESSION,
    ...over,
  });
}

function result(over: Record<string, unknown> = {}): SDKMessage {
  return frame({
    type: "result",
    subtype: "success",
    duration_ms: 4200,
    duration_api_ms: 3900,
    is_error: false,
    num_turns: 2,
    result: "all done",
    stop_reason: "end_turn",
    total_cost_usd: 0.0421,
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 },
    modelUsage: {},
    permission_denials: [],
    uuid: "res00000-0000-0000-0000-000000000001",
    session_id: SESSION,
    ...over,
  });
}

function systemInit(over: Record<string, unknown> = {}): SDKMessage {
  return frame({
    type: "system", subtype: "init",
    apiKeySource: "none", claude_code_version: "2.0.0", cwd: "/work/proj",
    tools: ["Bash", "Read"], mcp_servers: [], model: "claude-opus-4-5",
    permissionMode: "default", slash_commands: [], output_style: "default",
    uuid: uuid(), session_id: SESSION,
    ...over,
  });
}

const types = (events: GuiEvent[]) => events.map((e) => e.type);

/** Open a message by starting `block` at index 0; returns the normalizer + its message/block ids. */
function opened(block: Record<string, unknown>, index = 0) {
  const n = createNormalizer();
  const events = n.push(blockStart(index, block));
  const start = events[0] as Extract<GuiEvent, { type: "message.start" }>;
  return { n, events, messageId: start.id, blockId: `${start.id}:${index}` };
}

describe("createNormalizer — streamed assistant text", () => {
  it("emits message.start + block.start, one block.delta per fragment, then block.end", () => {
    const before = Date.now();
    const { n, events, messageId, blockId } = opened({ type: "text", text: "" });
    const after = Date.now();

    expect(types(events)).toEqual(["message.start", "block.start"]);
    const start = events[0] as Extract<GuiEvent, { type: "message.start" }>;
    expect(start.role).toBe("assistant");
    expect(start.ts).toBeGreaterThanOrEqual(before);
    expect(start.ts).toBeLessThanOrEqual(after);
    expect(events[1]).toEqual({ type: "block.start", messageId, block: { kind: "text", id: blockId, text: "" } });

    expect(n.push(textDelta(0, "Hel"))).toEqual([{ type: "block.delta", messageId, blockId, text: "Hel" }]);
    expect(n.push(textDelta(0, "lo, "))).toEqual([{ type: "block.delta", messageId, blockId, text: "lo, " }]);
    expect(n.push(textDelta(0, "world"))).toEqual([{ type: "block.delta", messageId, blockId, text: "world" }]);
    expect(n.push(blockStop(0))).toEqual([{ type: "block.end", messageId, blockId }]);

    // The message stays open — its authoritative end is the assistant snapshot / result frame.
    expect(n.currentMessageId()).toBe(messageId);
  });

  it("keeps a second block in the same message with its own id", () => {
    const { n, messageId } = opened({ type: "text", text: "" });
    n.push(textDelta(0, "first"));
    n.push(blockStop(0));

    const second = n.push(blockStart(1, { type: "text", text: "" }));
    expect(types(second)).toEqual(["block.start"]); // no second message.start
    expect(second[0]).toEqual({ type: "block.start", messageId, block: { kind: "text", id: `${messageId}:1`, text: "" } });
    expect(n.push(textDelta(1, "second"))).toEqual([{ type: "block.delta", messageId, blockId: `${messageId}:1`, text: "second" }]);
  });

  it("drops an empty text delta instead of pushing a no-op frame", () => {
    const { n } = opened({ type: "text", text: "" });
    expect(n.push(textDelta(0, ""))).toEqual([]);
  });

  it("carries the text a content_block_start already holds into block.start", () => {
    const { events, blockId, messageId } = opened({ type: "text", text: "prefilled" });
    expect(events[1]).toEqual({ type: "block.start", messageId, block: { kind: "text", id: blockId, text: "prefilled" } });
  });

  it("message_start closes the previous message so block indices cannot collide", () => {
    const { n, messageId } = opened({ type: "text", text: "" });
    n.push(textDelta(0, "one"));

    expect(n.push(messageStart())).toEqual([{ type: "message.end", id: messageId }]);
    expect(n.currentMessageId()).toBeNull();

    const next = n.push(blockStart(0, { type: "text", text: "" }));
    const restarted = next[0] as Extract<GuiEvent, { type: "message.start" }>;
    expect(restarted.type).toBe("message.start");
    expect(restarted.id).not.toBe(messageId);
    expect(next[1]).toMatchObject({ block: { id: `${restarted.id}:0` } });
  });
});

describe("createNormalizer — streamed thinking", () => {
  it("opens a thinking block and streams thinking_delta text into it", () => {
    const { n, events, messageId, blockId } = opened({ type: "thinking", thinking: "", signature: "" });

    expect(events[1]).toEqual({ type: "block.start", messageId, block: { kind: "thinking", id: blockId, text: "" } });
    expect(n.push(thinkingDelta(0, "let me "))).toEqual([{ type: "block.delta", messageId, blockId, text: "let me " }]);
    expect(n.push(thinkingDelta(0, "check"))).toEqual([{ type: "block.delta", messageId, blockId, text: "check" }]);
    expect(n.push(blockStop(0))).toEqual([{ type: "block.end", messageId, blockId }]);
  });

  it("ignores a signature_delta (and any other delta kind it does not render)", () => {
    const { n } = opened({ type: "thinking", thinking: "", signature: "" });
    expect(n.push(streamEvent({
      type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "abc123" },
    }))).toEqual([]);
  });
});

describe("createNormalizer — tool blocks", () => {
  it("emits block.input only once the buffered partial JSON parses", () => {
    const { n, events, messageId, blockId } = opened({ type: "tool_use", id: "toolu_01", name: "Bash", input: {} });

    expect(events[1]).toEqual({
      type: "block.start",
      messageId,
      block: { kind: "tool", id: blockId, toolUseId: "toolu_01", name: "Bash", input: {}, status: "running" },
    });

    // Fragments that leave the buffer mid-object are not an error — they simply produce nothing.
    expect(n.push(jsonDelta(0, '{"comm'))).toEqual([]);
    expect(n.push(jsonDelta(0, 'and":"ls '))).toEqual([]);
    expect(n.push(jsonDelta(0, '-la"}'))).toEqual([
      { type: "block.input", messageId, blockId, input: { command: "ls -la" } },
    ]);
  });

  it("does not re-fire block.input when a further fragment re-parses to the same input", () => {
    const { n } = opened({ type: "tool_use", id: "toolu_02", name: "Read", input: {} });
    n.push(jsonDelta(0, '{"file_path":"/x.ts"'));
    expect(n.push(jsonDelta(0, "}"))).toHaveLength(1);
    // trailing whitespace still parses, to an identical object — the card must not re-render
    expect(n.push(jsonDelta(0, " "))).toEqual([]);
    expect(n.push(jsonDelta(0, "\n"))).toEqual([]);
  });

  it("treats server_tool_use and mcp_tool_use as tool cards too", () => {
    for (const type of ["server_tool_use", "mcp_tool_use"]) {
      const { events, messageId, blockId } = opened({ type, id: `toolu_${type}`, name: "web_search", input: { query: "x" } });
      expect(events[1]).toEqual({
        type: "block.start",
        messageId,
        block: { kind: "tool", id: blockId, toolUseId: `toolu_${type}`, name: "web_search", input: { query: "x" }, status: "running" },
      });
    }
  });

  it("opens nothing at all for a content_block type it does not render", () => {
    const n = createNormalizer();
    // An unrenderable block must not open a message either — that would paint an empty bubble.
    expect(n.push(blockStart(0, { type: "redacted_thinking", data: "encrypted-blob" }))).toEqual([]);
    // no block was registered, so its deltas and stop are inert
    expect(n.push(jsonDelta(0, "{}"))).toEqual([]);
    expect(n.push(blockStop(0))).toEqual([]);
  });

  it("opens the message once a renderable block follows an unrenderable one", () => {
    const n = createNormalizer();
    n.push(blockStart(0, { type: "redacted_thinking", data: "encrypted-blob" }));
    expect(types(n.push(blockStart(1, { type: "text", text: "" })))).toEqual(["message.start", "block.start"]);
  });

  it("ignores a delta or stop for an index that never started", () => {
    const { n } = opened({ type: "text", text: "" });
    expect(n.push(textDelta(7, "ghost"))).toEqual([]);
    expect(n.push(blockStop(7))).toEqual([]);
  });
});

describe("createNormalizer — tool results", () => {
  it("maps a tool_result in a user frame to tool.result under its tool_use id", () => {
    const n = createNormalizer();
    expect(n.push(user([{ type: "tool_result", tool_use_id: "toolu_01", content: "a.ts\nb.ts", is_error: false }])))
      .toEqual([{ type: "tool.result", toolUseId: "toolu_01", status: "ok", result: "a.ts\nb.ts" }]);
  });

  it("marks is_error: true as an error result", () => {
    const n = createNormalizer();
    expect(n.push(user([{ type: "tool_result", tool_use_id: "toolu_err", content: "Exit code 1", is_error: true }])))
      .toEqual([{ type: "tool.result", toolUseId: "toolu_err", status: "error", result: "Exit code 1" }]);
  });

  it("flattens an array-of-blocks result to text and names the blocks that have none", () => {
    const n = createNormalizer();
    const events = n.push(user([{
      type: "tool_result",
      tool_use_id: "toolu_img",
      content: [
        { type: "text", text: "line one" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBOR" } },
        { type: "text", text: "line two" },
      ],
    }]));
    expect(events).toEqual([{ type: "tool.result", toolUseId: "toolu_img", status: "ok", result: "line one\n[image]\nline two" }]);
  });

  it("emits one event per tool_result and ignores everything else in the frame", () => {
    const n = createNormalizer();
    const events = n.push(user([
      { type: "text", text: "here are the results" },
      { type: "tool_result", tool_use_id: "toolu_a", content: "A" },
      { type: "tool_result", content: "no id — unroutable" },
      { type: "tool_result", tool_use_id: "toolu_b", content: "B", is_error: true },
    ]));
    expect(events).toEqual([
      { type: "tool.result", toolUseId: "toolu_a", status: "ok", result: "A" },
      { type: "tool.result", toolUseId: "toolu_b", status: "error", result: "B" },
    ]);
  });

  it("ignores a plain-string user message (a typed prompt, not tool traffic)", () => {
    const n = createNormalizer();
    expect(n.push(user("what is up"))).toEqual([]);
  });
});

describe("createNormalizer — assistant snapshots", () => {
  it("backfills whole blocks from a snapshot that never streamed", () => {
    const n = createNormalizer();
    const events = n.push(assistant([
      { type: "thinking", thinking: "quick check", signature: "sig" },
      { type: "text", text: "short answer" },
    ]));

    const messageId = (events[0] as Extract<GuiEvent, { type: "message.start" }>).id;
    expect(types(events)).toEqual(["message.start", "block.start", "block.end", "block.start", "block.end", "message.end"]);
    expect(events[1]).toEqual({ type: "block.start", messageId, block: { kind: "thinking", id: `${messageId}:0`, text: "quick check" } });
    expect(events[3]).toEqual({ type: "block.start", messageId, block: { kind: "text", id: `${messageId}:1`, text: "short answer" } });
    expect(events[5]).toEqual({ type: "message.end", id: messageId });
    expect(n.currentMessageId()).toBeNull();
  });

  it("emits no duplicate blocks for content that already streamed", () => {
    const { n, messageId } = opened({ type: "text", text: "" });
    n.push(textDelta(0, "hi "));
    n.push(textDelta(0, "there"));
    n.push(blockStop(0));

    // The snapshot arrives mid-stream and everything in it already streamed, so it says nothing new
    // — and crucially does NOT end the message; `message_stop` does that.
    expect(n.push(assistant([{ type: "text", text: "hi there" }]))).toEqual([]);
    expect(n.currentMessageId()).toBe(messageId);
  });

  it("backfills only the blocks the stream never delivered", () => {
    const { n, messageId } = opened({ type: "text", text: "" });
    n.push(textDelta(0, "streamed"));
    n.push(blockStop(0));

    const events = n.push(assistant([
      { type: "text", text: "streamed" },
      { type: "tool_use", id: "toolu_late", name: "Write", input: { file_path: "/y" } },
    ]));
    expect(types(events)).toEqual(["block.start", "block.end"]);
    expect(events[0]).toEqual({
      type: "block.start",
      messageId,
      block: { kind: "tool", id: `${messageId}:1`, toolUseId: "toolu_late", name: "Write", input: { file_path: "/y" }, status: "running" },
    });
  });

  it("fills a block that was opened but never received any delta", () => {
    const { n, messageId, blockId } = opened({ type: "text", text: "" });
    expect(n.push(assistant([{ type: "text", text: "filled from the snapshot" }]))).toEqual([
      { type: "block.delta", messageId, blockId, text: "filled from the snapshot" },
      { type: "block.end", messageId, blockId },
    ]);
  });

  it("fills a tool block whose input never streamed", () => {
    const { n, messageId, blockId } = opened({ type: "tool_use", id: "toolu_03", name: "Read", input: {} });
    expect(n.push(assistant([{ type: "tool_use", id: "toolu_03", name: "Read", input: { file_path: "/z.ts" } }]))).toEqual([
      { type: "block.input", messageId, blockId, input: { file_path: "/z.ts" } },
      { type: "block.end", messageId, blockId },
    ]);
  });

  it("starts a fresh message after a standalone snapshot closed the previous one", () => {
    const n = createNormalizer();
    const first = n.push(assistant([{ type: "text", text: "one" }]));
    const firstId = (first[0] as Extract<GuiEvent, { type: "message.start" }>).id;

    const second = n.push(blockStart(0, { type: "text", text: "" }));
    const secondId = (second[0] as Extract<GuiEvent, { type: "message.start" }>).id;
    expect(secondId).not.toBe(firstId);
  });

  it("does not redraw a tool card when its snapshot lands before content_block_stop", () => {
    // The real frame order, verified against a live CLI run: message_start → content_block_start →
    // deltas → ASSISTANT SNAPSHOT → content_block_stop → message_stop. Treating the snapshot as the
    // end of the message closed it mid-stream, so every following frame opened a fresh bubble and
    // drew the same tool call a second time — one stuck spinning, one resolved.
    const n = createNormalizer();
    n.push(messageStart());
    n.push(blockStart(0, { type: "tool_use", id: "toolu_dup", name: "Bash", input: {} }, {}));
    n.push(jsonDelta(0, '{"command":"ls"}'));

    // Same API message id as messageStart() — the SDK's two views of ONE message.
    const snapshot = n.push(assistant([], { message: {
      id: "msg_02", type: "message", role: "assistant", model: "claude-opus-4-5",
      content: [{ type: "tool_use", id: "toolu_dup", name: "Bash", input: { command: "ls" } }],
      stop_reason: "tool_use", stop_sequence: null,
      usage: { input_tokens: 4, output_tokens: 9 },
    } }));
    expect(types(snapshot)).toEqual([]); // nothing new to say, and nothing closed

    const stop = n.push(blockStop(0));
    expect(types(stop)).toEqual(["block.end"]);
    const end = n.push(streamEvent({ type: "message_stop" }));
    expect(types(end)).toEqual(["message.end"]);
  });

  it("ignores a repeat snapshot of a message that already streamed and closed", () => {
    const n = createNormalizer();
    n.push(messageStart());
    n.push(blockStart(0, { type: "text", text: "" }));
    n.push(textDelta(0, "hi"));
    n.push(streamEvent({ type: "message_stop" }));

    // msg_02 is messageStart()'s id — a late duplicate of a message we already delivered in full.
    expect(n.push(assistant([{ type: "text", text: "hi" }], { message: {
      id: "msg_02", type: "message", role: "assistant", model: "claude-opus-4-5",
      content: [{ type: "text", text: "hi" }], stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    } }))).toEqual([]);
  });

  it("never opens two cards for one tool_use id", () => {
    const n = createNormalizer();
    n.push(messageStart());
    n.push(blockStart(0, { type: "tool_use", id: "toolu_once", name: "Bash", input: {} }));
    n.push(streamEvent({ type: "message_stop" }));
    // A second message re-announcing the same call (retry frames, reconnect echoes) must not draw again.
    n.push(messageStart());
    expect(n.push(blockStart(0, { type: "tool_use", id: "toolu_once", name: "Bash", input: {} }))).toEqual([]);
  });

  it("ignores a snapshot whose content is not a block array", () => {
    const n = createNormalizer();
    expect(n.push(assistant("plain string" as unknown as unknown[]))).toEqual([]);
    expect(n.currentMessageId()).toBeNull();
  });
});

describe("createNormalizer — subagent narration", () => {
  it("drops a stream_event carrying parent_tool_use_id", () => {
    const n = createNormalizer();
    expect(n.push(blockStart(0, { type: "text", text: "" }, { parent_tool_use_id: "toolu_task" }))).toEqual([]);
    expect(n.push(textDelta(0, "subagent chatter"))).toEqual([]);
    expect(n.currentMessageId()).toBeNull();
  });

  it("drops an assistant snapshot carrying parent_tool_use_id", () => {
    const n = createNormalizer();
    expect(n.push(assistant([{ type: "text", text: "subagent said" }], { parent_tool_use_id: "toolu_task" }))).toEqual([]);
    expect(n.currentMessageId()).toBeNull();
  });

  it("leaves the main thread untouched when subagent frames interleave", () => {
    const { n, messageId, blockId } = opened({ type: "text", text: "" });
    n.push(blockStart(0, { type: "text", text: "" }, { parent_tool_use_id: "toolu_task" }));
    expect(n.push(textDelta(0, "main"))).toEqual([{ type: "block.delta", messageId, blockId, text: "main" }]);
  });
});

describe("createNormalizer — system frames", () => {
  it("turns a system/init frame into a session event", () => {
    const n = createNormalizer();
    expect(n.push(systemInit())).toEqual([{ type: "session", sessionId: SESSION }]);
  });

  it("ignores an init frame with no session id", () => {
    const n = createNormalizer();
    expect(n.push(systemInit({ session_id: "" }))).toEqual([]);
  });

  it("ignores every other system subtype", () => {
    const n = createNormalizer();
    expect(n.push(frame({ type: "system", subtype: "status", status: "requesting", uuid: uuid(), session_id: SESSION }))).toEqual([]);
    expect(n.push(frame({ type: "system", subtype: "session_state_changed", state: "idle", uuid: uuid(), session_id: SESSION }))).toEqual([]);
  });
});

describe("createNormalizer — result frames", () => {
  it("maps a successful result to turn.end with usage and cost", () => {
    const n = createNormalizer();
    expect(n.push(result())).toEqual([{
      type: "turn.end",
      turnId: "res00000-0000-0000-0000-000000000001",
      status: "completed",
      usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 5 },
      costUsd: 0.0421,
    }]);
  });

  it("reads an interrupt out of stop_reason even though the subtype is success", () => {
    for (const stopReason of ["interrupted", "abort"]) {
      const n = createNormalizer();
      const events = n.push(result({ stop_reason: stopReason }));
      expect((events[0] as Extract<GuiEvent, { type: "turn.end" }>).status).toBe("interrupted");
    }
  });

  it("maps an error subtype to failed", () => {
    const n = createNormalizer();
    const events = n.push(result({
      subtype: "error_during_execution", is_error: true, stop_reason: null, errors: ["boom"],
    }));
    expect((events[0] as Extract<GuiEvent, { type: "turn.end" }>).status).toBe("failed");
  });

  it("closes an open message before ending the turn", () => {
    const { n, messageId } = opened({ type: "text", text: "" });
    n.push(textDelta(0, "cut short"));
    const events = n.push(result({ stop_reason: "interrupted" }));
    expect(types(events)).toEqual(["message.end", "turn.end"]);
    expect(events[0]).toEqual({ type: "message.end", id: messageId });
    expect(n.currentMessageId()).toBeNull();
  });

  it("zero-fills missing usage counters and falls back to a generated turn id", () => {
    const n = createNormalizer();
    const events = n.push(result({ uuid: "", usage: { input_tokens: 7 }, total_cost_usd: null }));
    const end = events[0] as Extract<GuiEvent, { type: "turn.end" }>;
    expect(end.turnId).toMatch(/^turn_\d+$/);
    expect(end.usage).toEqual({ inputTokens: 7, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(end.costUsd).toBeUndefined();
  });

  it("omits usage entirely when the frame carries none", () => {
    const n = createNormalizer();
    const end = n.push(result({ usage: undefined }))[0] as Extract<GuiEvent, { type: "turn.end" }>;
    expect(end.usage).toBeUndefined();
  });
});

describe("createNormalizer — malformed input", () => {
  it("returns [] for a frame kind it does not know", () => {
    const n = createNormalizer();
    expect(n.push(frame({ type: "auth_status", isAuthenticating: true }))).toEqual([]);
    expect(n.push(frame({ type: "stream_event_but_not_really" }))).toEqual([]);
  });

  it("returns [] for a stream_event with no event payload", () => {
    const n = createNormalizer();
    expect(n.push(frame({ type: "stream_event", parent_tool_use_id: null, uuid: uuid(), session_id: SESSION }))).toEqual([]);
    expect(n.push(streamEvent({}))).toEqual([]);
  });

  it("returns [] for structurally broken frames instead of throwing", () => {
    const n = createNormalizer();
    expect(n.push(frame({ type: "assistant", message: null, parent_tool_use_id: null }))).toEqual([]);
    expect(n.push(frame({ type: "user", message: "not an object", parent_tool_use_id: null }))).toEqual([]);
    expect(n.push(frame({ type: "stream_event", event: "nope", parent_tool_use_id: null }))).toEqual([]);
    expect(n.push(frame({}))).toEqual([]);
    expect(n.push(null as unknown as SDKMessage)).toEqual([]);
    expect(n.push(undefined as unknown as SDKMessage)).toEqual([]);
  });

  it("keeps working after a malformed frame", () => {
    const n = createNormalizer();
    n.push(null as unknown as SDKMessage);
    const events = n.push(blockStart(0, { type: "text", text: "" }));
    expect(types(events)).toEqual(["message.start", "block.start"]);
  });
});

describe("createNormalizer — a whole turn end to end", () => {
  it("streams text, runs a tool, takes its result, and ends the turn", () => {
    const n = createNormalizer();
    const all: GuiEvent[] = [];
    const feed = (m: SDKMessage) => all.push(...n.push(m));

    feed(systemInit());
    feed(blockStart(0, { type: "text", text: "" }));
    feed(textDelta(0, "Listing "));
    feed(textDelta(0, "files."));
    feed(blockStop(0));
    feed(blockStart(1, { type: "tool_use", id: "toolu_end", name: "Bash", input: {} }));
    feed(jsonDelta(1, '{"command"'));
    feed(jsonDelta(1, ':"ls"}'));
    feed(blockStop(1));
    feed(assistant([
      { type: "text", text: "Listing files." },
      { type: "tool_use", id: "toolu_end", name: "Bash", input: { command: "ls" } },
    ]));
    feed(user([{ type: "tool_result", tool_use_id: "toolu_end", content: "a.ts" }]));
    feed(result());

    expect(types(all)).toEqual([
      "session",
      "message.start", "block.start", "block.delta", "block.delta", "block.end",
      "block.start", "block.input", "block.end",
      // The tool result lands while the message is still open — only message_stop (or, as here, the
      // result frame) ends it. Closing on the snapshot instead used to re-open a bubble and draw
      // every tool call a second time.
      "tool.result",
      "message.end",
      "turn.end",
    ]);
    expect(all.filter((e) => e.type === "message.start")).toHaveLength(1);
  });
});

describe("createNormalizer — tool calls that never report back", () => {
  it("settles an unresolved tool call as aborted when the turn ends", () => {
    const { n } = opened({ type: "tool_use", id: "toolu_hung", name: "Bash", input: {} });
    const events = n.push(result({ stop_reason: "interrupted" }));

    // Before turn.end, so the card stops spinning in the same frame the composer goes idle.
    expect(types(events)).toEqual(["message.end", "tool.result", "turn.end"]);
    expect(events[1]).toEqual({
      type: "tool.result", toolUseId: "toolu_hung", status: "aborted", result: "",
    });
  });

  it("leaves a tool call that did report back alone", () => {
    const { n } = opened({ type: "tool_use", id: "toolu_ok", name: "Bash", input: {} });
    n.push(user([{ type: "tool_result", tool_use_id: "toolu_ok", content: "done" }]));

    expect(types(n.push(result()))).toEqual(["message.end", "turn.end"]);
  });

  it("settles every outstanding call, and only once", () => {
    const n = createNormalizer();
    n.push(blockStart(0, { type: "tool_use", id: "toolu_a", name: "Bash", input: {} }));
    n.push(blockStart(1, { type: "tool_use", id: "toolu_b", name: "Read", input: {} }));
    n.push(user([{ type: "tool_result", tool_use_id: "toolu_a", content: "ok" }]));

    const first = n.push(result({ stop_reason: "interrupted" }));
    expect(first.filter((e) => e.type === "tool.result")).toEqual([
      { type: "tool.result", toolUseId: "toolu_b", status: "aborted", result: "" },
    ]);
    // A second turn must not re-settle what the first already closed out.
    expect(n.push(result()).filter((e) => e.type === "tool.result")).toEqual([]);
  });

  it("gives an outstanding call the turn's own outcome when the turn completed", () => {
    const { n } = opened({ type: "tool_use", id: "toolu_late", name: "Bash", input: {} });

    expect(n.push(result()).filter((e) => e.type === "tool.result")).toEqual([
      { type: "tool.result", toolUseId: "toolu_late", status: "ok", result: "" },
    ]);
  });

  it("exposes the same settling for a run that dies without a result frame", () => {
    const { n } = opened({ type: "tool_use", id: "toolu_killed", name: "Bash", input: {} });

    expect(n.settleOpenTools("aborted")).toEqual([
      { type: "tool.result", toolUseId: "toolu_killed", status: "aborted", result: "" },
    ]);
    expect(n.settleOpenTools("aborted")).toEqual([]);
  });
});
