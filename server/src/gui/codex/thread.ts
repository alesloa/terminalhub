import type { CodexAppServer } from "../../codex/appServer.js";
import { CODEX_METHOD, type CodexTurn } from "../../codex/protocol.js";
import type { GuiCommand } from "../types.js";

// Small reads against an open Codex thread that aren't part of the event stream: how far along the
// conversation is, and what the installed Codex offers as slash commands.

/** Human turns already on a thread. The checkpointer counts turns to address its snapshots, and a
 *  resumed conversation has to start counting from what is already there rather than from zero. */
export function countUserTurns(turns: CodexTurn[]): number {
  let count = 0;
  for (const turn of turns) {
    for (const item of turn.items ?? []) {
      if (item.type === "userMessage") count += 1;
    }
  }
  return count;
}

interface SkillsListResponse {
  data: {
    cwd: string;
    skills: { name: string; description?: string; shortDescription?: string; enabled?: boolean }[];
  }[];
}

/**
 * Codex's skills for this folder, as composer slash commands. The Claude side gets the same list
 * from `Query.supportedCommands()`; this is the equivalent read, scoped to the workspace so a
 * project-local skill shows up alongside the user's global ones.
 *
 * Never throws: the picker asking before the thread is warm, or an older CLI without the method,
 * must degrade to "no commands" rather than failing the composer.
 */
export async function listSkills(server: CodexAppServer, cwd: string): Promise<GuiCommand[]> {
  try {
    const response = await server.request<SkillsListResponse>(CODEX_METHOD.skillsList, { cwds: [cwd] });
    const seen = new Set<string>();
    const commands: GuiCommand[] = [];
    for (const entry of response?.data ?? []) {
      for (const skill of entry.skills ?? []) {
        if (!skill.name || skill.enabled === false || seen.has(skill.name)) continue;
        seen.add(skill.name);
        commands.push({
          name: skill.name,
          description: skill.shortDescription || skill.description || "",
          argumentHint: "",
        });
      }
    }
    return commands;
  } catch {
    return [];
  }
}
