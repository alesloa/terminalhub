import { randomUUID } from "node:crypto";
import type {
  CodexItem, CodexItemStatus, CodexTurn, CodexTurnStatus,
} from "../../codex/protocol.js";
import { CODEX_NOTIFICATION } from "../../codex/protocol.js";
import type { GuiBlock, GuiEvent, GuiMessage, GuiToolStatus, GuiTurnStatus } from "../types.js";

// codex app-server notifications → GuiEvent. The Codex twin of gui/normalize.ts.
//
// Codex's stream is item-shaped where Claude's is block-shaped: the server announces a thread ITEM
// (an agent message, a reasoning trace, a shell command, a patch) with `item/started`, streams text
// into it, and closes it with `item/completed`. That maps cleanly onto our block model — one item is
// one block — so the whole difference is folded here and the rest of the GUI is untouched.
//
// Message boundary: ONE assistant message per turn. Codex has no equivalent of Claude's API message
// ids, and the transcript renderer flattens blocks across messages anyway (transcriptRows.ts), so a
// per-turn bubble renders identically and needs no boundary guessing.

/** Tool names we synthesise for Codex items, chosen to match what the web already specialises on:
 *  `Bash` gets a command summary, `WebSearch` a query summary, `Read` a path. */
const TOOL_NAME = {
  command: "Bash",
  patch: "ApplyPatch",
  webSearch: "WebSearch",
  imageView: "Read",
  plan: "UpdatePlan",
} as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The item's own id doubles as the tool-use id: Codex addresses results by it, and it is unique
 *  within a thread, which is exactly what a join key has to be. */
function toolStatus(status: CodexItemStatus | undefined): GuiToolStatus {
  switch (status) {
    case "completed": return "ok";
    case "failed": return "error";
    // The user said no. That is a settled outcome, not a crash and not a missing result.
    case "declined": return "error";
    default: return "running";
  }
}

export function turnStatusOf(status: CodexTurnStatus | undefined): GuiTurnStatus {
  if (status === "interrupted") return "interrupted";
  if (status === "failed") return "failed";
  return "completed";
}

/** Flatten an MCP / dynamic tool result to the text a card can show. */
function flattenToolResult(item: CodexItem): string {
  const rec = item as unknown as Record<string, unknown>;
  const error = asRecord(rec.error);
  if (error) return str(error.message) || "Tool call failed.";
  const content = rec.contentItems;
  if (Array.isArray(content)) {
    return content.map((c) => str(asRecord(c)?.text)).filter(Boolean).join("\n");
  }
  const result = rec.result;
  if (typeof result === "string") return result;
  if (result === undefined || result === null) return "";
  try { return JSON.stringify(result, null, 2) ?? ""; } catch { return ""; }
}

/** The plain-text result for a finished item, or "" when the card has nothing to show. */
export function resultTextFor(item: CodexItem): string {
  switch (item.type) {
    case "commandExecution": {
      const it = item as Extract<CodexItem, { type: "commandExecution" }>;
      const output = it.aggregatedOutput ?? "";
      if (it.status === "declined") return "Declined.";
      // A non-zero exit is the single most useful thing about a failed command, and it is not
      // always echoed in the output.
      return it.exitCode != null && it.exitCode !== 0
        ? `${output}${output.endsWith("\n") || !output ? "" : "\n"}exit ${it.exitCode}`
        : output;
    }
    case "fileChange": {
      const it = item as Extract<CodexItem, { type: "fileChange" }>;
      if (it.status === "declined") return "Declined.";
      return it.changes.map((c) => `${c.kind} ${c.path}`).join("\n");
    }
    case "mcpToolCall": case "dynamicToolCall":
      return flattenToolResult(item);
    default:
      return "";
  }
}

/**
 * One Codex item → one GuiBlock, or null for an item that isn't drawn (the user's own message, which
 * the composer already echoed, and anything a newer CLI adds that we don't recognise).
 *
 * `blockId` is caller-supplied so the same mapping serves both the live stream (ids scoped to the
 * open message) and a replayed history (ids scoped to the message being rebuilt).
 */
