import { promises as fs } from "node:fs";
import path from "node:path";
import type { ClaudeSessionsIndex } from "./types.js";

// Claude keeps a sessions-index.json cache of per-session metadata. It is a CACHE, not the
// source of truth (the *.jsonl files are), so reads tolerate it being stale/absent and writes
// no-op when it doesn't exist — the session is still discovered by the filesystem scan.

export async function readSessionsIndex(projectDir: string): Promise<ClaudeSessionsIndex | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(projectDir, "sessions-index.json"), "utf-8"));
  } catch {
    return null;
  }
}

export async function removeFromSessionsIndex(projectDir: string, sessionId: string): Promise<void> {
  const indexPath = path.join(projectDir, "sessions-index.json");
  try {
    const index: ClaudeSessionsIndex = JSON.parse(await fs.readFile(indexPath, "utf-8"));
    index.entries = index.entries.filter((e) => e.sessionId !== sessionId);
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2), "utf-8");
  } catch {
    // index missing or malformed — nothing to clean up
  }
}

export async function addToSessionsIndex(
  projectDir: string,
  entry: { sessionId: string; fullPath: string; projectPath: string; firstPrompt?: string },
): Promise<void> {
  const indexPath = path.join(projectDir, "sessions-index.json");
  try {
    const index: ClaudeSessionsIndex = JSON.parse(await fs.readFile(indexPath, "utf-8"));
    const now = new Date().toISOString();
    index.entries.push({
      sessionId: entry.sessionId,
      fullPath: entry.fullPath,
      firstPrompt: entry.firstPrompt || "",
      messageCount: 0,
      created: now,
      modified: now,
      gitBranch: "",
      projectPath: entry.projectPath,
      isSidechain: false,
    });
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2), "utf-8");
  } catch {
    // index missing — no-op (filesystem scan will still find the session)
  }
}

export async function clearSessionsIndex(projectDir: string): Promise<void> {
  const indexPath = path.join(projectDir, "sessions-index.json");
  try {
    const index: ClaudeSessionsIndex = JSON.parse(await fs.readFile(indexPath, "utf-8"));
    index.entries = [];
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2), "utf-8");
  } catch {
    // no-op
  }
}
