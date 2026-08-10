import { createGuiSession, type GuiSession, type GuiSessionOptions } from "./session.js";
import type { GuiCommand, GuiModel } from "./types.js";

// Registry of the live GUI-mode Claude sessions, one per terminal.
//
// A session outlives any single browser socket on purpose: closing the tab must not kill the agent,
// exactly like detaching from tmux doesn't. It ends when the user switches the terminal back to
// tmux, deletes the terminal, or the hub process shuts down.

export interface GuiManager {
  /** The live session for a terminal, starting one if it isn't running yet. */
  ensure(opts: GuiSessionOptions): GuiSession;
  get(terminalId: string): GuiSession | undefined;
  /** The installed CLI's model catalog. Answered from a cache after the first successful fetch —
   *  the roster belongs to the CLI, not to a terminal, so every composer can share one lookup. */
  models(terminalId: string): Promise<GuiModel[]>;
  /** Slash commands the CLI offers. Cached like models — the list is per-install, not per-terminal,
   *  and a skill added mid-session is picked up on the next hub restart. */
  commands(terminalId: string): Promise<GuiCommand[]>;
  /** Stop and forget a terminal's session. Safe to call when nothing is running. */
  stop(terminalId: string): Promise<void>;
  stopAll(): Promise<void>;
}

export function createGuiManager(): GuiManager {
  const sessions = new Map<string, GuiSession>();
  let modelCache: GuiModel[] = [];
  let commandCache: GuiCommand[] = [];

  const drop = async (terminalId: string) => {
    const session = sessions.get(terminalId);
    if (!session) return;
    sessions.delete(terminalId);
    await session.stop();
  };

  return {
    ensure(opts) {
      const existing = sessions.get(opts.terminalId);
      // A session that already failed or exited is not reusable — replace it rather than handing
      // back a corpse that silently swallows every prompt.
      if (existing && existing.state() !== "stopped" && existing.state() !== "error") return existing;
      if (existing) void drop(opts.terminalId);
      const session = createGuiSession(opts);
      sessions.set(opts.terminalId, session);
      return session;
    },

    get: (terminalId) => sessions.get(terminalId),

    async commands(terminalId) {
      if (commandCache.length) return commandCache;
      const list = (await sessions.get(terminalId)?.commands()) ?? [];
      if (list.length) commandCache = list;
      return list;
    },

    async models(terminalId) {
      if (modelCache.length) return modelCache;
      const list = (await sessions.get(terminalId)?.models()) ?? [];
      // Only a non-empty answer is worth caching — an empty one means the runtime wasn't up yet.
      if (list.length) modelCache = list;
      return list;
    },

    stop: drop,

    async stopAll() {
      const all = [...sessions.values()];
      sessions.clear();
      await Promise.all(all.map((s) => s.stop()));
    },
  };
}
