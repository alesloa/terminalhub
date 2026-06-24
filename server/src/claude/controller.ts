import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentType, ParsedMessage, Session, SessionEntry } from "./types.js";
import { getClaudeSessions, getCodexSessions } from "./discover.js";
import { getRunningSessionIds } from "./running.js";
import { getForkMetadata, addFork, removeFork, childrenOf } from "./forkMeta.js";
import { claudeProjectDir, codexSessionsDir } from "./paths.js";
import { parseSessionEntries, parseSessionMessages, invalidateCache } from "./jsonl.js";
import { setCustomName, removeCustomName } from "./names.js";
import { addToSessionsIndex, removeFromSessionsIndex } from "./indexFiles.js";
import { computeSessionUsage, type SessionUsage } from "./usage.js";
import { forkToOtherCli, type TargetCli } from "./crossFork.js";

export interface ClaudeController {
  listSessions(projectPath: string): Promise<{ claude: Session[]; codex: Session[] }>;
  messages(jsonlPath: string, agentType: AgentType, limit: number, offset: number): Promise<{ messages: ParsedMessage[]; total: number }>;
  entries(jsonlPath: string, agentType: AgentType): Promise<SessionEntry[]>;
  /** Write a custom title to session-names.json for the given session. */
  rename(agentType: AgentType, sessionId: string, projectPath: string, name: string): Promise<void>;
  /** Cascade-delete a session and all of its (recursive) forks. Returns every deleted id. */
  delete(agentType: AgentType, sessionId: string, projectPath: string): Promise<string[]>;
  /** Clone a session into a new UUID; returns the new session id. */
  fork(agentType: AgentType, sessionId: string, projectPath: string): Promise<string>;
  /** Fork a session truncated at a line index; returns the new session id. */
  forkFromLine(agentType: AgentType, sessionId: string, projectPath: string, lineIndex: number): Promise<string>;
  /** Fork a session into the OTHER CLI (Claude↔Codex), translating the transcript format. */
  forkCross(agentType: AgentType, sessionId: string, projectPath: string): Promise<{ newSessionId: string; targetCli: TargetCli; messageCount: number }>;
  /** Token + cost accounting for one transcript. */
  usage(jsonlPath: string): Promise<SessionUsage>;
}

/** The directory holding a session's transcript + sidecar JSON for the given agent. */
function sessionDir(agentType: AgentType, projectPath: string): string {
  return agentType === "claude" ? claudeProjectDir(projectPath) : codexSessionsDir();
}

