import { promises as fs } from "node:fs";
import path from "node:path";
import { claudeSessionsDir } from "./paths.js";

// Claude writes a PID file per live session to ~/.claude/sessions/<id>.json. A session is
// "running" if its recorded PID is still alive.

interface PidFileEntry { pid: number; sessionId: string; cwd: string; startedAt: string; }

function isPidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Live sessions as sessionId → cwd (the folder the agent was launched in). */
export async function getRunningSessions(): Promise<Map<string, string>> {
  const running = new Map<string, string>();
  try {
    const files = await fs.readdir(claudeSessionsDir());
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const entry: PidFileEntry = JSON.parse(await fs.readFile(path.join(claudeSessionsDir(), file), "utf-8"));
        if (entry.pid && entry.sessionId && isPidAlive(entry.pid)) running.set(entry.sessionId, entry.cwd ?? "");
      } catch {
        // skip unreadable PID files
      }
    }
  } catch {
    // sessions dir doesn't exist
  }
  return running;
}

/** Session IDs with a live process behind them. */
export async function getRunningSessionIds(): Promise<Set<string>> {
  return new Set((await getRunningSessions()).keys());
}
