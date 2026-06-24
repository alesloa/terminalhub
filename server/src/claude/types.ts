// Claude / Codex CLI session model. Ported from the claude-session-explorer VS Code
// extension so Terminal Hub reads the exact same on-disk formats the CLIs write.

export type AgentType = "claude" | "codex";

export interface Session {
  id: string;
  agentType: AgentType;
  title: string;
  firstPrompt?: string;
  messageCount: number;
  created: string;   // ISO
  modified: string;  // ISO
  gitBranch?: string;
  projectPath: string;
  isSidechain: boolean;
  jsonlPath: string;
  isRunning: boolean;
  parentSessionId?: string; // set from fork-metadata.json when this session was forked
}

export interface ClaudeIndexEntry {
  sessionId: string;
  fullPath: string;
  firstPrompt: string;
  messageCount: number;
  created: string;
  modified: string;
  gitBranch: string;
  projectPath: string;
  isSidechain: boolean;
}

export interface ClaudeSessionsIndex {
  version: number;
  originalPath: string;
  entries: ClaudeIndexEntry[];
}

export interface SessionNames {
  names: Record<string, string>;
}

export interface ForkInfo {
  parentSessionId: string;
  forkedAt: string;
}

export interface ForkMetadata {
  forks: Record<string, ForkInfo>;
}

export interface CodexIndexEntry {
  id: string;
  thread_name: string;
  updated_at: string;
}

export interface ParsedMessage {
  role: "user" | "assistant";
  content: string;
}

export type EntryType = "User" | "Assistant" | "System" | "Progress" | "Other";

export interface SessionEntry {
  /** Zero-based line index in the JSONL file. */
  lineIndex: number;
  /** Original raw JSON string for write-back (no trailing newline). */
  rawLine: string;
  entryType: EntryType;
  /** Extracted text preview (max 200 chars). */
  preview: string;
  timestamp?: string;
  uuid?: string;
  parsed: Record<string, unknown>;
}

/** Per-session UI preferences kept in Terminal Hub's own DB (the CLIs don't store these). */
export interface SessionPrefs {
  pinned: boolean;
  color: string | null;
}
