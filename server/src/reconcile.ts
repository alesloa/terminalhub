import type { AppContext } from "./context.js";

/** On boot, report which stored terminals have a live tmux session and which are dead. */
export async function reconcile(ctx: AppContext): Promise<{ alive: number; dead: number }> {
  const sessions = new Set(await ctx.tmux.listSessions());
  let alive = 0, dead = 0;
  for (const t of ctx.store.listAllTerminals()) {
    if (sessions.has(t.tmuxSession)) alive++; else dead++;
  }
  return { alive, dead };
}
