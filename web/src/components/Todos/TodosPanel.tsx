import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoom } from "../../store/room";
import { api } from "../../api/client";
import type { SearchFileResult } from "../../api/types";

const relTo = (root: string, p: string) => (p.startsWith(root + "/") ? p.slice(root.length + 1) : p);
const dirOf = (rel: string) => { const i = rel.lastIndexOf("/"); return i < 0 ? "" : rel.slice(0, i); };

// The annotation tags we scan for, and a comment-aware matcher mirroring VS Code's "Todo Tree"
// defaults: a comment opener (`//`, `#`, `<!--`, `;`, `/*`, jsdoc `*`), a line start, or a markdown
// list bullet, then whitespace, then the tag. Case-sensitive so the lowercase word "bug" in prose
// doesn't match an intentional BUG marker. Sent to /api/search as a regex; matching is per-line, so
// each hit is one file:line with the whole line as its display text — exactly the panel's shape.
const TODO_QUERY = "(//|#|<!--|;|/\\*|\\*|^|^[ \\t]*(-|\\d+.))\\s*(TODO|FIXME|HACK|BUG|XXX)\\b";
const TAG_PARSE = /(TODO|FIXME|HACK|BUG|XXX)\b[ \t]*:?[ \t]*(.*)$/;
// Tag pill colors — TODO leans on the brand blue; the rest map to their severity.
const TAG_STYLE: Record<string, string> = {
  TODO: "text-blue-300 bg-blue-500/15",
  FIXME: "text-amber-300 bg-amber-500/15",
  HACK: "text-fuchsia-300 bg-fuchsia-500/15",
  BUG: "text-red-300 bg-red-500/15",
  XXX: "text-orange-300 bg-orange-500/15",
};

/** Split a matched line into its tag keyword and the message that follows it. Falls back to the
 *  whole line when the tag can't be isolated (e.g. a clipped very-long line). */
function parseTag(text: string): { tag: string; message: string } {
  const m = TAG_PARSE.exec(text);
  if (m) return { tag: m[1], message: m[2].trim() || text.trim() };
  return { tag: "TODO", message: text.trim() };
}

/** The TODOs side bar — a VS Code "Todo Tree" / Zed-style panel. Scans the workspace folder for
 *  TODO/FIXME/HACK/BUG/XXX comments via find-in-files, groups them by file, and jumps to the
 *  file+line on click. Re-runs on demand from the refresh button. */
export function TodosPanel({ rootPath }: { rootPath: string }) {
  const jumpToLine = useRoom(s => s.jumpToLine);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const q = useQuery({
    queryKey: ["todos", rootPath],
    queryFn: () => api.search({ root: rootPath, query: TODO_QUERY, regexp: true, caseSensitive: true }),
  });

  const results: SearchFileResult[] = q.data?.results ?? [];
  const total = q.data?.total ?? 0;

  const toggle = (file: string) =>
    setCollapsed(s => { const n = new Set(s); n.has(file) ? n.delete(file) : n.add(file); return n; });

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-3 pt-2 pb-1 flex items-center justify-between">
        <span className="text-[11px] tracking-wide text-muted">
          TODOS{total > 0 && <span className="text-dim"> · {total}</span>}
        </span>
        <button onClick={() => q.refetch()} disabled={q.isFetching} title="Rescan workspace"
          className="text-dim hover:text-fg text-xs leading-none disabled:opacity-40">{q.isFetching ? "…" : "⟳"}</button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto pb-2">
        {q.isLoading && <div className="px-3 py-2 text-xs text-dim">scanning for TODOs…</div>}
        {q.isError && <div className="px-3 py-2 text-xs text-red-400">{(q.error as Error).message}</div>}
        {q.data?.error && <div className="px-3 py-2 text-xs text-red-400">{q.data.error}</div>}
        {!q.isLoading && !q.isError && !q.data?.error && total === 0 && (
          <div className="px-3 py-4 text-xs text-dim leading-relaxed">
            No TODOs found.
            <div className="mt-1 text-dim">
              Leave a <span className="font-mono text-dim">// TODO</span>, <span className="font-mono text-dim">FIXME</span>,
              {" "}<span className="font-mono text-dim">HACK</span>, <span className="font-mono text-dim">BUG</span> or
              {" "}<span className="font-mono text-dim">XXX</span> comment and rescan.
            </div>
          </div>
        )}

        {results.map((file) => {
          const rel = relTo(rootPath, file.path);
          const dir = dirOf(rel);
          const isCollapsed = collapsed.has(file.path);
          return (
            <div key={file.path} className="mb-0.5">
              <div className="group px-2 py-1 flex items-center gap-1 cursor-pointer hover:bg-panel text-xs text-muted"
                onClick={() => toggle(file.path)} title={rel}>
                <span className="text-dim">{isCollapsed ? "▸" : "▾"}</span>
                <span className="truncate text-fg">{file.name}</span>
                {dir && <span className="truncate text-dim">{dir}</span>}
                <span className="ml-auto text-dim shrink-0">{file.matches.length}</span>
              </div>
              {!isCollapsed && file.matches.map((m, i) => {
                const { tag, message } = parseTag(m.text);
                return (
                  <div key={`${m.line}:${m.col}:${i}`}
                    onClick={() => jumpToLine({ path: file.path, name: file.name }, m.line)}
                    title={`${rel}:${m.line}`}
                    className="group px-3 py-1 flex items-center gap-2 cursor-pointer hover:bg-elevated text-sm">
                    <span className="text-dim text-xs tabular-nums shrink-0">L{m.line}</span>
                    <span className={`px-1 py-0.5 rounded text-[10px] font-medium leading-none shrink-0 ${TAG_STYLE[tag] ?? "text-dim bg-white/5"}`}>{tag}</span>
                    <span className="truncate text-fg">{message}</span>
                  </div>
                );
              })}
            </div>
          );
        })}

        {q.data?.truncated && (
          <div className="px-3 py-2 text-[11px] text-dim italic">Showing the first {total} matches — clean some up and rescan to see the rest.</div>
        )}
      </div>
    </div>
  );
}
