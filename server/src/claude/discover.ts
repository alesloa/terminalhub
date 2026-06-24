import { promises as fs, type Stats } from "node:fs";
import path from "node:path";
import type { ClaudeIndexEntry, CodexIndexEntry, Session } from "./types.js";
import { claudeProjectDir, codexIndexPath, codexSessionsDir } from "./paths.js";
import { getCustomNames } from "./names.js";
import { readSessionsIndex } from "./indexFiles.js";
import { getFirstUserMessage } from "./jsonl.js";

// --- Claude ---

/**
 * Discover every Claude session for a project. The on-disk *.jsonl files are the source of
 * truth; sessions-index.json is only a metadata cache, so we always scan the directory and
 * fall back to fs.stat + first-message when a file isn't in the index. Sidechains are skipped.
 */
export async function getClaudeSessions(projectPath: string): Promise<Session[]> {
  const projectDir = claudeProjectDir(projectPath);
  const customNames = await getCustomNames(projectDir);
  const index = await readSessionsIndex(projectDir);

  const indexMap = new Map<string, ClaudeIndexEntry>();
  for (const entry of index?.entries ?? []) indexMap.set(entry.sessionId, entry);

  let files: string[];
  try {
    files = await fs.readdir(projectDir);
  } catch {
    return [];
  }

  const sessions: Session[] = [];
  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const sessionId = file.replace(".jsonl", "");
    const jsonlPath = path.join(projectDir, file);
    const indexEntry = indexMap.get(sessionId);
    if (indexEntry?.isSidechain) continue;

    if (indexEntry) {
      sessions.push({
        id: sessionId,
        agentType: "claude",
        title: await resolveClaudeTitle(indexEntry, customNames, projectDir),
        firstPrompt: indexEntry.firstPrompt,
        messageCount: indexEntry.messageCount || 0,
        created: indexEntry.created || "",
        modified: indexEntry.modified || "",
        gitBranch: indexEntry.gitBranch,
        projectPath: indexEntry.projectPath || projectPath,
        isSidechain: false,
        jsonlPath: indexEntry.fullPath || jsonlPath,
        isRunning: false,
      });
    } else {
      let stat: Stats;
      try { stat = await fs.stat(jsonlPath); } catch { continue; }
      let title = customNames[sessionId];
      if (!title) {
        try { title = (await getFirstUserMessage(jsonlPath, "claude")) || sessionId.substring(0, 8); }
        catch { title = sessionId.substring(0, 8); }
      }
      sessions.push({
        id: sessionId,
        agentType: "claude",
        title,
        messageCount: 0,
        created: stat.birthtime.toISOString(),
        modified: stat.mtime.toISOString(),
        projectPath,
        isSidechain: false,
        jsonlPath,
        isRunning: false,
      });
    }
  }

  sessions.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
  return sessions;
}

async function resolveClaudeTitle(
  entry: ClaudeIndexEntry, customNames: Record<string, string>, projectDir: string,
): Promise<string> {
  if (customNames[entry.sessionId]) return customNames[entry.sessionId];
  if (entry.firstPrompt) return entry.firstPrompt.substring(0, 120);
  try {
    const first = await getFirstUserMessage(path.join(projectDir, `${entry.sessionId}.jsonl`), "claude");
    if (first) return first;
  } catch {
    // unreadable
  }
  return entry.sessionId.substring(0, 8);
}

// --- Codex ---

interface CwdCacheEntry { cwd: string; filePath: string; mtime: number; }
// Process-lifetime cache so we don't re-read every Codex transcript on each listing. The
// extension stored this in VS Code globalState; an in-memory Map is the server equivalent.
const codexCwdCache = new Map<string, CwdCacheEntry>();

/** For tests: forget cached Codex cwd lookups. */
export function resetCodexCache(): void {
  codexCwdCache.clear();
}

/** Codex files are named <prefix>-<uuid>.jsonl; the UUID is the last 5 hyphen segments. */
function extractCodexSessionId(filePath: string): string {
  const base = path.basename(filePath, ".jsonl");
  const parts = base.split("-");
  return parts.length >= 5 ? parts.slice(-5).join("-") : base;
}

async function scanAllJsonlFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) results.push(...await scanAllJsonlFiles(fullPath));
      else if (entry.name.endsWith(".jsonl")) results.push(fullPath);
    }
  } catch {
    // dir absent or unreadable
  }
  return results;
}

async function readCodexIndex(): Promise<Map<string, CodexIndexEntry>> {
  const entries = new Map<string, CodexIndexEntry>();
  let raw: string;
  try { raw = await fs.readFile(codexIndexPath(), "utf-8"); } catch { return entries; }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry: CodexIndexEntry = JSON.parse(line);
      entries.set(entry.id, entry); // later entries override earlier ones
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

async function getCodexSessionCwd(filePath: string): Promise<string | undefined> {
  let raw: string;
  try { raw = await fs.readFile(filePath, "utf-8"); } catch { return undefined; }
  let lineCount = 0;
  for (const line of raw.split("\n")) {
    if (lineCount++ > 20) break;
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if ((obj.type === "session_meta" || obj.type === "turn_context") && obj.payload?.cwd) return obj.payload.cwd;
    } catch {
      // skip malformed lines
    }
  }
  return undefined;
}

/** Discover Codex sessions whose recorded cwd matches the project, matching by cwd not folder. */
export async function getCodexSessions(projectPath: string): Promise<Session[]> {
  const allFiles = await scanAllJsonlFiles(codexSessionsDir());
  if (allFiles.length === 0) return [];

  const indexMap = await readCodexIndex();
  const customNames = await getCustomNames(codexSessionsDir());
  const sessions: Session[] = [];

  for (const filePath of allFiles) {
    const sessionId = extractCodexSessionId(filePath);
    let stat: Stats;
    try { stat = await fs.stat(filePath); } catch { continue; }
    const mtime = stat.mtimeMs;

    const cached = codexCwdCache.get(sessionId);
    let cwd: string | undefined;
    if (cached && cached.mtime === mtime && cached.filePath === filePath) {
      cwd = cached.cwd;
    } else {
      cwd = await getCodexSessionCwd(filePath);
      codexCwdCache.set(sessionId, { cwd: cwd || "", filePath, mtime });
    }

    if (cwd === projectPath) {
      sessions.push({
        id: sessionId,
        agentType: "codex",
        title: await resolveCodexTitle(indexMap.get(sessionId), sessionId, customNames, filePath),
        messageCount: 0,
        created: stat.birthtime.toISOString(),
        modified: stat.mtime.toISOString(),
        projectPath,
        isSidechain: false,
        jsonlPath: filePath,
        isRunning: false,
      });
    }
  }

  sessions.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
  return sessions;
}

async function resolveCodexTitle(
  indexEntry: CodexIndexEntry | undefined, sessionId: string,
  customNames: Record<string, string>, filePath: string,
): Promise<string> {
  if (customNames[sessionId]) return customNames[sessionId];
  if (indexEntry?.thread_name) return indexEntry.thread_name.substring(0, 120);
  try {
    const first = await getFirstUserMessage(filePath, "codex");
    if (first) return first;
  } catch {
    // unreadable
  }
  return sessionId.substring(0, 8);
}
