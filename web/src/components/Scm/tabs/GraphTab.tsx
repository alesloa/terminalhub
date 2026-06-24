import { Fragment, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { api } from "../../../api/client";
import type { GitCommit } from "../../../api/types";
import { useRoom } from "../../../store/room";
import { useToasts } from "../../../store/toasts";
import { RefBadge, badge, base, dir } from "../parts";
import { useGit } from "../useGit";
import { CommitContextMenu } from "../CommitContextMenu";
import { CommitHoverCard } from "../CommitHoverCard";

const PAGE = 20; // commits per page — start small, grow on scroll (repos can have thousands)

// VS Code SCM-graph geometry (src/vs/workbench/contrib/scm/browser/scmHistory.ts).
const ROW_H = 22;     // SWIMLANE_HEIGHT
const FILE_H = 20;    // height of one changed-file row under an expanded commit
const LANE = 11;      // SWIMLANE_WIDTH — horizontal spacing between lanes
const CURVE = 5;      // SWIMLANE_CURVE_RADIUS
const R = 4;          // CIRCLE_RADIUS
// VS Code's five graph colours, cycled per new branch lane.
const COLORS = ["#FFB000", "#DC267F", "#994F00", "#40B0A6", "#B66DFF"];
// The checked-out branch's lane is painted VS Code blue (scmGraph.historyItemRefColor → chartsBlue
// → editorInfoForeground = #3794ff), exactly like VS Code. FIXED hex on purpose — it must NEVER
// follow the active theme or a peacock accent override (which recolors --tr-accent inside a room),
// so the graph looks identical everywhere. Other lanes cycle COLORS — a linear history is blue, not gold.
const REF_COLOR = "#3794ff";
const BG = "rgb(var(--tr-bg))";        // panel background, for punching circle/lane holes

const rot = (i: number, n: number) => ((i % n) + n) % n;

interface Lane { id: string; color: string } // a swimlane: the hash it's flowing toward
interface VM { commit: GitCommit; head: boolean; input: Lane[]; output: Lane[] }

/**
 * Port of VS Code's `toISCMHistoryItemViewModelArray`: walk commits newest→oldest, carrying
 * each row's *output* swimlanes into the next row's *input*. A commit replaces its own lane
 * with its first parent; extra parents (merges) append fresh lanes with cycling colours.
 */
function buildViewModels(commits: GitCommit[], headHash: string | null): VM[] {
  // The checked-out branch, from the ref flagged `current` ("HEAD -> <branch>"). Commits
  // carrying that branch (or its remote tracking ref, e.g. origin/main) seed a blue lane that
  // propagates down — VS Code's behaviour, and why a linear history is one solid blue line.
  const currentBranch = commits.flatMap(c => c.refs).find(r => r.current)?.name ?? null;
  const onCurrentBranch = (c: GitCommit): boolean => {
    if (!currentBranch) return c.refs.some(r => r.kind === "head"); // detached: colour the HEAD commit
    return c.refs.some(r =>
      r.current ||
      (r.kind === "branch" && r.name === currentBranch) ||
      (r.kind === "remote" && r.name.endsWith(`/${currentBranch}`)) ||
      r.kind === "head");
  };

  let colorIndex = -1;
  const vms: VM[] = [];
  for (const commit of commits) {
    const id = commit.hash;
    const refColor = onCurrentBranch(commit) ? REF_COLOR : undefined; // blue for the current branch
    const input: Lane[] = (vms.length ? vms[vms.length - 1].output : []).map(n => ({ ...n }));
    const output: Lane[] = [];
    let firstParentAdded = false;

    if (commit.parents.length > 0) {
      for (const node of input) {
        if (node.id === id) {
          // First lane that wants this commit continues as its first parent; later
          // duplicate lanes (two branches that met here) collapse into it. The ref colour
          // (if any) recolours the lane here, then propagates down via node.color.
          if (!firstParentAdded) { output.push({ id: commit.parents[0], color: refColor ?? node.color }); firstParentAdded = true; }
          continue;
        }
        output.push({ ...node }); // unrelated lane flows straight through
      }
    }
    // Remaining parents get new lanes on the right. When this commit wasn't in any input
    // lane (a branch tip), i starts at 0 so its first parent lands here — blue if it's the
    // current branch, otherwise the next cycling palette colour.
    for (let i = firstParentAdded ? 1 : 0; i < commit.parents.length; i++) {
      let color = i === 0 ? refColor : undefined;
      if (!color) { colorIndex = rot(colorIndex + 1, COLORS.length); color = COLORS[colorIndex]; }
      output.push({ id: commit.parents[i], color });
    }

    vms.push({ commit, head: id === headHash, input, output });
  }
  return vms;
}

interface Rendered { paths: { d: string; color: string }[]; cx: number; color: string; width: number; head: boolean; merge: boolean }

/** Port of `renderSCMHistoryItemGraph`: build the SVG paths + node geometry for one row. */
function renderRow(vm: VM): Rendered {
  const { input, output, commit, head } = vm;
  const id = commit.hash;
  const inputIndex = input.findIndex(n => n.id === id);
  const circleIndex = inputIndex !== -1 ? inputIndex : input.length;
  const color =
    circleIndex < output.length ? output[circleIndex].color
    : circleIndex < input.length ? input[circleIndex].color
    : REF_COLOR;

  const paths: { d: string; color: string }[] = [];
  let out = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input[i].color;
    if (input[i].id === id) {
      if (i !== circleIndex) {
        // A second lane arriving at this commit: arc down-left into the node, then run across.
        paths.push({ color: c, d:
          `M ${LANE * (i + 1)} 0 A ${LANE} ${LANE} 0 0 1 ${LANE * i} ${LANE} H ${LANE * (circleIndex + 1)}` });
      } else {
        out++;
      }
    } else if (out < output.length && input[i].id === output[out].id) {
      if (i === out) {
        paths.push({ color: c, d: `M ${LANE * (i + 1)} 0 V ${ROW_H}` }); // straight through
      } else {
        // Lane shifting left by one column: down, quarter-arc in, across, quarter-arc out, down.
        paths.push({ color: c, d:
          `M ${LANE * (i + 1)} 0 V 6 ` +
          `A ${CURVE} ${CURVE} 0 0 1 ${LANE * (i + 1) - CURVE} ${ROW_H / 2} ` +
          `H ${LANE * (out + 1) + CURVE} ` +
          `A ${CURVE} ${CURVE} 0 0 0 ${LANE * (out + 1)} ${ROW_H / 2 + CURVE} V ${ROW_H}` });
      }
      out++;
    }
  }
  // Merge parents: arc out of the node toward each extra parent's lane.
  for (let k = 1; k < commit.parents.length; k++) {
    let pi = -1;
    for (let j = output.length - 1; j >= 0; j--) if (output[j].id === commit.parents[k]) { pi = j; break; }
    if (pi === -1) continue;
    paths.push({ color: output[pi].color, d:
      `M ${LANE * pi} ${ROW_H / 2} A ${LANE} ${LANE} 0 0 1 ${LANE * (pi + 1)} ${ROW_H} ` +
      `M ${LANE * pi} ${ROW_H / 2} H ${LANE * (circleIndex + 1)}` });
  }
  // Node stem: up to the incoming lanes, down to the outgoing ones.
  if (inputIndex !== -1) paths.push({ color: input[inputIndex].color, d: `M ${LANE * (circleIndex + 1)} 0 V ${ROW_H / 2}` });
  if (commit.parents.length > 0) paths.push({ color, d: `M ${LANE * (circleIndex + 1)} ${ROW_H / 2} V ${ROW_H}` });

  const lanes = Math.max(input.length, output.length, 1);
  return { paths, cx: LANE * (circleIndex + 1), color, width: LANE * (lanes + 1), head, merge: commit.parents.length > 1 };
}

