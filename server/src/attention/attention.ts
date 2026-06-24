import type { AppContext } from "../context.js";
import type { WindowFlags } from "../tmux/controller.js";
import type { AttentionMode, Terminal, Workspace } from "../types.js";

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

/** Pure: pick the terminals whose tmux session carries an unviewed signal allowed by `mode`. */
export function attentionFrom(
  flags: Map<string, WindowFlags>,
  terminals: Terminal[],
  workspaces: Workspace[],
  mode: AttentionMode,
): AttentionItem[] {
  const wsName = new Map(workspaces.map(w => [w.id, w.name]));
  return terminals
    .filter(t => flagged(flags.get(t.tmuxSession), mode))
    .map(t => ({
      terminalId: t.id,
      workspaceId: t.workspaceId,
      workspaceName: wsName.get(t.workspaceId) ?? "",
      title: t.title,
    }));
}

export async function computeAttention(ctx: AppContext): Promise<AttentionItem[]> {
  const flags = await ctx.tmux.windowFlags();
  return attentionFrom(flags, ctx.store.listAllTerminals(), ctx.store.listWorkspaces(), ctx.store.getSettings().attentionMode);
}
