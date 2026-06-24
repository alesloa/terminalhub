import { useQuery } from "@tanstack/react-query";
import { api } from "../../../api/client";
import { useAttention } from "../../../hooks/useAttention";

// Real signals only: a terminal's `alive` flag is derived from tmux on every read, and "awaiting
// input" is the bell-based attention list. There is no separate working/idle state in the data
// model, so we don't invent one.
export function AgentActivityWidget() {
  const { data } = useQuery({ queryKey: ["workspaces"], queryFn: api.listWorkspaces, refetchInterval: 5000 });
  const attention = useAttention();
  const workspaces = data?.workspaces ?? [];

  let running = 0;
  let activeWorkspaces = 0;
  for (const ws of workspaces) {
    const alive = (ws.terminals ?? []).filter((t) => t.alive).length;
    running += alive;
    if (alive > 0) activeWorkspaces++;
  }
  const awaiting = attention.length;

  return (
    <div>
      <div className="flex items-end gap-2">
        <span className="text-3xl font-bold tabular-nums leading-none text-bright">{running}</span>
        <span className="mb-0.5 text-xs text-muted">agent{running === 1 ? "" : "s"} running</span>
      </div>
      <div className="mt-1 text-[11px] text-dim">
        across {activeWorkspaces} workspace{activeWorkspaces === 1 ? "" : "s"}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[12px]">
        <span className={awaiting > 0 ? "text-warn" : "text-dim"}>●</span>
        <span className={awaiting > 0 ? "text-fg" : "text-dim"}>{awaiting} awaiting input</span>
      </div>
      {awaiting > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {attention.slice(0, 3).map((a) => (
            <li key={a.terminalId} className="truncate text-[11px] text-muted">
              <span className="text-warn">›</span> {a.workspaceName} · {a.title}
            </li>
          ))}
          {awaiting > 3 && <li className="text-[11px] text-dim">+{awaiting - 3} more</li>}
        </ul>
      )}
    </div>
  );
}
