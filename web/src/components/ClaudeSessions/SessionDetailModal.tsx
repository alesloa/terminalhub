import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useEscape } from "../../hooks/useEscape";
import type { ClaudeSession, SessionMessage } from "../../api/types";

const PAGE = 50;

/** Read-only transcript viewer + token/cost summary for one session. Paginates messages. */
export function SessionDetailModal({ session, onClose }: { session: ClaudeSession; onClose: () => void }) {
  const [limit, setLimit] = useState(PAGE);
  useEscape(onClose);

  const msgs = useQuery({
    queryKey: ["claude", "messages", session.jsonlPath, limit],
    queryFn: () => api.claude.messages(session.jsonlPath, session.agentType, limit, 0),
  });
  const usage = useQuery({
    queryKey: ["claude", "usage", session.jsonlPath],
    queryFn: () => api.claude.usage(session.jsonlPath, session.agentType),
  });

  const total = msgs.data?.total ?? 0;
  const messages = msgs.data?.messages ?? [];

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60" onMouseDown={onClose}>
      <div className="w-[min(820px,94vw)] max-h-[88vh] flex flex-col rounded-xl border border-edge bg-canvas shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-edge">
          <div className="min-w-0">
            <div className="font-semibold truncate">{session.title || session.id.slice(0, 8)}</div>
            <div className="text-[11px] text-dim truncate">
              {session.agentType} · {session.gitBranch || "no branch"} · {session.id}
            </div>
          </div>
          <button onClick={onClose} className="text-dim hover:text-fg text-lg leading-none">✕</button>
        </div>

        {usage.data && (usage.data.totalTokens > 0 || usage.data.estimatedCostUSD > 0) && (
          <div className="px-5 py-2 border-b border-edge flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted">
            <span>{usage.data.totalTokens.toLocaleString()} tokens</span>
            <span>in {usage.data.inputTokens.toLocaleString()} · out {usage.data.outputTokens.toLocaleString()}</span>
            <span>cache read {usage.data.cacheReadTokens.toLocaleString()}</span>
            {usage.data.estimatedCostUSD > 0 && <span className="text-fg">≈ ${usage.data.estimatedCostUSD.toFixed(4)}</span>}
            {Object.keys(usage.data.models).length > 0 && <span className="text-dim">{Object.keys(usage.data.models).join(", ")}</span>}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-auto px-5 py-3 flex flex-col gap-3">
          {msgs.isLoading && <div className="text-xs text-dim">loading transcript…</div>}
          {!msgs.isLoading && messages.length === 0 && <div className="text-xs text-dim">No user/assistant messages in this transcript.</div>}
          {messages.map((m, i) => <MessageBlock key={i} message={m} />)}
          {messages.length < total && (
            <button onClick={() => setLimit((l) => l + PAGE)}
              className="self-center mt-1 px-3 py-1.5 rounded bg-elevated hover:bg-edge text-xs text-fg">
              Load more ({total - messages.length} left)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBlock({ message }: { message: SessionMessage }) {
  const isUser = message.role === "user";
  return (
    <div className="flex flex-col gap-1">
      <div className={`text-[10px] uppercase tracking-wide ${isUser ? "text-blue-400" : "text-green-400"}`}>{message.role}</div>
      <div className="text-[13px] text-fg whitespace-pre-wrap break-words leading-relaxed bg-panel border border-elevated rounded px-3 py-2">
        {message.content}
      </div>
    </div>
  );
}
