import { promises as fs } from "node:fs";
import path from "node:path";
import { claudeProjectDir } from "../claude/paths.js";
import { extractTextContent, parseSessionEntries } from "../claude/jsonl.js";
import type { SessionEntry } from "../claude/types.js";
import type { GuiBlock, GuiMessage } from "./types.js";

// Replaying an existing Claude session into the GUI chat. The Claude CLI's own JSONL transcript
// is the only record of a conversation that happened outside this app, so history is derived
// from it rather than stored twice. Parsing/classification is NOT re-done here — jsonl.ts already
// reads every line and tags it (User / Assistant / System / Progress); this module only maps
// those entries onto the GuiMessage shape the chat renders.

/**
 * Most-recent messages returned when the caller doesn't pass a limit. 200 matches the repo's
 * other "recent records" caps (store.listNotifications, git log) and keeps the one-shot history
 * frame bounded — real transcripts here run to several thousand entries, which would be a
 * multi-megabyte WebSocket message.
 */
export const DEFAULT_HISTORY_LIMIT = 200;

/** Resolve a Claude session id (scoped to a project folder) to its transcript path, or null. */
export async function transcriptPathFor(sessionId: string, folder: string): Promise<string | null> {
  // sessionIds are CLI-generated UUIDs. Anything carrying a separator would escape the project
  // dir once joined, so reject it up front — the same guard routes/claude.ts applies.
  if (!sessionId || sessionId.includes("/") || sessionId.includes("\\") || sessionId.includes("\0")) return null;

  const file = path.join(claudeProjectDir(folder), `${sessionId}.jsonl`);
  try {
    return (await fs.stat(file)).isFile() ? file : null;
  } catch {
    return null;
  }
}

/** Load a session's conversation as renderable GUI messages. Returns [] when there's no transcript. */
export async function loadHistory(
  sessionId: string, folder: string, limit = DEFAULT_HISTORY_LIMIT,
): Promise<GuiMessage[]> {
  if (limit <= 0) return []; // guard: slice(-0) would return the whole transcript
  const file = await transcriptPathFor(sessionId, folder);
  if (!file) return [];

  let entries: SessionEntry[];
  try {
    entries = await parseSessionEntries(file, "claude");
  } catch {
    return []; // deleted/unreadable between the stat and the read
  }

  const messages: GuiMessage[] = [];
  // tool_use blocks awaiting their result, keyed by the id the later tool_result arrives under.
  const pendingTools = new Map<string, Extract<GuiBlock, { kind: "tool" }>>();

  for (const entry of entries) {
    // Subagent turns are recorded in the same stream (older CLIs) or a sibling file (newer ones)
    // and carry isSidechain. Rendering them would interleave subagent narration into the main
    // thread, so they're dropped whole — including their tool traffic.
    if (entry.parsed.isSidechain === true) continue;

    const type = entry.parsed.type;
    const content = messageContentOf(entry);

    if (type === "user") {
      // Do this before the entryType gate: a tool_result carrier classifies as Progress, so the
      // results would be lost if we only looked at genuine human turns.
      applyToolResults(content, pendingTools);
      // jsonl.ts already decided which "user" turns are really the human — System covers
      // <system-reminder> and friends, Progress covers tool_result carriers.
      if (entry.entryType !== "User") continue;
      const text = extractTextContent(content).trim();
      if (!text) continue;
      messages.push({
        id: messageId(entry),
        role: "user",
        blocks: [{ kind: "text", id: blockId(entry, 0), text }],
        ts: timestampOf(entry),
      });
      continue;
    }

    if (type !== "assistant") continue;

    const blocks = assistantBlocks(entry, content, pendingTools);
    if (blocks.length === 0) continue; // nothing renderable (e.g. a redacted-thinking-only turn)
    messages.push({ id: messageId(entry), role: "assistant", blocks, ts: timestampOf(entry) });
  }

  // Keep the tail: a chat opens scrolled to the newest turn, and results were already attached
  // during the full walk, so trimming here can't orphan a tool block.
  return messages.length > limit ? messages.slice(-limit) : messages;
}

// --- internals ---

interface RawBlock {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
}

function messageContentOf(entry: SessionEntry): unknown {
  const message = entry.parsed.message as Record<string, unknown> | undefined;
  return message?.content;
}

/** Ids are derived from the line index so a reload of the same transcript renders stable keys. */
function messageId(entry: SessionEntry): string {
  return `h${entry.lineIndex}`;
}

function blockId(entry: SessionEntry, index: number): string {
  return `h${entry.lineIndex}_${index}`;
}

function timestampOf(entry: SessionEntry): number {
  const parsed = entry.timestamp ? Date.parse(entry.timestamp) : NaN;
  return Number.isNaN(parsed) ? 0 : parsed; // 0 = the transcript recorded no time for this entry
}

function assistantBlocks(
  entry: SessionEntry, content: unknown, pendingTools: Map<string, Extract<GuiBlock, { kind: "tool" }>>,
): GuiBlock[] {
  if (typeof content === "string") {
    const text = content.trim();
    return text ? [{ kind: "text", id: blockId(entry, 0), text }] : [];
  }
  if (!Array.isArray(content)) return [];

  const blocks: GuiBlock[] = [];
  content.forEach((raw: RawBlock, index) => {
    const id = blockId(entry, index);
    if (raw.type === "text") {
      const text = (raw.text ?? "").trim();
      if (text) blocks.push({ kind: "text", id, text });
      return;
    }
    if (raw.type === "thinking") {
      // Redacted/encrypted thinking arrives as an empty string plus a signature — nothing to show.
      const text = (raw.thinking ?? "").trim();
      if (text) blocks.push({ kind: "thinking", id, text });
      return;
    }
    if (raw.type === "tool_use" && typeof raw.id === "string") {
      const block: Extract<GuiBlock, { kind: "tool" }> = {
        kind: "tool",
        id,
        toolUseId: raw.id,
        name: raw.name ?? "",
        input: raw.input,
        status: "running", // upgraded in place when the matching tool_result turns up
      };
      pendingTools.set(raw.id, block);
      blocks.push(block);
    }
  });
  return blocks;
}

/** Fold every tool_result in a user entry into the tool block it belongs to. */
function applyToolResults(content: unknown, pendingTools: Map<string, Extract<GuiBlock, { kind: "tool" }>>): void {
  if (!Array.isArray(content)) return;
  for (const raw of content as RawBlock[]) {
    if (raw.type !== "tool_result" || typeof raw.tool_use_id !== "string") continue;
    const block = pendingTools.get(raw.tool_use_id);
    if (!block) continue; // orphan result (its tool_use was a skipped sidechain, or predates the file)
    block.status = raw.is_error ? "error" : "ok";
    block.result = extractTextContent(raw.content);
    pendingTools.delete(raw.tool_use_id);
  }
}
