import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { GuiBlock, GuiEvent, GuiToolStatus, GuiUsage } from "./types.js";

// SDKMessage → GuiEvent. Pure and stateful-per-session: deltas only make sense relative to the
// block they belong to, so the normalizer remembers which blocks are open.
//
// The SDK's stream events are Anthropic beta message-stream frames. We deliberately narrow them
// structurally (checking `event.type` and reading known fields) instead of importing the beta types:
// the beta shapes churn, and a new delta kind should be ignored, not break the chat.

/** Tool-ish content block kinds the model can emit. Rendered identically as a tool card. */
const TOOL_BLOCK_TYPES = new Set(["tool_use", "server_tool_use", "mcp_tool_use"]);

interface OpenBlock {
  id: string;
  kind: GuiBlock["kind"];
  /** Accumulated partial JSON for a tool block's input, from input_json_delta fragments. */
  jsonBuffer: string;
  /** Serialised form of the last input we emitted, so identical re-parses stay off the wire. */
  lastInput: string | null;
  /** True once any delta landed — a snapshot must not re-emit a block that already streamed. */
  streamed: boolean;
}

export interface Normalizer {
  /** Feed one SDKMessage; get the GuiEvents it produces (possibly none). Never throws. */
  push(message: SDKMessage): GuiEvent[];
  /** The assistant message currently open, if any. */
  currentMessageId(): string | null;
  /**
   * Close out every tool call still waiting on a result, giving each the outcome the run itself
   * ended with. The `result` frame does this on its own; this is the entry point for a run that
   * never gets one — the CLI died, the hub restarted, the session was torn down mid-turn.
   */
  settleOpenTools(status: Exclude<GuiToolStatus, "running">): GuiEvent[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Flatten a tool_result `content` (a string, or an array of typed blocks) to plain text. */
function flattenResult(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const rec = asRecord(block);
      if (!rec) return "";
      if (rec.type === "text") return str(rec.text);
      // Images and other rich blocks have no text form; name them so the card isn't mysteriously blank.
      return rec.type ? `[${str(rec.type)}]` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function mapUsage(raw: unknown): GuiUsage | undefined {
  const u = asRecord(raw);
  if (!u) return undefined;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    inputTokens: num(u.input_tokens),
    outputTokens: num(u.output_tokens),
    cacheReadTokens: num(u.cache_read_input_tokens),
    cacheWriteTokens: num(u.cache_creation_input_tokens),
  };
}

export function createNormalizer(): Normalizer {
  // Open assistant message + its blocks, keyed by the content-block index the SDK streams under.
  let messageId: string | null = null;
  const blocks = new Map<number, OpenBlock>();
  let counter = 0;

  // The API's own `msg_…` id for the message being streamed. This is the join key between the two
  // views of one assistant message — the stream frames and the `assistant` snapshot — and it is what
  // stops the snapshot being mistaken for a second message.
  let apiMessageId: string | null = null;
  /** Carried from `message_start` to the first `content_block_start`, which is where we open. */
  let pendingApiId: string | null = null;
  /** Every API message id we've already turned into a bubble. */
  const seenApiMessages = new Set<string>();
  /** Every tool_use id we've already drawn a card for — one call can never become two cards. */
  const seenToolUseIds = new Set<string>();
  /** Cards still spinning: added when the call is drawn, removed when its result lands. */
  const openToolUseIds = new Set<string>();

  /** Deterministic within one normalizer, which keeps tests readable. */
  const nextMessageId = () => `gm_${++counter}`;
  const blockId = (index: number) => `${messageId}:${index}`;

  const openMessage = (out: GuiEvent[], ts: number, apiId: string | null = null) => {
    if (messageId) return;
    messageId = nextMessageId();
    apiMessageId = apiId;
    if (apiId) seenApiMessages.add(apiId);
    blocks.clear();
    out.push({ type: "message.start", id: messageId, role: "assistant", ts });
  };

  const closeMessage = (out: GuiEvent[]) => {
    if (!messageId) return;
    out.push({ type: "message.end", id: messageId });
    messageId = null;
    apiMessageId = null;
    blocks.clear();
  };

  /** Whether a content block is one we render. Checked before opening a message so an unrenderable
   *  block (redacted_thinking, a future block type) can't leave an empty assistant bubble. */
  const renderable = (raw: Record<string, unknown>): boolean => {
    const type = str(raw.type);
    return type === "text" || type === "thinking" || TOOL_BLOCK_TYPES.has(type);
  };

  /** Build the GuiBlock for a content_block_start payload, or null for a kind we don't render.
   *  Depends on the open message id, so it must run AFTER openMessage. */
  const blockFor = (index: number, raw: Record<string, unknown>): GuiBlock | null => {
    const type = str(raw.type);
    const id = blockId(index);
    if (type === "text") return { kind: "text", id, text: str(raw.text) };
    if (type === "thinking") return { kind: "thinking", id, text: str(raw.thinking) };
    if (TOOL_BLOCK_TYPES.has(type)) {
      return {
        kind: "tool",
        id,
        toolUseId: str(raw.id),
        name: str(raw.name),
        // `input` starts as whatever the start frame carried (usually `{}`); input_json_delta fills it.
        input: raw.input ?? {},
        status: "running" as GuiToolStatus,
      };
    }
    return null;
  };

  const handleStreamEvent = (message: SDKMessage, out: GuiEvent[]): void => {
    const msg = message as unknown as Record<string, unknown>;
    // Subagent narration would interleave into the main transcript. Its tool blocks are equally
    // noisy here because the parent Task tool card already represents the work.
    if (msg.parent_tool_use_id != null) return;
    const event = asRecord(msg.event);
    if (!event) return;
    const kind = str(event.type);

    if (kind === "content_block_start") {
      const index = typeof event.index === "number" ? event.index : 0;
      const raw = asRecord(event.content_block);
      if (!raw) return;
      if (!renderable(raw)) return;
      // A tool call we've already drawn must never open a second card, whatever the frame ordering.
      if (TOOL_BLOCK_TYPES.has(str(raw.type)) && seenToolUseIds.has(str(raw.id))) return;
      openMessage(out, Date.now(), pendingApiId);
      const block = blockFor(index, raw);
      if (!block) return;
      if (block.kind === "tool") { seenToolUseIds.add(block.toolUseId); openToolUseIds.add(block.toolUseId); }
      blocks.set(index, { id: block.id, kind: block.kind, jsonBuffer: "", lastInput: null, streamed: false });
      out.push({ type: "block.start", messageId: messageId as string, block });
      return;
    }

    if (kind === "content_block_delta") {
      const index = typeof event.index === "number" ? event.index : 0;
      const open = blocks.get(index);
      const delta = asRecord(event.delta);
      if (!open || !delta || !messageId) return;
      const deltaType = str(delta.type);

      if (deltaType === "text_delta" || deltaType === "thinking_delta") {
        const text = deltaType === "text_delta" ? str(delta.text) : str(delta.thinking);
        if (!text) return;
        open.streamed = true;
        out.push({ type: "block.delta", messageId, blockId: open.id, text });
        return;
      }

      if (deltaType === "input_json_delta") {
        open.jsonBuffer += str(delta.partial_json);
        open.streamed = true;
        // Partial JSON is unparseable most of the way through — that's expected, not an error. Only
        // push when it parses AND changed, so a card doesn't re-render on every fragment.
        try {
          const parsed = JSON.parse(open.jsonBuffer);
          const serialised = JSON.stringify(parsed);
          if (serialised !== open.lastInput) {
            open.lastInput = serialised;
            out.push({ type: "block.input", messageId, blockId: open.id, input: parsed });
          }
        } catch { /* still mid-object */ }
      }
      return;
    }

    if (kind === "content_block_stop") {
      const index = typeof event.index === "number" ? event.index : 0;
      const open = blocks.get(index);
      if (!open || !messageId) return;
      out.push({ type: "block.end", messageId, blockId: open.id });
      return;
    }

    // The stream owns the message boundary. `message_stop` is the real end — the `assistant`
    // snapshot arrives BEFORE it (verified against live frames), so treating the snapshot as the
    // boundary closed the message mid-stream and every later frame opened a fresh bubble, drawing
    // each tool call a second time.
    if (kind === "message_stop") { closeMessage(out); return; }
    if (kind === "message_start") {
      closeMessage(out);
      // Held until the first content block, which is where the bubble actually opens.
      pendingApiId = str(asRecord(event.message)?.id) || null;
    }
  };

  /** Fill in the blocks of a snapshot that the stream didn't already deliver. Assumes a message is
   *  open and that `blocks` describes it. Never opens or closes — the caller owns the boundary. */
  const backfill = (content: unknown[], out: GuiEvent[]): void => {
    content.forEach((raw, index) => {
      const rec = asRecord(raw);
      if (!rec) return;
      const open = blocks.get(index);
      if (open?.streamed) return; // already delivered as deltas
      if (TOOL_BLOCK_TYPES.has(str(rec.type)) && !open && seenToolUseIds.has(str(rec.id))) return;
      const block = blockFor(index, rec);
      if (!block) return;
      if (!open) {
        if (block.kind === "tool") { seenToolUseIds.add(block.toolUseId); openToolUseIds.add(block.toolUseId); }
        blocks.set(index, { id: block.id, kind: block.kind, jsonBuffer: "", lastInput: null, streamed: true });
        out.push({ type: "block.start", messageId: messageId as string, block });
      } else if (block.kind === "text" || block.kind === "thinking") {
        // The block was opened by a start frame but never received text — fill it from the snapshot.
        if (block.text) out.push({ type: "block.delta", messageId: messageId as string, blockId: open.id, text: block.text });
        open.streamed = true;
      } else if (block.kind === "tool") {
        out.push({ type: "block.input", messageId: messageId as string, blockId: open.id, input: block.input });
        open.streamed = true;
      }
      out.push({ type: "block.end", messageId: messageId as string, blockId: block.id });
    });
  };

  /** The `assistant` snapshot: the whole message as the CLI sees it. It arrives mid-stream, so its
   *  job here is only to fill gaps — a short reply the deltas never covered, or the entire message
   *  when partial streaming is off. It is matched to its own bubble by API message id. */
  const handleAssistant = (message: SDKMessage, out: GuiEvent[]): void => {
    const msg = message as unknown as Record<string, unknown>;
    if (msg.parent_tool_use_id != null) return;
    const inner = asRecord(msg.message);
    const content = inner?.content;
    if (!Array.isArray(content)) return;
    const apiId = str(inner?.id) || null;

    // The snapshot for the bubble currently streaming: top it up and leave it OPEN — `message_stop`
    // ends it. A bubble opened without a `message_start` has no id yet, so it adopts this one; that
    // is the only message an in-flight snapshot can belong to.
    const belongsToOpen = messageId !== null
      && (apiMessageId === null || apiId === null || apiId === apiMessageId);
    if (belongsToOpen) {
      if (apiId && !apiMessageId) { apiMessageId = apiId; seenApiMessages.add(apiId); }
      backfill(content, out);
      return;
    }
    // A snapshot for a bubble we already streamed and closed. Everything in it was delivered live,
    // so re-emitting would duplicate the whole message.
    if (apiId && seenApiMessages.has(apiId)) return;

    // No stream for this message — partial messages are off, so the snapshot IS the message.
    const hasRenderable = content.some((raw) => { const rec = asRecord(raw); return rec ? renderable(rec) : false; });
    if (!hasRenderable) return;
    closeMessage(out);
    openMessage(out, Date.now(), apiId);
    backfill(content, out);
    closeMessage(out);
  };

  /** A user message from the CLI is never the human typing — it's tool results coming back. */
  const handleUser = (message: SDKMessage, out: GuiEvent[]): void => {
    const msg = message as unknown as Record<string, unknown>;
    // Its matching tool_use block was dropped as subagent narration, so this result has no card to
    // attach to — same filter as the stream and snapshot paths.
    if (msg.parent_tool_use_id != null) return;
    const inner = asRecord(msg.message);
    const content = inner?.content;
    if (!Array.isArray(content)) return;
    for (const raw of content) {
      const rec = asRecord(raw);
      if (!rec || rec.type !== "tool_result") continue;
      const toolUseId = str(rec.tool_use_id);
      if (!toolUseId) continue;
      openToolUseIds.delete(toolUseId);
      out.push({
        type: "tool.result",
        toolUseId,
        status: rec.is_error === true ? "error" : "ok",
        result: flattenResult(rec.content),
      });
    }
  };

  /** Turn every still-spinning card into a settled one. Emitted as ordinary `tool.result` events so
   *  the server transcript and the browser both fold it through the path they already have. */
  const settleOpenTools = (status: Exclude<GuiToolStatus, "running">): GuiEvent[] => {
    const out: GuiEvent[] = [];
    for (const toolUseId of openToolUseIds) {
      out.push({ type: "tool.result", toolUseId, status, result: "" });
    }
    openToolUseIds.clear();
    return out;
  };

  const handleResult = (message: SDKMessage, out: GuiEvent[]): void => {
    const msg = message as unknown as Record<string, unknown>;
    closeMessage(out);
    const subtype = str(msg.subtype);
    const stopReason = str(msg.stop_reason);
    const status = subtype === "success"
      // An interrupt still lands as a "success" result; only stop_reason distinguishes it.
      ? (stopReason === "interrupted" || stopReason === "abort" ? "interrupted" : "completed")
      : "failed";
    // A turn is over: anything that hasn't reported back never will. Each open call inherits the
    // turn's own outcome, and settles BEFORE turn.end so the cards stop spinning in the same frame
    // the composer goes idle.
    out.push(...settleOpenTools(status === "completed" ? "ok" : "aborted"));
    out.push({
      type: "turn.end",
      // The SDK's own uuid identifies the turn — the UI only needs it to be stable and unique.
      turnId: str(msg.uuid) || `turn_${++counter}`,
      status,
      usage: mapUsage(msg.usage),
      costUsd: typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : undefined,
    });
  };

  return {
    currentMessageId: () => messageId,
    settleOpenTools,

    push(message) {
      const out: GuiEvent[] = [];
      try {
        switch (message.type) {
          case "stream_event": handleStreamEvent(message, out); break;
          case "assistant": handleAssistant(message, out); break;
          case "user": handleUser(message, out); break;
          case "result": handleResult(message, out); break;
          case "system": {
            const msg = message as unknown as Record<string, unknown>;
            // `init` is the only system frame the chat needs: it carries the durable session id the
            // terminal binds to. Every other subtype is orchestration noise for this UI.
            if (msg.subtype === "init") {
              const sessionId = str(msg.session_id);
              if (sessionId) out.push({ type: "session", sessionId });
            }
            break;
          }
          default: break; // unknown/irrelevant frame kinds are ignored, never fatal
        }
      } catch {
        // A malformed frame must not kill the stream — drop it and keep the session alive.
        return [];
      }
      return out;
    },
  };
}
