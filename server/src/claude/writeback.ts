import { promises as fs } from "node:fs";
import { randomUUID, randomBytes } from "node:crypto";
import type { AgentType, EntryType, SessionEntry } from "./types.js";
import { parseSessionEntries, invalidateCache } from "./jsonl.js";

// Entry-editor write-back: delete line ranges (with parentUuid chain repair for Claude, and
// call_id pair expansion for Codex) and replace a range with a single summary entry. Ported from
// claude-session-explorer/src/services/writeBackService.ts.

// Inheritable fields that are constant across all entries in a Claude session. Used to fabricate
// a synthetic summary entry the CLI accepts.
const INHERITABLE_FIELDS = [
  "sessionId",
  "cwd",
  "entrypoint",
  "gitBranch",
  "slug",
  "version",
  "userType",
  "isSidechain",
] as const;

/** Walk backwards through entries to find the last uuid before the given lineIndex. */
function findParentUuid(entries: SessionEntry[], beforeIndex: number): string | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.lineIndex >= beforeIndex) continue;
    const u = e.parsed.uuid;
    if (typeof u === "string" && u.length > 0) return u;
  }
  return undefined;
}

/** Collect inheritable metadata by walking backwards through entries. */
function collectInheritedFields(entries: SessionEntry[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = entries.length - 1; i >= 0; i--) {
    const p = entries[i].parsed;
    for (const f of INHERITABLE_FIELDS) {
      if (!(f in out) && f in p) out[f] = p[f];
    }
  }
  return out;
}

/** Re-serialize an entry after mutating its parsed object. */
function reserializeEntry(entry: SessionEntry): SessionEntry {
  return { ...entry, rawLine: JSON.stringify(entry.parsed) };
}

/**
 * Codex pairs every function_call with a matching function_call_output via the call_id field. If a
 * deletion splits a pair, the surviving side becomes an orphan that can confuse Codex on resume.
 * Expand the [first..last] range outward until no call_id pair crosses either boundary. Safe no-op
 * for Claude sessions (no payload.call_id).
 */
export function expandCodexRangeForPairs(
  allEntries: SessionEntry[],
  firstLineIndex: number,
  lastLineIndex: number,
): { firstLineIndex: number; lastLineIndex: number } {
  let first = firstLineIndex;
  let last = lastLineIndex;

  const byCallId = new Map<string, number[]>();
  for (const e of allEntries) {
    const payload = e.parsed.payload as Record<string, unknown> | undefined;
    if (!payload) continue;
    const t = payload.type;
    if (t !== "function_call" && t !== "function_call_output") continue;
    const cid = payload.call_id;
    if (typeof cid !== "string") continue;
    const arr = byCallId.get(cid) ?? [];
    arr.push(e.lineIndex);
    byCallId.set(cid, arr);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [, lines] of byCallId) {
      if (lines.length < 2) continue;
      const min = Math.min(...lines);
      const max = Math.max(...lines);
      const anyInside = lines.some((l) => l >= first && l <= last);
      if (!anyInside) continue;
      if (min < first) {
        first = min;
        changed = true;
      }
      if (max > last) {
        last = max;
        changed = true;
      }
    }
  }

  return { firstLineIndex: first, lastLineIndex: last };
}

/**
 * Repair the conversation tree: for every surviving entry whose parentUuid points to a deleted
 * uuid, rewrite parentUuid to the nearest non-deleted ancestor (walking up the original chain). If
 * no live ancestor exists, set parentUuid to null (becomes a new root). A redirectMap lets a
 * deleted uuid be repointed to a replacement (e.g. a summary entry).
 */
function repairChain(
  original: SessionEntry[],
  surviving: SessionEntry[],
  deletedUuids: Set<string>,
  redirectMap?: Map<string, string>,
): SessionEntry[] {
  const parentOf = new Map<string, string | null>();
  for (const e of original) {
    const u = e.parsed.uuid;
    if (typeof u === "string") {
      const p = e.parsed.parentUuid;
      parentOf.set(u, typeof p === "string" ? p : null);
    }
  }

  const resolve = (uuid: string | null): string | null => {
    let cur = uuid;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      if (redirectMap?.has(cur)) return redirectMap.get(cur) ?? null;
      if (!deletedUuids.has(cur)) return cur;
      cur = parentOf.get(cur) ?? null;
    }
    return null;
  };

  return surviving.map((e) => {
    const pu = e.parsed.parentUuid;
    if (typeof pu !== "string") return e;
    const repaired = resolve(pu);
    if (repaired === pu) return e;
    const newParsed = { ...e.parsed, parentUuid: repaired };
    return reserializeEntry({ ...e, parsed: newParsed });
  });
}

/** Atomic write (temp file + rename) of entries by rawLine, then invalidate the parse cache. */
async function writeEntries(filePath: string, entries: SessionEntry[]): Promise<void> {
  const content = entries.map((e) => e.rawLine).join("\n") + "\n";
  const tmpPath = filePath + ".tmp." + randomBytes(4).toString("hex");
  await fs.writeFile(tmpPath, content, "utf-8");
  await fs.rename(tmpPath, filePath);
  invalidateCache(filePath);
}

