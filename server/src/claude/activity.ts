import { promises as fs } from "node:fs";
import path from "node:path";

// Real-time activity detection for running Claude/Codex sessions. Ported from the
// claude-session-explorer webview provider's computeSessionState + marker-file mechanism.
// computeSessionState reads only the JSONL tail and classifies the latest user/assistant
// entry into active | waiting | idle. The amber "waiting for permission" state actually comes
// from marker files the Claude Code Notification hook drops in MARKER_DIR — the tool_use entry
// isn't always flushed to disk before the prompt fires, so the tail alone can't see it.

/** Directory the Claude Code Notification hook writes marker files into.
 *  Filename format: attention-<sessionId>. Presence means "waiting for user". */
export const MARKER_DIR = "/tmp/claude-session-explorer";
export const MARKER_PREFIX = "attention-";

/** A user-ending or null-stop state this long without a response → treat as idle. */
export const STALE_THRESHOLD_MS = 120_000;

/** How much of the JSONL tail to scan when classifying state. */
const TAIL_BYTES = 65_536;

const INTERRUPT_REGEX =
  /doesn't want to proceed|interrupted by user|tool use was rejected|Request interrupted/i;

/**
 * True if a user-message `content` value carries an "I pressed Escape" marker. Claude Code
 * writes either a tool_result with is_error=true (on tool rejection) or a free-text
 * "[Request interrupted by user…]" entry.
 */
function isInterruptContent(content: unknown): boolean {
  if (Array.isArray(content)) {
    return content.some((c) => {
      if (!c || typeof c !== "object") return false;
      const ct = (c as Record<string, unknown>).type;
      if (ct === "tool_result") {
        if ((c as Record<string, unknown>).is_error === true) return true;
        const body = (c as Record<string, unknown>).content;
        const text = typeof body === "string" ? body : "";
        return INTERRUPT_REGEX.test(text);
      }
      if (ct === "text") {
        const text = (c as Record<string, unknown>).text;
        return typeof text === "string" && INTERRUPT_REGEX.test(text);
      }
      return false;
    });
  }
  if (typeof content === "string") return INTERRUPT_REGEX.test(content);
  return false;
}

/** Read the tail of a file (last `bytes` bytes) as UTF-8 text. */
export async function readTail(filePath: string, bytes = TAIL_BYTES): Promise<string> {
  try {
    const stat = await fs.stat(filePath);
    const readSize = Math.min(stat.size, bytes);
    const fh = await fs.open(filePath, "r");
    try {
      const buffer = Buffer.alloc(readSize);
      await fh.read(buffer, 0, readSize, Math.max(0, stat.size - readSize));
      return buffer.toString("utf-8");
    } finally {
      await fh.close();
    }
  } catch {
    return "";
  }
}

/**
 * Walk the JSONL tail backward, find the last real user/assistant entry, and classify state:
 *   system turn_duration / stop_hook_summary → idle
 *   user with interrupt marker               → idle
 *   user (prompt or ok tool_result)          → active  (Claude is processing)
 *   assistant stop_reason = end_turn         → idle
 *   assistant stop_reason = tool_use / null  → active if idle < STALE, else idle
 *
 * The "waiting" (amber) state is supplied separately by the marker-file scan, not by the tail.
 */
export async function computeSessionState(jsonlPath: string): Promise<"active" | "waiting" | "idle"> {
  const tail = await readTail(jsonlPath);
  const lines = tail.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return "idle";

  const now = Date.now();

  for (let i = lines.length - 1; i >= 0; i--) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(lines[i]) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = entry.type;

    if (type === "system" && (entry.subtype === "turn_duration" || entry.subtype === "stop_hook_summary")) {
      return "idle";
    }

    if (type !== "user" && type !== "assistant") continue;

    const ts = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : NaN;
    const idleMs = Number.isFinite(ts) ? now - ts : 0;

    const message = (entry.message as Record<string, unknown> | undefined) ?? {};

    if (type === "user") {
      if (isInterruptContent(message.content)) return "idle";
      if (idleMs > STALE_THRESHOLD_MS) return "idle";
      return "active";
    }

    // assistant
    const sr = message.stop_reason;
    if (sr === "end_turn") return "idle";
    if (sr === "tool_use" || sr === null || sr === undefined) {
      return idleMs >= STALE_THRESHOLD_MS ? "idle" : "active";
    }
    return "idle";
  }

  return "idle";
}

/**
 * Snapshot MARKER_DIR and return the set of session ids that have an attention marker
 * (waiting for user input / permission). Tolerates the directory being absent.
 */
export async function scanMarkerFiles(): Promise<Set<string>> {
  const waiting = new Set<string>();
  let names: string[];
  try {
    names = await fs.readdir(MARKER_DIR);
  } catch {
    return waiting;
  }
  for (const n of names) {
    if (n.startsWith(MARKER_PREFIX)) waiting.add(n.slice(MARKER_PREFIX.length));
  }
  return waiting;
}

/** Remove a session's attention marker (e.g. when the user opens its terminal). */
export async function clearMarkerFile(sessionId: string): Promise<void> {
  try {
    await fs.unlink(path.join(MARKER_DIR, MARKER_PREFIX + sessionId));
  } catch {
    // no marker present — fine
  }
}
