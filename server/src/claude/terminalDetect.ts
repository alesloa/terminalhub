import { promises as fs } from "node:fs";
import path from "node:path";
import { claudeSessionsDir } from "./paths.js";
import { listProcesses, type PsRunner } from "../system/processes.js";

// Fork-from-terminal detection: figure out which Claude session is running inside a given terminal.
// Claude writes one PID file per live session under ~/.claude/sessions/*.json; a session "is in" a
// terminal when its claude pid is a descendant of that terminal's shell pid in the process tree.
// Ported from claude-session-explorer/src/services/terminalSessionDetector.ts.

interface PidFileEntry {
  pid: number;
  sessionId: string;
  cwd?: string;
}

/** Read every Claude PID file and return the full entries (includes cwd when available). */
async function readClaudePidEntries(): Promise<PidFileEntry[]> {
  let files: string[];
  try {
    files = await fs.readdir(claudeSessionsDir());
  } catch {
    return [];
  }
  const entries: PidFileEntry[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const entry: PidFileEntry = JSON.parse(await fs.readFile(path.join(claudeSessionsDir(), file), "utf-8"));
      if (entry.pid && entry.sessionId) entries.push(entry);
    } catch {
      // skip unreadable/malformed PID files
    }
  }
  return entries;
}

/** Read every Claude PID file and return a map of PID → sessionId. */
export async function readClaudePidMap(): Promise<Map<number, string>> {
  const entries = await readClaudePidEntries();
  return new Map(entries.map((e) => [e.pid, e.sessionId]));
}

/** Whether `descendant` is a descendant of `ancestor` in the pid→ppid tree (capped depth). */
function isDescendant(tree: Map<number, number>, descendant: number, ancestor: number): boolean {
  let current: number | undefined = descendant;
  let depth = 0;
  while (current && current !== 1 && depth < 50) {
    if (current === ancestor) return true;
    current = tree.get(current);
    depth++;
  }
  return false;
}

/**
 * Windows-only: match a Claude session to a workspace folder via the cwd recorded in the PID file.
 * Avoids WMI entirely — no PowerShell, no WmiPrvSE.exe CPU spike, no process tree needed.
 */
function detectByWorkspaceFolder(entries: PidFileEntry[], workspaceFolder: string): string | undefined {
  const normWs = workspaceFolder.replace(/\\/g, "/").toLowerCase().replace(/\/$/, "");
  for (const entry of entries) {
    if (!entry.cwd) continue;
    const normCwd = entry.cwd.replace(/\\/g, "/").toLowerCase();
    if (normCwd === normWs || normCwd.startsWith(normWs + "/")) return entry.sessionId;
  }
  return undefined;
}

/**
 * Given a terminal's shell PID, find which Claude session (if any) is running as a descendant of
 * that shell. Returns the sessionId, or undefined if none is detected.
 *
 * On Windows, pass `workspaceFolder` (the workspace's root path) to use cwd-based matching instead
 * of the process tree — this avoids spawning PowerShell + WMI which spikes WmiPrvSE.exe CPU.
 *
 * `run` is injectable for tests (defaults to the real `ps` runner on Unix).
 */
export async function detectSessionForPid(
  shellPid: number | undefined,
  run?: PsRunner,
  workspaceFolder?: string,
): Promise<string | undefined> {
  if (!shellPid) return undefined;

  const entries = await readClaudePidEntries();
  if (entries.length === 0) return undefined;

  // Windows: cwd-based matching — no WMI, no WmiPrvSE.exe CPU spike.
  if (process.platform === "win32" && workspaceFolder) {
    return detectByWorkspaceFolder(entries, workspaceFolder);
  }

  // Unix (or Windows without workspaceFolder): walk the process tree via `ps`.
  const procs = await listProcesses(run);
  if (procs.length === 0) return undefined;

  const tree = new Map<number, number>();
  for (const p of procs) tree.set(p.pid, p.ppid);

  for (const entry of entries) {
    if (isDescendant(tree, entry.pid, shellPid)) return entry.sessionId;
  }
  return undefined;
}