/** The commit node: a ring for HEAD, a donut for merges, a solid dot otherwise. */
function Node({ cx, color, head, merge }: Rendered) {
  const cy = LANE;
  if (head) return (<>
    <circle cx={cx} cy={cy} r={5.5} fill={BG} stroke={color} strokeWidth={2.5} />
    <circle cx={cx} cy={cy} r={2} fill={color} />
  </>);
  if (merge) return (<>
    <circle cx={cx} cy={cy} r={4.5} fill={color} />
    <circle cx={cx} cy={cy} r={1.8} fill={BG} />
  </>);
  return <circle cx={cx} cy={cy} r={R} fill={color} />;
}

/**
 * The changed-file rows shown when a commit is expanded. The commit's outgoing swimlanes
 * (`vm.output`) continue straight down through every file row, so the graph stays unbroken
 * between this commit and the next — VS Code's behaviour (the blue bar running down the
 * expanded section). Each file opens its own side-by-side diff (parent vs this commit).
 */
function CommitFiles({ root, hash, gutterWidth, lanes, onOpenFile }:
  { root: string; hash: string; gutterWidth: number; lanes: Lane[]; onOpenFile: (file: string) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["git", "commitFiles", root, hash],
    queryFn: () => api.git.commitFiles(root, hash),
    staleTime: Infinity, // a commit's file list never changes
  });
  // Straight vertical continuations of every lane flowing out the bottom of the commit row.
  const gutter = (
    <svg width={gutterWidth} height={FILE_H} style={{ width: gutterWidth }} className="shrink-0 overflow-visible">
      {lanes.map((ln, j) => <path key={j} d={`M ${LANE * (j + 1)} 0 V ${FILE_H}`} fill="none" stroke={ln.color} strokeWidth={1.5} />)}
    </svg>
  );
  const note = (text: string) => (
    <div style={{ height: FILE_H }} className="flex items-center gap-1 pr-2">{gutter}<span className="text-[11px] text-dim">{text}</span></div>
  );
  if (isLoading) return note("loading files…");
  const files = data?.files ?? [];
  if (!files.length) return note("No file changes.");
  return (<>
    {files.map(f => {
      const b = badge(f.status);
      return (
        <div key={f.path} style={{ height: FILE_H }} title={f.path}
          onClick={() => onOpenFile(f.path)}
          className="flex items-center gap-1 pr-2 cursor-pointer hover:bg-surface">
          {gutter}
          <span className="min-w-0 shrink truncate text-fg text-[12px]">{base(f.path)}</span>
          <span className="min-w-0 shrink-[3] truncate text-dim text-[11px]">{dir(f.path)}</span>
          <span className={`shrink-0 ml-auto text-[10px] font-medium ${b.c}`} title={b.label}>{b.t}</span>
        </div>
      );
    })}
  </>);
}

