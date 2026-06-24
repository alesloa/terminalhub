import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { ClaudeSession, SessionActivityState } from "../../api/types";

/** Relative "time ago" for a session's last-modified timestamp. */
function relTime(iso: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Live activity dot. Solid green = working; amber blink = waiting on a permission prompt;
 *  green blink = finished but unacknowledged; faint = running but idle; nothing otherwise. */
function ActivityDot({ state, isRunning }: { state: SessionActivityState; isRunning: boolean }) {
  if (state === "active") return <span className="text-green-400" title="working">●</span>;
  if (state === "waiting") return <span className="text-amber-400 tr-blink" title="waiting for permission">●</span>;
  if (state === "finished") return <span className="text-green-400 tr-blink" title="finished — switch to it">●</span>;
  if (isRunning) return <span className="text-green-400/40" title="running">●</span>;
  return <span className="text-transparent">●</span>;
}

export function SessionRow({
  session, state, color, pinned, renaming, onRename, onCancelRename, onStartRename, onResume, onContext, onOpenDetail, onFork, onDelete,
}: {
  session: ClaudeSession;
  state: SessionActivityState;
  color: string | null;
  pinned: boolean;
  renaming: boolean;
  onRename: (name: string) => void;
  onCancelRename: () => void;
  onStartRename: () => void;
  onResume: () => void;
  onContext: (e: ReactMouseEvent) => void;
  onOpenDetail: () => void;
  onFork: () => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(session.title);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (renaming) { setDraft(session.title); inputRef.current?.select(); } }, [renaming, session.title]);

  const meta = [session.gitBranch, session.messageCount ? `${session.messageCount} msgs` : "", relTime(session.modified)]
    .filter(Boolean).join(" · ");

  return (
    <div
      onClick={() => !renaming && onResume()}
      onContextMenu={onContext}
      title="Click to open — or jump to it if it's already running"
      className="group relative w-full flex items-center gap-2 pl-3 pr-2 py-1.5 cursor-pointer hover:bg-surface">
      {color && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded" style={{ background: color }} />}
      <span className="w-3 shrink-0 text-[10px] leading-none flex justify-center"><ActivityDot state={state} isRunning={session.isRunning} /></span>

      <span className="min-w-0 flex-1">
        {renaming ? (
          <input
            ref={inputRef}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") { const v = draft.trim(); if (v) onRename(v); else onCancelRename(); }
              else if (e.key === "Escape") onCancelRename();
            }}
            onBlur={() => { const v = draft.trim(); v && v !== session.title ? onRename(v) : onCancelRename(); }}
            className="w-full px-1 py-0.5 rounded bg-canvas border border-accent/60 text-xs text-bright outline-none" />
        ) : (
          <>
            <span className="flex items-center gap-1.5">
              {pinned && <span className="text-[10px] text-dim shrink-0" title="pinned">📌</span>}
              <span className="block truncate text-[13px] text-fg">{session.title || session.id.slice(0, 8)}</span>
            </span>
            {meta && <span className="block truncate text-[11px] text-dim">{meta}</span>}
          </>
        )}
      </span>

      {!renaming && (
        <span className="shrink-0 hidden group-hover:flex items-center gap-1 text-dim">
          <button title="View transcript" onClick={(e) => { e.stopPropagation(); onOpenDetail(); }}
            className="px-1 hover:text-fg">▤</button>
          <button title="Rename" onClick={(e) => { e.stopPropagation(); onStartRename(); }}
            className="px-1 hover:text-fg">✎</button>
          <button title="Fork (clone)" onClick={(e) => { e.stopPropagation(); onFork(); }}
            className="px-1 hover:text-fg">⑂</button>
          <button title="Delete" onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="px-1 hover:text-red-400">✕</button>
        </span>
      )}
    </div>
  );
}
