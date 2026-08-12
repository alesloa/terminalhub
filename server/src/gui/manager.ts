import { createGuiSession, type GuiSession, type GuiSessionOptions } from "./session.js";
import { createCodexGuiSession } from "./codex/session.js";
import type { GuiAgent } from "./agent.js";
import type { GuiCommand, GuiModel } from "./types.js";

// Registry of the live GUI-mode sessions, one per terminal.
//
// A session outlives any single browser socket on purpose: closing the tab must not kill the agent,
// exactly like detaching from tmux doesn't. It ends when the user switches the terminal back to
// tmux, deletes the terminal, or the hub process shuts down.
//
// Two agents live behind one interface — Claude Code via the Agent SDK, Codex via `codex
// app-server`. The caller says which; everything downstream of `GuiSession` is identical.

export interface GuiEnsureOptions extends GuiSessionOptions {
  /** Which CLI backs this chat. Derived from the terminal's launch command — see agent.ts. */
  agent: GuiAgent;
}

export interface GuiManager {
  /** The live session for a terminal, starting one if it isn't running yet. */
  ensure(opts: GuiEnsureOptions): GuiSession;
  get(terminalId: string): GuiSession | undefined;
  /** The installed CLI's model catalog. Answered from a per-agent cache after the first successful
   *  fetch — the roster belongs to the CLI, not to a terminal, so every composer on that agent can
   *  share one lookup. */
  models(terminalId: string, agent: GuiAgent): Promise<GuiModel[]>;
  /** Slash commands the CLI offers. Cached like models. */
  commands(terminalId: string, agent: GuiAgent): Promise<GuiCommand[]>;
  /** Stop and forget a terminal's session. Safe to call when nothing is running. */
  stop(terminalId: string): Promise<void>;
  stopAll(): Promise<void>;
}

export function createGuiManager(): GuiManager {
  const sessions = new Map<string, GuiSession>();
  /** Which agent each live session is running, so a terminal re-pointed at a different CLI gets a
   *  new session instead of keeping the old agent's. */
  const agents = new Map<string, GuiAgent>();
  const modelCache = new Map<GuiAgent, GuiModel[]>();
  const commandCache = new Map<GuiAgent, GuiCommand[]>();

  const drop = async (terminalId: string) => {
    const session = sessions.get(terminalId);
    if (!session) return;
    sessions.delete(terminalId);
    agents.delete(terminalId);
    await session.stop();
  };

  return {
    ensure(opts) {
      const existing = sessions.get(opts.terminalId);
      // A session that already failed or exited is not reusable — replace it rather than handing
      // back a corpse that silently swallows every prompt. Same for one running the wrong agent.
      const reusable = existing
        && existing.state() !== "stopped" && existing.state() !== "error"
        && agents.get(opts.terminalId) === opts.agent;
      if (reusable) return existing as GuiSession;
      if (existing) void drop(opts.terminalId);
      const { agent, ...sessionOpts } = opts;
      const session = agent === "codex" ? createCodexGuiSession(sessionOpts) : createGuiSession(sessionOpts);
      sessions.set(opts.terminalId, session);
      agents.set(opts.terminalId, agent);
      return session;
    },

    get: (terminalId) => sessions.get(terminalId),

    async commands(terminalId, agent) {
      const cached = commandCache.get(agent);
      if (cached?.length) return cached;
      const list = (await sessions.get(terminalId)?.commands()) ?? [];
      if (list.length) commandCache.set(agent, list);
      return list;
    },

    async models(terminalId, agent) {
      const cached = modelCache.get(agent);
      if (cached?.length) return cached;
      const list = (await sessions.get(terminalId)?.models()) ?? [];
      // Only a non-empty answer is worth caching — an empty one means the runtime wasn't up yet.
      if (list.length) modelCache.set(agent, list);
      return list;
    },

    stop: drop,

    async stopAll() {
      const all = [...sessions.values()];
      sessions.clear();
      agents.clear();
      await Promise.all(all.map((s) => s.stop()));
    },
  };
}
