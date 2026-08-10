// The `@file` and `/command` menus behind the composer. Kept as pure functions so the trigger rules
// are one thing to reason about instead of being spread through keydown handlers.

export type MentionKind = "file" | "command";

export interface MentionQuery {
  kind: MentionKind;
  /** Index of the trigger character in the text. */
  start: number;
  /** What has been typed after the trigger, lowercased for matching. */
  query: string;
}

/** Whether a trigger at `index` starts a mention: only at the very start of the box or straight
 *  after whitespace. Without this an email address or a path would open the menu mid-word. */
function isTriggerPosition(text: string, index: number): boolean {
  if (index === 0) return true;
  return /\s/.test(text[index - 1]);
}

/**
 * The mention being typed at the caret, or null. A space ends it — file paths with spaces are rare
 * enough that keeping the menu open across one would cost more than it saves.
 *
 * `/` only counts at the very start of the message: a slash command IS the message, and matching it
 * anywhere would turn every URL into a command menu.
 */
export function mentionAt(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  const slash = before.lastIndexOf("/");

  if (at >= 0 && isTriggerPosition(text, at)) {
    const query = before.slice(at + 1);
    if (!/\s/.test(query)) return { kind: "file", start: at, query: query.toLowerCase() };
  }
  if (slash === 0) {
    const query = before.slice(1);
    if (!/\s/.test(query)) return { kind: "command", start: 0, query: query.toLowerCase() };
  }
  return null;
}

/** Replace the mention span with `value`, leaving the caret after a trailing space. */
export function applyMention(text: string, mention: MentionQuery, caret: number, value: string): {
  text: string; caret: number;
} {
  const next = `${text.slice(0, mention.start)}${value} ${text.slice(caret)}`;
  return { text: next, caret: mention.start + value.length + 1 };
}

/** Subsequence match, the same forgiving rule an editor's file switcher uses: "wsc" finds
 *  "web/src/components". Returns false when a character can't be found in order. */
export function fuzzyMatches(haystack: string, needle: string): boolean {
  if (!needle) return true;
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i += 1;
    if (i === needle.length) return true;
  }
  return false;
}

/** Rank matches so the ones that read as intentional come first: a hit in the file name beats one
 *  buried in a directory, and shorter paths beat longer ones at the same quality. */
export function rankPaths(paths: string[], query: string, limit: number): string[] {
  if (!query) return paths.slice(0, limit);
  const scored: { path: string; score: number }[] = [];
  for (const path of paths) {
    const lower = path.toLowerCase();
    const name = lower.slice(lower.lastIndexOf("/") + 1);
    let score: number;
    if (name.startsWith(query)) score = 0;
    else if (name.includes(query)) score = 1;
    else if (lower.includes(query)) score = 2;
    else if (fuzzyMatches(lower, query)) score = 3;
    else continue;
    scored.push({ path, score });
    if (scored.length > limit * 20) break; // a huge repo shouldn't pay to rank every file
  }
  scored.sort((a, b) => a.score - b.score || a.path.length - b.path.length);
  return scored.slice(0, limit).map((s) => s.path);
}
