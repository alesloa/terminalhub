// Pure helpers for the "Add to .gitignore" action. Kept free of I/O so they unit-test
// cleanly (the controller does the file read/write + the `git rm --cached`).

/**
 * The ignore line for a repo-relative path, anchored to the file the line lives in. A leading
 * "/" pins the match to that root (so `/dist/` ignores only the top-level dist, not nested
 * ones); a directory gets a trailing "/" so the rule matches the directory only.
 */
export function ignoreLine(rel: string, isDir: boolean): string {
  return "/" + rel + (isDir ? "/" : "");
}

/**
 * Append `line` to existing ignore-file content, on its own line with a trailing newline.
 * Returns `null` when that exact line is already present (compared trimmed), so the caller can
 * skip the write and report "already ignored".
 */
export function appendIgnoreLine(existing: string, line: string): string | null {
  const present = existing.split("\n").some(l => l.trim() === line);
  if (present) return null;
  const needsNl = existing.length > 0 && !existing.endsWith("\n");
  return existing + (needsNl ? "\n" : "") + line + "\n";
}
