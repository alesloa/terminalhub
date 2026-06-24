import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useEscape } from "../../hooks/useEscape";
import type { ClaudeSession, SessionEntryLite, SessionEntryType } from "../../api/types";

const TYPE_STYLE: Record<SessionEntryType, string> = {
  User: "text-blue-400",
  Assistant: "text-green-400",
  System: "text-dim",
  Progress: "text-amber-400",
  Other: "text-dim",
};

/** Group a set of line indexes into sorted contiguous [start,end] inclusive ranges. */
function toRanges(lines: number[]): [number, number][] {
  const sorted = [...lines].sort((a, b) => a - b);
  const ranges: [number, number][] = [];
  for (const n of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else ranges.push([n, n]);
  }
  return ranges;
}

/**
 * Edit a transcript's messages: multi-select entries (shift-click for a range), then delete
 * them, summarize the selected span into one entry, or fork a new session truncated at a line.
 * Edits write back to the .jsonl (the CLI reads it on resume); deletes repair the chain server-side.
 */
export function EntryEditorModal({ session, projectPath, onClose }: { session: ClaudeSession; projectPath: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [error, setError] = useState("");
  useEscape(onClose);

  const entriesQ = useQuery({
    queryKey: ["claude", "entries", session.jsonlPath],
    queryFn: () => api.claude.entries(session.jsonlPath, session.agentType),
  });
  const entries = entriesQ.data?.entries ?? [];
  const checkable = useMemo(() => entries.filter((e) => e.checkable), [entries]);

  const afterEdit = () => {
    setSelected(new Set());
    setAnchor(null);
    qc.invalidateQueries({ queryKey: ["claude", "entries", session.jsonlPath] });
    qc.invalidateQueries({ queryKey: ["claude", "sessions", projectPath] });
  };

  const delMut = useMutation({
    mutationFn: () => api.claude.deleteEntries(session.jsonlPath, session.agentType, toRanges([...selected])),
    onSuccess: afterEdit,
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "delete failed"),
  });
  const sumMut = useMutation({
    mutationFn: () => {
      const idx = [...selected].sort((a, b) => a - b);
      return api.claude.summarizeEntries(session.jsonlPath, session.agentType, idx[0], idx[idx.length - 1]);
    },
    onSuccess: afterEdit,
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "summarize failed"),
  });
  const forkMut = useMutation({
    mutationFn: () => api.claude.forkFromLine(session.agentType, session.id, projectPath, [...selected][0]),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["claude", "sessions", projectPath] }); onClose(); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "fork failed"),
  });

  const toggle = (entry: SessionEntryLite, shift: boolean) => {
    if (!entry.checkable) return;
    setError("");
    setSelected((prev) => {
      const next = new Set(prev);
      if (shift && anchor !== null) {
        // select every checkable entry between the anchor and this one (inclusive)
        const lo = Math.min(anchor, entry.lineIndex), hi = Math.max(anchor, entry.lineIndex);
        for (const e of checkable) if (e.lineIndex >= lo && e.lineIndex <= hi) next.add(e.lineIndex);
      } else {
        next.has(entry.lineIndex) ? next.delete(entry.lineIndex) : next.add(entry.lineIndex);
      }
      return next;
    });
    setAnchor(entry.lineIndex);
  };

  const busy = delMut.isPending || sumMut.isPending || forkMut.isPending;
  const count = selected.size;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60" onMouseDown={onClose}>
      <div className="w-[min(820px,94vw)] max-h-[88vh] flex flex-col rounded-xl border border-edge bg-canvas shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-edge">
          <div className="min-w-0">
            <div className="font-semibold truncate">Edit · {session.title || session.id.slice(0, 8)}</div>
            <div className="text-[11px] text-dim">Select messages, then delete, summarize, or fork from a line.</div>
          </div>
          <button onClick={onClose} className="text-dim hover:text-fg text-lg leading-none">✕</button>
        </div>

        {/* toolbar */}
        <div className="px-5 py-2 border-b border-edge flex items-center gap-2 text-xs">
          <span className="text-dim">{count} selected</span>
          <div className="flex-1" />
          <button disabled={count === 0 || busy} onClick={() => forkMut.mutate()}
            title={count === 1 ? "Fork a new session up to this line" : "Select exactly one line to fork from it"}
            className="px-2 py-1 rounded bg-elevated hover:bg-edge disabled:opacity-30">Fork from line</button>
          <button disabled={count === 0 || busy} onClick={() => sumMut.mutate()}
            className="px-2 py-1 rounded bg-elevated hover:bg-edge disabled:opacity-30">Summarize</button>
          <button disabled={count === 0 || busy} onClick={() => delMut.mutate()}
            className="px-2 py-1 rounded bg-red-600/80 hover:bg-red-600 disabled:opacity-30">Delete</button>
        </div>
        {error && <div className="px-5 py-1.5 text-xs text-red-400 border-b border-edge">{error}</div>}

        <div className="flex-1 min-h-0 overflow-auto py-1">
          {entriesQ.isLoading && <div className="px-5 py-2 text-xs text-dim">loading entries…</div>}
          {entries.map((e) => {
            const isSel = selected.has(e.lineIndex);
            return (
              <button key={e.lineIndex} disabled={!e.checkable}
                onClick={(ev) => toggle(e, ev.shiftKey)}
                className={`w-full text-left flex items-start gap-2 px-5 py-1 ${e.checkable ? "hover:bg-surface" : "opacity-50 cursor-default"} ${isSel ? "bg-[#16233b]" : ""}`}>
                <span className="mt-0.5 w-3 shrink-0 text-center text-[11px]">{e.checkable ? (isSel ? "☑" : "☐") : ""}</span>
                <span className={`mt-0.5 w-16 shrink-0 text-[10px] uppercase tracking-wide ${TYPE_STYLE[e.entryType]}`}>{e.entryType}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-fg">{e.preview}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