/** Commit DAG, rendered as VS Code's coloured swimlane graph beside each commit. */
export function GraphTab({ rootPath }: { rootPath: string }) {
  // Infinite scroll: refetch from HEAD with a growing limit so the DAG stays contiguous.
  const [count, setCount] = useState(PAGE);
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["git", "log", rootPath, count],
    queryFn: () => api.git.log(rootPath, count),
    refetchInterval: 5000,
    placeholderData: keepPreviousData,
  });

  const openCommitDiff = useRoom(s => s.openCommitDiff);
  const openCommitFileDiff = useRoom(s => s.openCommitFileDiff);
  const push = useToasts(s => s.push);
  const { run: gitRun } = useGit();
  const [menu, setMenu] = useState<{ commit: GitCommit; x: number; y: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Which commits are expanded to show their changed files inline (VS Code's graph drill-down).
  // A click on a commit row toggles its set membership; the whole-commit diff stays on the
  // right-click "Open Changes".
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (hash: string) =>
    setExpanded(s => { const n = new Set(s); n.has(hash) ? n.delete(hash) : n.add(hash); return n; });

  // Hover card (commit details). Shows after a short dwell; a small close delay lets the
  // pointer travel from the row into the card without it vanishing.
  const [hover, setHover] = useState<{ commit: GitCommit; rect: DOMRect } | null>(null);
  const showT = useRef<number | null>(null);
  const hideT = useRef<number | null>(null);
  const clearShow = () => { if (showT.current) { clearTimeout(showT.current); showT.current = null; } };
  const clearHide = () => { if (hideT.current) { clearTimeout(hideT.current); hideT.current = null; } };
  const openHover = (commit: GitCommit, rect: DOMRect) => { clearHide(); clearShow(); showT.current = window.setTimeout(() => setHover({ commit, rect }), 420); };
  const closeHoverSoon = () => { clearShow(); hideT.current = window.setTimeout(() => setHover(null), 180); };
  const closeHoverNow = () => { clearShow(); clearHide(); setHover(null); };
  useEffect(() => () => { clearShow(); clearHide(); }, []);

  const loaded = data?.commits.length ?? 0;
  const hasMore = loaded === count; // a full page back means there may be more
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (hasMore && el.scrollHeight - el.scrollTop - el.clientHeight < 240) {
      setCount(c => (loaded >= c ? c + PAGE : c)); // only grow once the current page arrived
    }
  };

  const { vms, headHash } = useMemo(() => {
    const commits = data?.commits ?? [];
    const headHash = commits.find(c => c.refs.some(r => r.current || r.kind === "head"))?.hash ?? null;
    return { vms: buildViewModels(commits, headHash), headHash };
  }, [data?.commits]);

  // Scroll alone can't load more when the panel is tall enough to show the whole current page
  // without overflowing — there's nothing to scroll. Auto-grow until the content fills the
  // viewport, re-checking when the data arrives (deps) or the panel is resized (ResizeObserver).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const fill = () => {
      if (hasMore && !isFetching && el.scrollHeight <= el.clientHeight) {
        setCount(c => (loaded >= c ? c + PAGE : c)); // only grow once the current page arrived
      }
    };
    fill();
    const ro = new ResizeObserver(fill);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasMore, isFetching, loaded, count]);

  const copy = (text: string, what: string) => { void navigator.clipboard?.writeText(text); push(`Copied commit ${what}`); };
  const undo = () => {
    if (!window.confirm("Undo the last commit? Its changes stay staged (git reset --soft HEAD~1).")) return;
    gitRun(() => api.git.uncommit(rootPath));
  };

  if (isLoading) return <div className="flex-1 flex items-center justify-center text-xs text-dim">loading history…</div>;
  if (!vms.length) return <div className="flex-1 flex items-center justify-center text-xs text-dim">No commits yet.</div>;

  return (
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto" onScroll={onScroll}>
      {vms.map(vm => {
        const g = renderRow(vm);
        const c = vm.commit;
        const badges = c.refs.filter(r => r.kind === "branch" || r.kind === "tag"); // local tips + tags only
        const isOpen = expanded.has(c.hash);
        return (
          <Fragment key={c.hash}>
            <div style={{ height: ROW_H }}
              onClick={() => { closeHoverNow(); toggleExpand(c.hash); }}
              onContextMenu={e => { e.preventDefault(); closeHoverNow(); setMenu({ commit: c, x: e.clientX, y: e.clientY }); }}
              onMouseEnter={e => { if (!isOpen) openHover(c, e.currentTarget.getBoundingClientRect()); }}
              onMouseLeave={closeHoverSoon}
              className="flex items-center gap-1 pr-2 cursor-pointer hover:bg-surface">
              <svg width={g.width} height={ROW_H} style={{ width: g.width }} className="shrink-0 overflow-visible">
                {g.paths.map((p, k) => <path key={k} d={p.d} fill="none" stroke={p.color} strokeWidth={1.5} strokeLinecap="round" />)}
                <Node {...g} />
              </svg>
              {/* No expand affordance — clicking the row toggles its file list (VS Code shows none either).
                  The subject sits 4px off the graph (VS Code's label margin, scm.css), tight like #17. */}
              <span className="flex-1 min-w-0 truncate text-fg text-[13px] leading-none">{c.subject}</span>
              {badges.length > 0 && (
                <span className="shrink-0 flex items-center gap-1">{badges.map(r => <RefBadge key={r.name} refItem={r} />)}</span>
              )}
              <span className="shrink-0 truncate max-w-[6rem] text-[11px] text-dim">{c.author}</span>
            </div>
            {isOpen && (
              <CommitFiles root={rootPath} hash={c.hash} gutterWidth={g.width} lanes={vm.output}
                onOpenFile={file => openCommitFileDiff({ hash: c.hash, file, name: base(file), root: rootPath })} />
            )}
          </Fragment>
        );
      })}
      {hasMore && (
        <div className="px-3 py-2 text-center text-[10px] text-dim">{isFetching ? "loading more…" : "scroll for more"}</div>
      )}

      {hover && !menu && (
        <CommitHoverCard
          commit={hover.commit} rect={hover.rect}
          onCopySha={() => copy(hover.commit.hash, "SHA")}
          onMouseEnter={clearHide}
          onMouseLeave={closeHoverSoon}
        />
      )}

      {menu && (
        <CommitContextMenu
          commit={menu.commit} isHead={menu.commit.hash === headHash} x={menu.x} y={menu.y}
          onOpenChanges={() => openCommitDiff({ hash: menu.commit.hash, name: menu.commit.subject || menu.commit.hash.slice(0, 8), root: rootPath })}
          onCopySha={() => copy(menu.commit.hash, "SHA")}
          onCopyMessage={() => copy(menu.commit.body ? `${menu.commit.subject}\n\n${menu.commit.body}` : menu.commit.subject, "message")}
          onUndo={undo}
          dismiss={() => setMenu(null)}
        />
      )}
    </div>
  );
}
