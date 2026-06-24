import { readdir, readFile as fsReadFile, writeFile as fsWriteFile, stat } from "node:fs/promises";
import { join, resolve, relative, basename } from "node:path";

/** Find-in-files (VS Code "Search" panel). Walks a folder, matches each line against the query,
 *  and returns hits grouped by file. A companion replace applies edits by exact byte offset so the
 *  file's content — including its original line endings — is preserved untouched outside the match. */

export interface SearchOpts {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regexp?: boolean;
  include?: string;        // comma-separated globs; empty = all files
  exclude?: string;        // comma-separated globs; empty = none
  excludeBuild?: boolean;  // skip build/dependency folders (node_modules, dist, .next, …). Default true.
  excludeSystem?: boolean; // skip system folders (.git, .vscode, .idea, …). Default true.
}

/** One match within a file. `col` is the 0-based column in the FULL line (what the editor jumps to
 *  and what replace targets). `text` is the line clipped for display; `matchStart` is the match's
 *  index within that clipped text (== col unless a long line was windowed). */
export interface SearchMatch {
  line: number;       // 1-based
  col: number;        // 0-based, full line
  length: number;
  text: string;       // display line (clipped)
  matchStart: number; // match index within `text`
}
export interface SearchFileResult { path: string; name: string; matches: SearchMatch[]; }
export interface SearchResponse {
  results: SearchFileResult[];
  total: number;      // total matches across all files
  fileCount: number;
  truncated: boolean; // hit a cap; results are partial
  error?: string;     // e.g. invalid regular expression
}

// Default-excluded directories, in two toggleable groups. Build/dependency output and system
// folders nobody usually wants in find-in-files; each group is skipped by default (excludeBuild /
// excludeSystem) but can be turned off, and an explicit include glob (e.g. `node_modules/**`)
// opts a single folder back in. A user exclude glob still prunes regardless of these toggles.
const BUILD_DIRS = new Set([
  "node_modules", "bower_components", "dist", "build", "out", "target", "vendor", "coverage",
  ".next", ".nuxt", ".svelte-kit", ".output", ".turbo", ".cache", ".parcel-cache", ".vite",
  ".gradle", ".dart_tool", "__pycache__", ".venv", "venv",
]);
const SYSTEM_DIRS = new Set([".git", ".hg", ".svn", ".idea", ".vscode"]);
const MAX_FILE_BYTES = 5 * 1024 * 1024; // skip files larger than this
const BINARY_SNIFF_BYTES = 8192;
const MAX_TOTAL_MATCHES = 5000;         // stop the whole search past this many hits
const MAX_MATCHES_PER_FILE = 1000;
const MAX_FILES_SCANNED = 50000;
const MAX_LINE_CHARS = 1000;            // clip the display line; jump/replace still use the real col
const LINE_WINDOW_LEAD = 80;            // chars of context kept before a match in a clipped long line

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build the matcher shared by search + replace. Returns null on an invalid regex or empty query. */
export function buildRegex(query: string, opts: SearchOpts): RegExp | null {
  if (!query) return null;
  let pattern = opts.regexp ? query : escapeRe(query);
  if (opts.wholeWord) pattern = `\\b(?:${pattern})\\b`;
  try {
    return new RegExp(pattern, "g" + (opts.caseSensitive ? "" : "i"));
  } catch {
    return null;
  }
}

/** Translate one glob into an anchored RegExp matched against a file's path relative to the root.
 *  Supports `*` (within a segment), `**` (any depth), `?`, and `{a,b}` alternation. A pattern with
 *  no slash matches at any depth (so `*.ts` finds every .ts file), mirroring VS Code. */
