import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { GitCommit } from "../../api/types";
import { GitGate } from "./GitGate";

const ROW_H = 38;
const LANE_W = 14;
const R = 4;
const PALETTE = ["rgb(var(--tr-accent))", "rgb(var(--tr-success))", "#eab308", "#ec4899", "#a855f7", "#06b6d4", "#f97316"];

interface Placed { commit: GitCommit; col: number }

/** Assign each commit a lane (column) from its parent topology — the classic gitk layout. */
function layout(commits: GitCommit[]): { rows: Placed[]; maxCol: number } {
  const tips: (string | null)[] = []; // hash each lane is currently waiting to render
  const free = () => { const i = tips.indexOf(null); return i === -1 ? tips.length : i; };
  const rows: Placed[] = [];
  let maxCol = 0;

  for (const c of commits) {
    let col = tips.indexOf(c.hash);
    if (col === -1) { col = free(); }
    tips[col] = c.parents[0] ?? null; // first parent continues this lane (or lane frees)
    for (let k = 1; k < c.parents.length; k++) {
      let pc = tips.indexOf(c.parents[k]);
      if (pc === -1) { pc = free(); tips[pc] = c.parents[k]; }
    }
    maxCol = Math.max(maxCol, ...tips.map((_, i) => i), col);
    rows.push({ commit: c, col });
  }
  return { rows, maxCol };
}

export function GitGraph({ rootPath }: { rootPath: string }) {
  return (
    <GitGate rootPath={rootPath}>
      <GraphBody rootPath={rootPath} />
    </GitGate>
  );
}

function GraphBody({ rootPath }: { rootPath: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["git", "log", rootPath],
    queryFn: () => api.git.log(rootPath, 300),
    refetchInterval: 5000,
  });

  const { rows, maxCol, pos } = useMemo(() => {
    const commits = data?.commits ?? [];
    const { rows, maxCol } = layout(commits);
    const pos = new Map<string, { row: number; col: number }>();
    rows.forEach((r, i) => pos.set(r.commit.hash, { row: i, col: r.col }));
    return { rows, maxCol, pos };
  }, [data?.commits]);

  if (isLoading) return <div className="flex-1 flex items-center justify-center text-xs text-dim">loading history…</div>;
  if (!rows.length) return <div className="flex-1 flex items-center justify-center text-xs text-dim">No commits yet.</div>;

  const graphW = (maxCol + 1) * LANE_W + 6;
  const x = (col: number) => LANE_W / 2 + col * LANE_W;
  const y = (row: number) => ROW_H / 2 + row * ROW_H;
  const total = rows.length * ROW_H;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-3 h-8 shrink-0 flex items-center text-[11px] tracking-wide text-muted">GIT GRAPH</div>
      <div className="flex-1 overflow-auto relative">
        <div className="relative" style={{ height: total }}>
          <svg width={graphW} height={total} className="absolute left-0 top-0 pointer-events-none">
            {rows.map((r, i) => r.commit.parents.map(ph => {
              const p = pos.get(ph);
              if (!p) return null; // parent outside the loaded window
              const x1 = x(r.col), y1 = y(i), x2 = x(p.col), y2 = y(p.row);
              const color = PALETTE[r.col % PALETTE.length];
              const d = x1 === x2
                ? `M${x1},${y1} L${x2},${y2}`
                : `M${x1},${y1} C${x1},${y1 + ROW_H * 0.6} ${x2},${y1 + ROW_H * 0.4} ${x2},${Math.min(y2, y1 + ROW_H)} L${x2},${y2}`;
              return <path key={ph + i} d={d} stroke={color} strokeWidth={1.5} fill="none" />;
            }))}
            {rows.map((r, i) => (
              <circle key={r.commit.hash} cx={x(r.col)} cy={y(i)} r={R}
                fill="rgb(var(--tr-bg))" stroke={PALETTE[r.col % PALETTE.length]} strokeWidth={2} />
            ))}
          </svg>

          {rows.map((r, i) => (
            <div key={r.commit.hash} className="absolute flex items-center gap-1.5 pr-2 hover:bg-surface"
              style={{ top: i * ROW_H, height: ROW_H, left: graphW, right: 0 }}
              title={`${r.commit.hash.slice(0, 8)} · ${r.commit.author}`}>
              {r.commit.refs.map(ref => <RefBadge key={ref.name} ref={ref.name} />)}
              <span className="truncate text-fg text-[13px]">{r.commit.subject}</span>
              <span className="ml-auto shrink-0 text-[10px] text-dim tabular-nums">{relTime(r.commit.date)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RefBadge({ ref }: { ref: string }) {
  const isTag = ref.startsWith("tag: ");
  const isHead = ref.startsWith("HEAD");
  const label = ref.replace(/^tag: /, "").replace(/^HEAD -> /, "");
  const cls = isTag ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
    : isHead ? "bg-blue-500/20 text-blue-200 border-blue-500/40"
    : "bg-elevated text-fg border-edge-strong";
  return <span className={`shrink-0 px-1 rounded text-[10px] border ${cls}`}>{isHead && ref === "HEAD" ? "HEAD" : label}</span>;
}

function relTime(sec: number): string {
  if (!sec) return "";
  const d = Math.floor(Date.now() / 1000) - sec;
  if (d < 60) return `${d}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  if (d < 2592000) return `${Math.floor(d / 86400)}d`;
  if (d < 31536000) return `${Math.floor(d / 2592000)}mo`;
  return `${Math.floor(d / 31536000)}y`;
}
