// Time-bucketing + fuzzy search for the Claude/Codex session list. Ported from the
// claude-session-explorer extension (searchService + the webview's bucket order) so the
// grouping matches: Pinned → Active → Today → Yesterday → This Week → Past Week → Older.

export type TimeBucket = "Today" | "Yesterday" | "This Week" | "Past Week" | "Older";

const TIME_ORDER: TimeBucket[] = ["Today", "Yesterday", "This Week", "Past Week", "Older"];

export function getTimeBucket(dateStr: string): TimeBucket {
  const date = new Date(dateStr);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86_400_000);
  const thisWeekStart = new Date(todayStart.getTime() - todayStart.getDay() * 86_400_000);
  const pastWeekStart = new Date(thisWeekStart.getTime() - 7 * 86_400_000);

  if (date >= todayStart) return "Today";
  if (date >= yesterdayStart) return "Yesterday";
  if (date >= thisWeekStart) return "This Week";
  if (date >= pastWeekStart) return "Past Week";
  return "Older";
}

export interface SessionBucket<T> { name: string; sessions: T[]; }

/**
 * Order sessions into display buckets. Pinned sessions float to the top, then anything
 * currently running ("Active"), then the rest grouped by last-modified time. Input order is
 * preserved within each bucket (callers pass sessions already sorted newest-first).
 */
export function bucketSessions<T extends { id: string; modified: string; isRunning: boolean }>(
  sessions: T[],
  pinnedIds: Set<string>,
): SessionBucket<T>[] {
  const pinned = sessions.filter((s) => pinnedIds.has(s.id));
  const rest = sessions.filter((s) => !pinnedIds.has(s.id));
  const active = rest.filter((s) => s.isRunning);
  const idle = rest.filter((s) => !s.isRunning);

  const out: SessionBucket<T>[] = [];
  if (pinned.length) out.push({ name: "Pinned", sessions: pinned });
  if (active.length) out.push({ name: "Active", sessions: active });

  const byTime = new Map<TimeBucket, T[]>();
  for (const s of idle) {
    const b = getTimeBucket(s.modified);
    (byTime.get(b) ?? byTime.set(b, []).get(b)!).push(s);
  }
  for (const name of TIME_ORDER) {
    const group = byTime.get(name);
    if (group?.length) out.push({ name, sessions: group });
  }
  return out;
}

/**
 * Fuzzy match: every char of `query` must appear in order in `target`. Returns a score
 * (lower = better, sum of gaps between matched positions) or -1 for no match.
 */
export function fuzzyMatch(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0, score = 0, lastMatch = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      if (lastMatch >= 0) score += ti - lastMatch - 1;
      lastMatch = ti;
      qi++;
    }
  }
  return qi === q.length ? score : -1;
}

/** Filter + rank sessions by fuzzy title match. Empty query returns the input unchanged. */
export function filterSessions<T extends { title: string }>(sessions: T[], query: string, maxResults = 200): T[] {
  if (!query.trim()) return sessions;
  return sessions
    .map((session) => ({ session, score: fuzzyMatch(query, session.title) }))
    .filter((s) => s.score >= 0)
    .sort((a, b) => a.score - b.score)
    .slice(0, maxResults)
    .map((s) => s.session);
}