function globToRe(glob: string): RegExp {
  const g = glob.replace(/\\/g, "/").replace(/^\.\//, "");
  const hasSlash = g.includes("/");
  let re = "";
  let braces = 0;
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*") {
      if (g[i + 1] === "*") {
        i++;
        if (g[i + 1] === "/") { i++; re += "(?:.*/)?"; } // **/  → zero or more dirs
        else re += ".*";                                  // **   → anything
      } else {
        re += "[^/]*";                                    // *    → within one segment
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (c === "{") { braces++; re += "(?:"; }
    else if (c === "}") { braces = Math.max(0, braces - 1); re += ")"; }
    else if (c === "," && braces > 0) { re += "|"; }
    else re += escapeRe(c);
  }
  const body = hasSlash ? re : `(?:.*/)?${re}`;
  return new RegExp(`^${body}$`);
}

function compileGlobs(spec?: string): RegExp[] | null {
  if (!spec) return null;
  const parts = spec.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts.map(globToRe) : null;
}

const matchesAny = (res: RegExp[], rel: string) => res.some((r) => r.test(rel));

/** Literal (wildcard-free) path segments named in the include globs. These are the folders the user
 *  explicitly opted into (e.g. `node_modules/**` → "node_modules"), so default exclusion skips them. */
function includeDirNames(spec?: string): Set<string> {
  const names = new Set<string>();
  if (!spec) return names;
  for (const part of spec.split(",")) {
    for (const seg of part.replace(/\\/g, "/").split("/")) {
      const s = seg.trim();
      if (s && !/[*?{}]/.test(s)) names.add(s);
    }
  }
  return names;
}

/** A raw match with absolute byte offsets — the basis for both display and offset-splice replace. */
interface RawMatch { line: number; col: number; length: number; start: number; end: number; lineText: string; }

/** Scan file content line by line, recording every non-empty match with its correct 1-based line
 *  number and absolute byte offsets in the ORIGINAL content. Matching is per-line (VS Code's default),
 *  so a match never spans a newline. Shared by search (display) and replace (offset splice). */
export function scanLines(content: string, re: RegExp, cap = MAX_MATCHES_PER_FILE): RawMatch[] {
  const out: RawMatch[] = [];
  const lines = content.split("\n");
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineStart = offset;
    const raw = lines[i];
    offset += raw.length + 1; // + the "\n" the split consumed
    // A CRLF file leaves a trailing "\r"; drop it so `$`/`.*` anchor before the EOL, like an editor.
    const lineText = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lineText)) !== null) {
      if (m[0] === "") { re.lastIndex++; continue; } // zero-width match: advance or loop forever
      out.push({ line: i + 1, col: m.index, length: m[0].length, start: lineStart + m.index, end: lineStart + m.index + m[0].length, lineText });
      if (out.length >= cap) return out;
    }
  }
  return out;
}

/** Clip a long display line to a window around the match so a 10k-char minified line doesn't ship
 *  whole. Returns the display text and the match's start index within it. */
function clipLine(lineText: string, col: number, length: number): { text: string; matchStart: number } {
  if (lineText.length <= MAX_LINE_CHARS) return { text: lineText, matchStart: col };
  const start = Math.max(0, col - LINE_WINDOW_LEAD);
  const lead = start > 0 ? "…" : "";
  const text = lead + lineText.slice(start, start + MAX_LINE_CHARS);
  return { text, matchStart: lead.length + (col - start) };
}

/** Walk every file under `dir`, pruning whole directory subtrees for which `skipDir` returns true
 *  (`rel` = the directory's path relative to `base`, `name` = its basename). Pruning at the walk —
 *  not just filtering files — is what makes excluding a folder like `.next` actually skip its tree. */
export async function* walkFiles(
  dir: string,
  base: string = dir,
  skipDir: (rel: string, name: string) => boolean = () => false,
): AsyncGenerator<string> {
  let dirents;
  try { dirents = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const d of dirents) {
    const full = join(dir, d.name);
    if (d.isDirectory()) {
      if (skipDir(relative(base, full), d.name)) continue;
      yield* walkFiles(full, base, skipDir);
    } else if (d.isFile()) {
      yield full;
    }
  }
}