/** Read-side controller: discovers sessions and decorates them with live + fork state. */
export function createClaudeController(): ClaudeController {
  /** Resolve a listed session by id (gives us its real jsonlPath/title/firstPrompt). */
  async function resolveSession(agentType: AgentType, sessionId: string, projectPath: string): Promise<Session | undefined> {
    const sessions = agentType === "claude"
      ? await getClaudeSessions(projectPath)
      : await getCodexSessions(projectPath);
    return sessions.find((s) => s.id === sessionId);
  }

  return {
    async listSessions(projectPath) {
      const [claude, codex, running, claudeForks, codexForks] = await Promise.all([
        getClaudeSessions(projectPath),
        getCodexSessions(projectPath),
        getRunningSessionIds(),
        getForkMetadata(claudeProjectDir(projectPath)),
        getForkMetadata(codexSessionsDir()),
      ]);
      for (const s of claude) {
        s.isRunning = running.has(s.id);
        s.parentSessionId = claudeForks.forks[s.id]?.parentSessionId;
      }
      for (const s of codex) {
        s.parentSessionId = codexForks.forks[s.id]?.parentSessionId;
      }
      return { claude, codex };
    },
    messages(jsonlPath, agentType, limit, offset) {
      return parseSessionMessages(jsonlPath, agentType, limit, offset);
    },
    entries(jsonlPath, agentType) {
      return parseSessionEntries(jsonlPath, agentType);
    },

    async rename(agentType, sessionId, projectPath, name) {
      await setCustomName(sessionDir(agentType, projectPath), sessionId, name);
    },

    async delete(agentType, sessionId, projectPath) {
      const dir = sessionDir(agentType, projectPath);
      // Resolve real jsonl paths up front (Codex filenames carry a prefix, not just the UUID).
      const [sessions, forks] = await Promise.all([
        agentType === "claude" ? getClaudeSessions(projectPath) : getCodexSessions(projectPath),
        getForkMetadata(dir),
      ]);
      const byId = new Map(sessions.map((s) => [s.id, s] as const));

      // Collect the target + every recursive descendant fork.
      const toDelete: string[] = [];
      const seen = new Set<string>();
      const stack = [sessionId];
      while (stack.length) {
        const id = stack.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        toDelete.push(id);
        for (const child of childrenOf(forks, id)) stack.push(child);
      }

      for (const id of toDelete) {
        // Remove the JSONL file + any artifact directory (<dir>/<id>/).
        const jsonlPath = byId.get(id)?.jsonlPath ?? path.join(dir, `${id}.jsonl`);
        await fs.unlink(jsonlPath).catch(() => {});
        const artifactDir = path.join(path.dirname(jsonlPath), id);
        try {
          if ((await fs.stat(artifactDir)).isDirectory()) await fs.rm(artifactDir, { recursive: true, force: true });
        } catch {
          // no artifact dir — fine
        }
        invalidateCache(jsonlPath);

        if (agentType === "claude") await removeFromSessionsIndex(dir, id);
        await removeCustomName(dir, id);
        await removeFork(dir, id);
      }
      return toDelete;
    },

    async fork(agentType, sessionId, projectPath) {
      const session = await resolveSession(agentType, sessionId, projectPath);
      if (!session) throw new Error("session not found");
      const dir = sessionDir(agentType, projectPath);
      const newSessionId = randomUUID();
      const newFilePath = path.join(dir, `${newSessionId}.jsonl`);

      await fs.copyFile(session.jsonlPath, newFilePath);
      await setCustomName(dir, newSessionId, `${session.title} (Cloned)`);
      await addFork(dir, newSessionId, session.id);
      if (agentType === "claude") {
        await addToSessionsIndex(dir, {
          sessionId: newSessionId,
          fullPath: newFilePath,
          projectPath: session.projectPath,
          firstPrompt: session.firstPrompt,
        });
      }
      return newSessionId;
    },

    async forkFromLine(agentType, sessionId, projectPath, lineIndex) {
      const session = await resolveSession(agentType, sessionId, projectPath);
      if (!session) throw new Error("session not found");
      const dir = sessionDir(agentType, projectPath);
      const newSessionId = randomUUID();
      const newFilePath = path.join(dir, `${newSessionId}.jsonl`);

      // Keep every line up to and including lineIndex; rewrite the sessionId field on each so the
      // transcript self-references the new UUID (the CLI uses it on resume).
      const allEntries = await parseSessionEntries(session.jsonlPath, agentType);
      const kept = allEntries.filter((e) => e.lineIndex <= lineIndex);
      const rewritten = kept.map((entry) => {
        try {
          const obj = JSON.parse(entry.rawLine);
          if (obj.sessionId) { obj.sessionId = newSessionId; return JSON.stringify(obj); }
          return entry.rawLine;
        } catch {
          return entry.rawLine;
        }
      });
      await fs.writeFile(newFilePath, rewritten.join("\n") + "\n", "utf-8");

      await setCustomName(dir, newSessionId, `${session.title} (Cloned)`);
      await addFork(dir, newSessionId, session.id);
      if (agentType === "claude") {
        await addToSessionsIndex(dir, {
          sessionId: newSessionId,
          fullPath: newFilePath,
          projectPath: session.projectPath,
        });
      }
      return newSessionId;
    },

    async forkCross(agentType, sessionId, projectPath) {
      const session = await resolveSession(agentType, sessionId, projectPath);
      if (!session) throw new Error("session not found");
      const result = await forkToOtherCli(session);
      // Record the fork in the TARGET CLI's dir so it links back to the source session.
      const targetDir = result.targetCli === "claude" ? claudeProjectDir(projectPath) : codexSessionsDir();
      await addFork(targetDir, result.newSessionId, session.id);
      return { newSessionId: result.newSessionId, targetCli: result.targetCli, messageCount: result.messageCount };
    },

    usage(jsonlPath) {
      return computeSessionUsage(jsonlPath);
    },
  };
}
