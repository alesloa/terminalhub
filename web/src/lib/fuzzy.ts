// Fuzzy filename matching for the Explorer's "Filter Files" tab — VS Code "Go to File" feel.
// A query matches when its characters appear in order (a subsequence) anywhere in the target. The
// score rewards the matches a human means: a contiguous run, a hit right after a path separator
// (so "Phase" lands on PhaseStepper, not somewhere mid-word), and a match in the basename over a
// match buried in the folders. Higher score = better. Returns null when the query isn't a subsequence.

const SEP = /[\/\\._\- ]/; // a char after one of these starts a new "word" — worth a bonus

/** Score `query` against `target` (subsequence). Case-insensitive unless `caseSensitive`. null = no match. */
export function fuzzyScore(query: string, target: string, caseSensitive = false): number | null {
  if (!query) return 0;
  const q = caseSensitive ? query : query.toLowerCase();
  const t = caseSensitive ? target : target.toLowerCase();
  if (q.length > t.length) return null;

  let score = 0;
  let qi = 0;
  let run = 0;             // current contiguous-match streak
  let lastMatch = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += 10;
      if (lastMatch === ti - 1) { run++; score += run * 8; } else run = 0; // contiguous run bonus
      if (ti === 0 || SEP.test(t[ti - 1])) score += 12;                    // start-of-word bonus
      lastMatch = ti;
      qi++;
    }
  }
  if (qi < q.length) return null; // didn't consume the whole query → not a subsequence

  // Prefer matches that land in the basename and shorter targets overall (tie-breakers).
  const slash = Math.max(t.lastIndexOf("/"), t.lastIndexOf("\\"));
  if (lastMatch > slash) score += 20;
  score -= t.length * 0.1;
  return score;
}
