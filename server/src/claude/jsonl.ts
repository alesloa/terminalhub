import { createReadStream, statSync } from "node:fs";
import readline from "node:readline";
import type { AgentType, EntryType, ParsedMessage, SessionEntry } from "./types.js";

// JSONL transcript parsing for both CLIs. Every line is one event; we classify each into a
// coarse EntryType and pull a short text preview. mtime-keyed cache avoids re-reading
// unchanged files. Ported verbatim from the extension so classification matches exactly.

interface CacheEntry { mtime: number; entries: SessionEntry[]; }
const cache = new Map<string, CacheEntry>();

/** Drop a file's cached parse — call after any write-back so the next read is fresh. */
export function invalidateCache(filePath: string): void {
  cache.delete(filePath);
}

// Markers the CLIs inject into "user" turns that are really system/tool noise, not the human.
const SYSTEM_MARKERS = ["<environment_context>", "<INSTRUCTIONS>", "SKILL.md", "<system-reminder>"];

/** Classify a parsed JSONL entry into an EntryType. */
export function classifyEntry(parsed: Record<string, unknown>, agentType: AgentType): EntryType {
  const type = parsed.type as string | undefined;

  if (agentType === "claude") {
    if (type === "system") return "System";
    if (type === "attachment") return "System";
    if (type === "permission-mode" || type === "file-history-snapshot" || type === "last-prompt") return "Other";
    if (type === "progress") return "Progress";

    if (type === "user") {
      const content = (parsed.message as Record<string, unknown>)?.content;
      const text = extractTextContent(content);
      if (text && SYSTEM_MARKERS.some((m) => text.includes(m))) return "System";
      if (Array.isArray(content)) {
        const hasToolResult = content.some((b: Record<string, unknown>) => b.type === "tool_result");
        if (hasToolResult) return "Progress";
      }
      return "User";
    }

    if (type === "assistant") {
      const content = (parsed.message as Record<string, unknown>)?.content;
      if (Array.isArray(content)) {
        const hasText = content.some((b: Record<string, unknown>) => b.type === "text");
        const hasToolUse = content.some((b: Record<string, unknown>) => b.type === "tool_use");
        if (hasToolUse && !hasText) return "Progress"; // tool-only turn
      }
      return "Assistant";
    }

    return "Other";
  }

  // codex
  if (type === "session_meta" || type === "turn_context") return "System";
  if (type === "response_item") {
    const role = (parsed.payload as Record<string, unknown>)?.role as string | undefined;
    if (role === "user") return "User";
    if (role === "assistant") return "Assistant";
    if (role === "developer") return "System";
    return "Other";
  }
  return "Other";
}

/** Pull plain text out of a message content field (string, or array of typed blocks). */
export function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: Record<string, unknown>) =>
        (b.type === "text" || b.type === "input_text" || b.type === "output_text") &&
        typeof (b.text || b.input_text || b.output_text) === "string")
      .map((b: Record<string, unknown>) =>
        (b.text as string) || (b.input_text as string) || (b.output_text as string) || "")
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/** A <=200 char single-line preview of an entry. */
export function extractPreview(parsed: Record<string, unknown>, entryType: EntryType, agentType: AgentType): string {
  let text = "";

  if (agentType === "claude") {
    const message = parsed.message as Record<string, unknown> | undefined;
    if (message?.content) text = extractTextContent(message.content);

    if (entryType === "Progress" && parsed.data) {
      const data = parsed.data as Record<string, unknown>;
      const toolType = data.type as string | undefined;
      const output = data.output as string | undefined;
      if (toolType) text = `[${toolType}]${output ? ": " + output : ""}`;
    }
    if (entryType === "System" && parsed.subtype) text = `[${parsed.subtype as string}]`;
  } else {
    const payload = parsed.payload as Record<string, unknown> | undefined;
    if (payload?.content) text = extractTextContent(payload.content);
    if (payload?.cwd && !text) text = `cwd: ${payload.cwd as string}`;
  }

  if (!text) {
    const type = parsed.type as string | undefined;
    text = type ? `[${type}]` : "[unknown]";
  }

  text = text.replace(/\s+/g, " ").trim();
  if (text.length > 200) text = text.substring(0, 197) + "...";
  return text;
}