/** True when this is a Codex transcript (response_item lines, no Claude tree). */
function isCodexTranscript(entries: SessionEntry[]): boolean {
  return entries.some((e) => e.parsed.type === "response_item");
}

/**
 * Delete the given inclusive line ranges from a JSONL transcript, repairing the parentUuid chain
 * (Claude) so the CLI can still walk the tree on resume. For Codex, each range is expanded so no
 * function_call / function_call_output pair is split across a boundary. Writes back atomically and
 * invalidates the cache. Returns how many lines were removed.
 */
export async function deleteEntries(
  jsonlPath: string,
  agent: AgentType,
  ranges: [number, number][],
): Promise<{ removed: number }> {
  const allEntries = await parseSessionEntries(jsonlPath, agent);
  const codex = isCodexTranscript(allEntries);

  // Build the set of line indexes to delete, expanding each Codex range to keep call_id pairs whole.
  const toDelete = new Set<number>();
  for (const [start, end] of ranges) {
    let first = Math.min(start, end);
    let last = Math.max(start, end);
    if (codex) {
      const expanded = expandCodexRangeForPairs(allEntries, first, last);
      first = expanded.firstLineIndex;
      last = expanded.lastLineIndex;
    }
    for (const e of allEntries) {
      if (e.lineIndex >= first && e.lineIndex <= last) toDelete.add(e.lineIndex);
    }
  }

  const deletedUuids = new Set<string>();
  for (const e of allEntries) {
    if (toDelete.has(e.lineIndex)) {
      const u = e.parsed.uuid;
      if (typeof u === "string") deletedUuids.add(u);
    }
  }

  const surviving = allEntries.filter((e) => !toDelete.has(e.lineIndex));
  const repaired = repairChain(allEntries, surviving, deletedUuids);
  await writeEntries(jsonlPath, repaired);
  return { removed: toDelete.size };
}

/**
 * Replace the inclusive [startLine..endLine] range with a single fabricated summary entry, then
 * repair the tree so children of the deleted range point at the summary. For Codex the range is
 * first expanded so no call_id pair is split. Writes back atomically and invalidates the cache.
 */
export async function replaceRangeWithSummary(
  jsonlPath: string,
  agent: AgentType,
  startLine: number,
  endLine: number,
  summaryText: string,
): Promise<void> {
  const allEntries = await parseSessionEntries(jsonlPath, agent);

  let firstLineIndex = Math.min(startLine, endLine);
  let lastLineIndex = Math.max(startLine, endLine);

  // Codex: extend the range so no function_call / function_call_output pair is split (no-op for Claude).
  const expanded = expandCodexRangeForPairs(allEntries, firstLineIndex, lastLineIndex);
  firstLineIndex = expanded.firstLineIndex;
  lastLineIndex = expanded.lastLineIndex;

  const before = allEntries.filter((e) => e.lineIndex < firstLineIndex);
  const after = allEntries.filter((e) => e.lineIndex > lastLineIndex);
  const deleted = allEntries.filter((e) => e.lineIndex >= firstLineIndex && e.lineIndex <= lastLineIndex);

  const deletedUuids = new Set<string>();
  for (const e of deleted) {
    const u = e.parsed.uuid;
    if (typeof u === "string") deletedUuids.add(u);
  }

  const isCodex = isCodexTranscript(allEntries);

  let summaryParsed: Record<string, unknown>;
  let newUuid: string;

  if (isCodex) {
    // Codex summary: response_item with role=assistant, no uuid/parentUuid.
    newUuid = randomUUID();
    summaryParsed = {
      timestamp: new Date().toISOString(),
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: `**Conversation Summary**\n\n${summaryText}` }],
      },
    };
  } else {
    // Claude summary: full tree wiring.
    const inherited = collectInheritedFields(before.length > 0 ? before : allEntries);
    const parentUuid = findParentUuid(allEntries, firstLineIndex);
    newUuid = randomUUID();
    summaryParsed = {
      ...inherited,
      type: "assistant",
      uuid: newUuid,
      parentUuid: parentUuid ?? null,
      timestamp: new Date().toISOString(),
      message: {
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: `**Conversation Summary**\n\n${summaryText}` }],
      },
    };
  }

  const cleaned = summaryText.replace(/\s+/g, " ").trim();
  const summaryEntry: SessionEntry = {
    lineIndex: firstLineIndex, // logical position; actual order is by array order when writing
    rawLine: JSON.stringify(summaryParsed),
    entryType: "Assistant" as EntryType,
    preview: cleaned.length > 200 ? cleaned.substring(0, 197) + "..." : cleaned,
    timestamp: summaryParsed.timestamp as string,
    uuid: newUuid,
    parsed: summaryParsed,
  };

  // Children of deleted entries get redirected to the summary's uuid.
  const redirectMap = new Map<string, string>();
  for (const u of deletedUuids) redirectMap.set(u, newUuid);
  const repairedAfter = repairChain(allEntries, after, deletedUuids, redirectMap);

  await writeEntries(jsonlPath, [...before, summaryEntry, ...repairedAfter]);
}