export function blockForItem(item: CodexItem, blockId: string): GuiBlock | null {
  switch (item.type) {
    case "agentMessage":
      return { kind: "text", id: blockId, text: (item as Extract<CodexItem, { type: "agentMessage" }>).text ?? "" };

    case "reasoning": {
      const it = item as Extract<CodexItem, { type: "reasoning" }>;
      // The summary is what Codex intends to show; full content is the fallback when it is withheld.
      const text = (it.summary?.length ? it.summary : it.content ?? []).join("\n\n");
      return { kind: "thinking", id: blockId, text };
    }

    case "plan": {
      const it = item as Extract<CodexItem, { type: "plan" }>;
      return {
        kind: "tool", id: blockId, toolUseId: it.id, name: TOOL_NAME.plan,
        input: { plan: it.text }, status: "ok",
      };
    }

    case "commandExecution": {
      const it = item as Extract<CodexItem, { type: "commandExecution" }>;
      return {
        kind: "tool", id: blockId, toolUseId: it.id, name: TOOL_NAME.command,
        input: { command: it.command, ...(it.cwd ? { cwd: it.cwd } : {}) },
        status: toolStatus(it.status),
      };
    }

    case "fileChange": {
      const it = item as Extract<CodexItem, { type: "fileChange" }>;
      const first = it.changes[0]?.path ?? "";
      return {
        kind: "tool", id: blockId, toolUseId: it.id, name: TOOL_NAME.patch,
        // `file_path` is what the web's summariser reads for an edit; `changes` is what the patch
        // renderer draws. Both, so one card gives a one-line summary AND the full diff.
        input: {
          file_path: it.changes.length > 1 ? `${first} +${it.changes.length - 1} more` : first,
          changes: it.changes,
        },
        status: toolStatus(it.status),
      };
    }

    case "mcpToolCall": {
      const it = item as Extract<CodexItem, { type: "mcpToolCall" }>;
      return {
        kind: "tool", id: blockId, toolUseId: it.id, name: `${it.server}/${it.tool}`,
        input: it.arguments ?? {}, status: toolStatus(it.status),
      };
    }

    case "dynamicToolCall": {
      const it = item as Extract<CodexItem, { type: "dynamicToolCall" }>;
      return {
        kind: "tool", id: blockId, toolUseId: it.id,
        name: it.namespace ? `${it.namespace}/${it.tool}` : it.tool,
        input: it.arguments ?? {}, status: toolStatus(it.status),
      };
    }

    case "webSearch": {
      const it = item as Extract<CodexItem, { type: "webSearch" }>;
      return {
        kind: "tool", id: blockId, toolUseId: it.id, name: TOOL_NAME.webSearch,
        input: { query: it.query }, status: "ok",
      };
    }

    case "imageView": {
      const it = item as Extract<CodexItem, { type: "imageView" }>;
      return {
        kind: "tool", id: blockId, toolUseId: it.id, name: TOOL_NAME.imageView,
        input: { file_path: it.path }, status: "ok",
      };
    }

    default:
      return null;
  }
}

/** The text of a stored user message item, for rebuilding history. */
function userTextOf(item: CodexItem): string {
  const it = item as Extract<CodexItem, { type: "userMessage" }>;
  return (it.content ?? []).map((c) => str(c.text)).filter(Boolean).join("\n").trim();
}

/**
 * Stored turns (from `thread/resume` / `thread/read`) → the conversation as the chat draws it.
 * This is Codex's answer to gui/history.ts: the app-server hands back the whole thread, so there is
 * no JSONL to parse.
 */
export function historyFromTurns(turns: CodexTurn[]): GuiMessage[] {
  const messages: GuiMessage[] = [];
  for (const turn of turns) {
    let assistant: GuiMessage | null = null;
    for (const item of turn.items ?? []) {
      if (item.type === "userMessage") {
        const text = userTextOf(item);
        assistant = null; // a new human turn always starts a new assistant bubble after it
        if (!text) continue;
        const id = `cx_${turn.id}_${item.id}`;
        messages.push({
          id, role: "user", ts: 0,
          blocks: [{ kind: "text", id: `${id}:0`, text }],
        });
        continue;
      }
      if (!assistant) {
        assistant = { id: `cx_${turn.id}`, role: "assistant", blocks: [], ts: 0 };
        messages.push(assistant);
      }
      const block = blockForItem(item, `cx_${turn.id}:${assistant.blocks.length}`);
      if (!block) continue;
      if (block.kind === "tool") {
        const result = resultTextFor(item);
        assistant.blocks.push(result ? { ...block, result } : block);
      } else if (block.kind === "text" || block.kind === "thinking") {
        // A block with no text is an item that produced nothing — drawing it would put an empty
        // paragraph in the middle of a replayed conversation.
        if (block.text) assistant.blocks.push(block);
      } else {
        assistant.blocks.push(block);
      }
    }
  }
  // Turns that produced nothing renderable would otherwise leave hollow bubbles behind.
  return messages.filter((m) => m.blocks.length > 0);
}

// ---------------------------------------------------------------------------
// Live stream
// ---------------------------------------------------------------------------

interface OpenItem {
  blockId: string;
  kind: GuiBlock["kind"];
  /** True once any delta landed — the completed snapshot must not re-send what already streamed. */
  streamed: boolean;
  /** Reasoning only: which summary part the last delta belonged to, so parts stay separated. */
  summaryIndex: number;
}

export interface CodexNormalizer {
  /** Feed one app-server notification; get the GuiEvents it produces. Never throws. */
  push(method: string, params: unknown): GuiEvent[];
  /** Close every card still spinning, giving each the outcome the run itself ended with. */
  settleOpenTools(status: Exclude<GuiToolStatus, "running">): GuiEvent[];
  /** Close the open assistant message, if any. */
  closeMessage(): GuiEvent[];
}