/** Parse EVERY line (including System/Progress/Other), preserving rawLine for write-back. */
export async function parseSessionEntries(filePath: string, agentType: AgentType): Promise<SessionEntry[]> {
  const mtime = statSync(filePath).mtimeMs;
  const cached = cache.get(filePath);
  if (cached && cached.mtime === mtime) return cached.entries;

  const entries: SessionEntry[] = [];
  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let lineIndex = 0;

  for await (const line of rl) {
    if (!line.trim()) { lineIndex++; continue; }
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const entryType = classifyEntry(parsed, agentType);
      entries.push({
        lineIndex,
        rawLine: line,
        entryType,
        preview: extractPreview(parsed, entryType, agentType),
        timestamp: (parsed.timestamp as string) || undefined,
        uuid: (parsed.uuid as string) || undefined,
        parsed,
      });
    } catch {
      // keep malformed lines as Other so write-back never drops data
      entries.push({ lineIndex, rawLine: line, entryType: "Other", preview: "[malformed JSON]", parsed: {} });
    }
    lineIndex++;
  }

  cache.set(filePath, { mtime, entries });
  return entries;
}

function extractFullText(entry: SessionEntry): string {
  const message = entry.parsed.message as Record<string, unknown> | undefined;
  if (message?.content) return extractTextContent(message.content);
  const payload = entry.parsed.payload as Record<string, unknown> | undefined;
  if (payload?.content) return extractTextContent(payload.content);
  return "";
}

function entriesToMessages(entries: SessionEntry[]): ParsedMessage[] {
  const messages: ParsedMessage[] = [];
  for (const entry of entries) {
    if (entry.entryType === "User" || entry.entryType === "Assistant") {
      const text = extractFullText(entry);
      if (text) messages.push({ role: entry.entryType === "User" ? "user" : "assistant", content: text });
    }
  }
  return messages;
}

/** Paginated user/assistant messages for the transcript detail view. */
export async function parseSessionMessages(
  filePath: string, agentType: AgentType, limit = 50, offset = 0,
): Promise<{ messages: ParsedMessage[]; total: number }> {
  const all = entriesToMessages(await parseSessionEntries(filePath, agentType));
  return { messages: all.slice(offset, offset + limit), total: all.length };
}

/** First genuine user message, used as a title fallback. Early-exits after ~50 lines. */
export async function getFirstUserMessage(filePath: string, agentType: AgentType): Promise<string | undefined> {
  const cached = cache.get(filePath);
  if (cached && cached.mtime === statSync(filePath).mtimeMs) {
    const firstUser = cached.entries.find((e) => e.entryType === "User");
    if (firstUser) {
      const text = extractFullText(firstUser);
      return text ? text.replace(/\s+/g, " ").trim().substring(0, 120) : undefined;
    }
    return undefined;
  }

  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let linesRead = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    if (++linesRead > 50) break;
    try {
      const obj = JSON.parse(line);
      if (agentType === "claude") {
        if (obj.type === "user" && obj.message?.content) {
          const text = extractTextContent(obj.message.content);
          if (text && !SYSTEM_MARKERS.some((m) => text.includes(m))) {
            rl.close(); stream.destroy();
            return text.replace(/\s+/g, " ").trim().substring(0, 120);
          }
        }
      } else if (obj.type === "response_item" && obj.payload?.role === "user" && obj.payload?.content) {
        const content = obj.payload.content;
        if (Array.isArray(content)) {
          const text = content
            .map((c: Record<string, unknown>) => (c.text as string) || (c.input_text as string) || "")
            .filter(Boolean).join("\n");
          if (text) {
            rl.close(); stream.destroy();
            return text.replace(/\s+/g, " ").trim().substring(0, 120);
          }
        }
      }
    } catch {
      // skip malformed lines
    }
  }
  return undefined;
}
