import os from "node:os";
import path from "node:path";

/** Prefer $HOME so tests can point the whole module tree at a temp dir. */
export function homeDir(): string {
  return process.env.HOME || os.homedir();
}

/**
 * Claude CLI encodes a project's absolute path as a folder name by replacing every
 * non-alphanumeric character with '-'.
 * e.g. /home/you/code/myapp -> -home-you-code-myapp
 */
export function projectPathToFolderName(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, "-");
}

/** ~/.claude/projects/<folder> — Claude session transcripts + index for one project. */
export function claudeProjectDir(projectPath: string): string {
  return path.join(homeDir(), ".claude", "projects", projectPathToFolderName(projectPath));
}

/** ~/.claude/sessions — running-process PID files (one *.json per live session). */
export function claudeSessionsDir(): string {
  return path.join(homeDir(), ".claude", "sessions");
}

/** ~/.codex/sessions — Codex transcripts, nested by YYYY/MM/DD. */
export function codexSessionsDir(): string {
  return path.join(homeDir(), ".codex", "sessions");
}

/** ~/.codex/session_index.jsonl — append-only Codex index (one JSON object per line). */
export function codexIndexPath(): string {
  return path.join(homeDir(), ".codex", "session_index.jsonl");
}