/** Run a find-in-files search rooted at `root`. */
export async function searchFiles(root: string, query: string, opts: SearchOpts): Promise<SearchResponse> {
  const re = buildRegex(query, opts);
  if (query && !re) return { results: [], total: 0, fileCount: 0, truncated: false, error: "invalid regular expression" };
  if (!re) return { results: [], total: 0, fileCount: 0, truncated: false };

  const includeRes = compileGlobs(opts.include);
  const excludeRes = compileGlobs(opts.exclude);
  const base = resolve(root);

  // Directory pruning, evaluated as the walk descends. Order matters: a user exclude glob always
  // wins; then the default groups (each toggleable, default on) skip build/system folders unless the
  // user opted that folder back in via an include glob. `name` overrides only affect the defaults.
  const excludeBuild = opts.excludeBuild ?? true;
  const excludeSystem = opts.excludeSystem ?? true;
  const included = includeDirNames(opts.include);
  const skipDir = (rel: string, name: string): boolean => {
    if (excludeRes && matchesAny(excludeRes, rel)) return true;
    if (included.has(name)) return false;
    if (excludeBuild && BUILD_DIRS.has(name)) return true;
    if (excludeSystem && SYSTEM_DIRS.has(name)) return true;
    return false;
  };

  const results: SearchFileResult[] = [];
  let total = 0;
  let truncated = false;
  let scanned = 0;

  for await (const file of walkFiles(base, base, skipDir)) {
    if (total >= MAX_TOTAL_MATCHES || scanned >= MAX_FILES_SCANNED) { truncated = true; break; }
    scanned++;
    const rel = relative(base, file);
    if (includeRes && !matchesAny(includeRes, rel)) continue;
    if (excludeRes && matchesAny(excludeRes, rel)) continue;

    const st = await stat(file).catch(() => null);
    if (!st || st.size > MAX_FILE_BYTES) continue;
    const buf = await fsReadFile(file).catch(() => null);
    if (!buf) continue;
    if (buf.subarray(0, BINARY_SNIFF_BYTES).includes(0)) continue; // binary file

    const remaining = MAX_TOTAL_MATCHES - total;
    const raw = scanLines(buf.toString("utf8"), re, Math.min(MAX_MATCHES_PER_FILE, remaining));
    if (!raw.length) continue;
    results.push({
      path: file,
      name: basename(file),
      matches: raw.map((m) => {
        const { text, matchStart } = clipLine(m.lineText, m.col, m.length);
        return { line: m.line, col: m.col, length: m.length, text, matchStart };
      }),
    });
    total += raw.length;
  }
  return { results, total, fileCount: results.length, truncated };
}

const MAX_FILES_LISTED = 50000; // cap the filename index so a giant monorepo can't OOM the response

export interface FileListResponse { files: string[]; truncated: boolean; }

/** List every file under `root` (absolute paths), pruning build/dependency and system folders so a
 *  filename filter isn't drowned by node_modules/.git. The Explorer's "Filter Files" tab fetches this
 *  once and filters it client-side, so typing narrows instantly without re-walking per keystroke. */
export async function listFiles(root: string): Promise<FileListResponse> {
  const base = resolve(root);
  const skipDir = (_rel: string, name: string): boolean => BUILD_DIRS.has(name) || SYSTEM_DIRS.has(name);
  const files: string[] = [];
  let truncated = false;
  for await (const file of walkFiles(base, base, skipDir)) {
    if (files.length >= MAX_FILES_LISTED) { truncated = true; break; }
    files.push(file);
  }
  return { files, truncated };
}

export interface ReplaceTarget { path: string; matches?: { line: number; col: number }[] }

/** Replace matches of the query with `replacement` across `targets`. A target with no `matches` list
 *  replaces every hit in that file; otherwise only the listed (line,col) positions are replaced.
 *  Replacement is applied by splicing exact byte spans (back to front), so capture refs ($1) work and
 *  every byte outside a replaced match — including line endings — is left exactly as it was. */
export async function replaceInFiles(
  query: string, replacement: string, opts: SearchOpts, targets: ReplaceTarget[],
): Promise<{ replaced: number; files: number }> {
  const re = buildRegex(query, opts);
  if (!re) return { replaced: 0, files: 0 };
  // In regex mode capture refs ($1, $&) are honored via String.replace on the single match; in literal
  // mode the replacement is inserted verbatim (no $-sequence interpretation), like VS Code.
  const single = opts.regexp ? new RegExp(re.source, re.flags.replace("g", "")) : null;

  let replaced = 0;
  let files = 0;
  for (const target of targets) {
    const buf = await fsReadFile(target.path).catch(() => null);
    if (!buf) continue;
    if (buf.subarray(0, BINARY_SNIFF_BYTES).includes(0)) continue;
    const content = buf.toString("utf8");
    const all = scanLines(content, re, MAX_MATCHES_PER_FILE);
    const wanted = target.matches
      ? all.filter((m) => target.matches!.some((w) => w.line === m.line && w.col === m.col))
      : all;
    if (!wanted.length) continue;

    // Splice back-to-front so earlier offsets stay valid as we rewrite.
    const ordered = wanted.slice().sort((a, b) => b.start - a.start);
    let next = content;
    for (const m of ordered) {
      const repl = single ? next.slice(m.start, m.end).replace(single, replacement) : replacement;
      next = next.slice(0, m.start) + repl + next.slice(m.end);
    }
    await fsWriteFile(target.path, next, "utf8");
    replaced += wanted.length;
    files++;
  }
  return { replaced, files };
}
