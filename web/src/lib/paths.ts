// Tiny path helpers — the host sends absolute forward-slash paths (server normalises Windows
// backslashes before sending). Windows drive-letter paths ("D:/...") are supported alongside POSIX.

export function basename(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  const i = trimmed.lastIndexOf("/");
  return i === -1 ? trimmed : trimmed.slice(i + 1);
}

export function dirname(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  const i = trimmed.lastIndexOf("/");
  // Windows drive root after trimming trailing slash: "D:" — go up to volumes list.
  if (/^[A-Za-z]:$/.test(trimmed)) return "/";
  // One level above drive root: "D:/Documents" → i===2 → keep "D:/" (include the slash).
  if (i === 2 && /^[A-Za-z]:\//.test(trimmed)) return trimmed.slice(0, 3);
  return i <= 0 ? "/" : trimmed.slice(0, i);
}

export function join(dir: string, name: string): string {
  return dir.replace(/\/+$/, "") + "/" + name;
}

/** Split "foo.test.ts" into ["foo.test", ".ts"] / "Makefile" into ["Makefile", ""]. A leading
 *  dot (".gitignore") is treated as the whole name, not an extension. */
export function splitExt(name: string): [string, string] {
  const i = name.lastIndexOf(".");
  if (i <= 0) return [name, ""]; // no dot, or dotfile like ".env"
  return [name.slice(0, i), name.slice(i)];
}

/** Path relative to root ("/a/b/c.ts" under "/a" → "b/c.ts"); falls back to the abs path. */
export function relativeTo(abs: string, root: string): string {
  return abs.startsWith(root + "/") ? abs.slice(root.length + 1) : abs;
}

/** Single-quote a path for the shell — ALWAYS, so a dropped/pasted path goes in as one safe
 *  argument regardless of spaces, parens, $, &, etc. An embedded ' becomes the POSIX '\'' dance. */
export function shellQuote(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

/** "report.txt" with {report.txt} taken → "report copy.txt", then "report copy 2.txt". Used by
 *  paste, duplicate, upload, and drag-move so a new leaf never clobbers one already in the dir. */
export function dedupeName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const [base, ext] = splitExt(name);
  let candidate = `${base} copy${ext}`;
  for (let n = 2; taken.has(candidate); n++) candidate = `${base} copy ${n}${ext}`;
  return candidate;
}
