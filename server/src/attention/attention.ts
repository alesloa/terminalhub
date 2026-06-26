import type { AppContext } from "../context.js";
import type { WindowFlags } from "../tmux/controller.js";
import type { AttentionMode, Terminal, Workspace } from "../types.js";
import { builtinAgentBinaries, effectiveLaunch, isAgentTerminal } from "../activity/working.js";

/** A terminal whose agent rang the bell — or went quiet — while you weren't looking. */
export interface AttentionItem {
  terminalId: string;
  workspaceId: string;
  workspaceName: string;
  title: string;
}

/** Whether a session's flags warrant attention under the given mode. `explicit`/`layered` honour the
 *  bell; `silence`/`layered` honour the silence flag. */
function flagged(f: WindowFlags | undefined, mode: AttentionMode): boolean {
  if (!f) return false;
  const explicit = mode === "explicit" || mode === "layered";
  const silence = mode === "silence" || mode === "layered";
  return (explicit && f.bell) || (silence && f.silence);
}

/** Pure: pick the terminals whose tmux session carries an unviewed signal allowed by `mode`. Only
 *  AI-agent sessions are eligible — a plain shell or dev-server terminal that rings the bell or goes
 *  quiet must NEVER earn attention (`agentBins` is the known + custom-agent binary allowlist). */
export function attentionFrom(
  flags: Map<string, WindowFlags>,
  terminals: Terminal[],
  workspaces: Workspace[],
  mode: AttentionMode,
  agentBins: Set<string>,
): AttentionItem[] {
  const wsById = new Map(workspaces.map(w => [w.id, w]));
  return terminals
    .filter(t => isAgentTerminal(effectiveLaunch(t, wsById.get(t.workspaceId)), agentBins))
    .filter(t => flagged(flags.get(t.tmuxSession), mode))
    .map(t => ({
      terminalId: t.id,
      workspaceId: t.workspaceId,
      workspaceName: wsById.get(t.workspaceId)?.name ?? "",
      title: t.title,
    }));
}

export async function computeAttention(ctx: AppContext): Promise<AttentionItem[]> {
  const flags = await ctx.tmux.windowFlags();
  // Attention is always-on "layered" (bell OR silence). It is NOT user-controlled — a backgrounded
  // terminal that rang the bell OR simply went quiet always needs you. The stored attentionMode is
  // intentionally ignored here so the space/card dots blink on a finished agent, not just a bell.
  // Built-in agents ONLY — a registered custom launcher (npm run dev, codegraph) must never notify.
  return attentionFrom(flags, ctx.store.listAllTerminals(), ctx.store.listWorkspaces(), "layered", builtinAgentBinaries());
}