export function createCodexNormalizer(): CodexNormalizer {
  let messageId: string | null = null;
  const open = new Map<string, OpenItem>();
  const openTools = new Set<string>();
  let blockCounter = 0;

  const out: GuiEvent[] = [];
  const emit = (event: GuiEvent) => { out.push(event); };

  const openMessage = () => {
    if (messageId) return;
    messageId = `cx_${randomUUID()}`;
    emit({ type: "message.start", id: messageId, role: "assistant", ts: Date.now() });
  };

  const closeMessage = (): GuiEvent[] => {
    if (!messageId) return [];
    const events: GuiEvent[] = [{ type: "message.end", id: messageId }];
    messageId = null;
    open.clear();
    blockCounter = 0;
    return events;
  };

  const settleOpenTools = (status: Exclude<GuiToolStatus, "running">): GuiEvent[] => {
    const events: GuiEvent[] = [];
    for (const toolUseId of openTools) events.push({ type: "tool.result", toolUseId, status, result: "" });
    openTools.clear();
    return events;
  };

  const startItem = (params: unknown) => {
    const item = asRecord(params)?.item as CodexItem | undefined;
    if (!item?.type) return;
    if (item.type === "userMessage") return; // the composer already echoed it
    openMessage();
    const blockId = `${messageId}:${blockCounter++}`;
    const block = blockForItem(item, blockId);
    if (!block) { blockCounter -= 1; return; }
    // A tool item arrives with its final status only on completion; while it runs it must spin.
    const started: GuiBlock = block.kind === "tool" ? { ...block, status: "running" } : block;
    open.set(item.id, { blockId, kind: block.kind, streamed: false, summaryIndex: 0 });
    if (started.kind === "tool") openTools.add(started.toolUseId);
    emit({ type: "block.start", messageId: messageId as string, block: started });
    // Text and thinking arrive empty and fill by delta; a tool's input is already complete here.
    if (started.kind === "text" || started.kind === "thinking") {
      const text = started.text;
      if (text) {
        open.get(item.id)!.streamed = true;
        emit({ type: "block.delta", messageId: messageId as string, blockId, text });
      }
    }
  };

  const completeItem = (params: unknown) => {
    const item = asRecord(params)?.item as CodexItem | undefined;
    if (!item?.type) return;
    if (item.type === "userMessage") return;
    let entry = open.get(item.id);
    // An item that completes without ever starting (a fast tool, a reconnect mid-turn) still has to
    // be drawn, or the transcript silently loses it.
    if (!entry) { startItem(params); entry = open.get(item.id); }
    if (!entry || !messageId) return;

    const block = blockForItem(item, entry.blockId);
    if (block && (block.kind === "text" || block.kind === "thinking")) {
      // Deltas already delivered the text; re-sending the snapshot would print it twice.
      if (!entry.streamed && block.text) {
        emit({ type: "block.delta", messageId, blockId: entry.blockId, text: block.text });
      }
    } else if (block?.kind === "tool") {
      // The input is only fully known now — a shell command's `cwd`, a patch's file list.
      emit({ type: "block.input", messageId, blockId: entry.blockId, input: block.input });
      openTools.delete(block.toolUseId);
      emit({
        type: "tool.result",
        toolUseId: block.toolUseId,
        status: block.status === "running" ? "ok" : block.status,
        result: resultTextFor(item),
      });
    }
    emit({ type: "block.end", messageId, blockId: entry.blockId });
    open.delete(item.id);
  };

  const delta = (params: unknown, kind: "text" | "reasoning" | "summary" | "command") => {
    const rec = asRecord(params);
    if (!rec || !messageId) return;
    const itemId = str(rec.itemId);
    const text = str(rec.delta);
    const entry = open.get(itemId);
    if (!entry || !text) return;
    // Command output streams into a tool card, which has no delta channel — the aggregated output
    // arrives with `item/completed` instead, so live output is intentionally not drawn.
    if (kind === "command") return;
    let payload = text;
    if (kind === "summary") {
      const index = typeof rec.summaryIndex === "number" ? rec.summaryIndex : 0;
      // Codex numbers summary parts; each is its own paragraph in the CLI, so keep them apart.
      if (entry.streamed && index !== entry.summaryIndex) payload = `\n\n${text}`;
      entry.summaryIndex = index;
    }
    entry.streamed = true;
    emit({ type: "block.delta", messageId, blockId: entry.blockId, text: payload });
  };

  return {
    settleOpenTools,
    closeMessage,

    push(method, params) {
      out.length = 0;
      try {
        switch (method) {
          case CODEX_NOTIFICATION.itemStarted: startItem(params); break;
          case CODEX_NOTIFICATION.itemCompleted: completeItem(params); break;
          case CODEX_NOTIFICATION.agentMessageDelta: delta(params, "text"); break;
          case CODEX_NOTIFICATION.reasoningTextDelta: delta(params, "reasoning"); break;
          case CODEX_NOTIFICATION.reasoningSummaryTextDelta: delta(params, "summary"); break;
          case CODEX_NOTIFICATION.commandOutputDelta: delta(params, "command"); break;
          default: break;
        }
      } catch {
        // One malformed frame must never take the conversation down.
        return [];
      }
      return [...out];
    },
  };
}
