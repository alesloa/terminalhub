import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { ScmTab } from "../../store/ui";
import { useRoom } from "../../store/room";
import { lockCursor } from "../../lib/dragCursor";
import { GitGate } from "./GitGate";
import { GitHeader } from "./GitHeader";
import { TabStrip } from "./TabStrip";
import { ChangesSection } from "./ChangesSection";
import { GraphTab } from "./tabs/GraphTab";
import { BranchesTab } from "./tabs/BranchesTab";
import { WorktreesTab } from "./tabs/WorktreesTab";
import { StashTab } from "./tabs/StashTab";
import { PrsTab } from "./tabs/PrsTab";

const TABS: { id: ScmTab; label: string }[] = [
  { id: "graph", label: "Graph" },
  { id: "branches", label: "Branches" },
  { id: "worktrees", label: "Worktrees" },
  { id: "stash", label: "Stash" },
  { id: "prs", label: "PRs" },
];

/**
 * The unified Source Control panel: a `folder / branch` header + Publish/Push, the commit
 * box and changed-files list, then a Graph | Branches | Worktrees | Stash | PRs tab strip.
 */
export function GitPanel({ rootPath }: { rootPath: string }) {
  return (
    <GitGate rootPath={rootPath}>
      <PanelBody rootPath={rootPath} />
    </GitGate>
  );
}

function PanelBody({ rootPath }: { rootPath: string }) {
  const tab = useRoom(s => s.scmTab);
  const setTab = useRoom(s => s.setScmTab);

  // Repo stack: the workspace root plus any submodule the user has drilled into. A dirty submodule
  // can't be staged from its parent (its inner files live in their own repo — see SubmoduleEntry), so
  // opening one re-roots the WHOLE panel (changes, header, tabs) at the submodule, where its files are
  // ordinary stageable changes — VS Code's "submodule is its own source-control scope". The breadcrumb
  // pops back out. Reset to the workspace root whenever the workspace itself changes.
  const [stack, setStack] = useState<string[]>([rootPath]);
  useEffect(() => { setStack([rootPath]); }, [rootPath]);
  const current = stack[stack.length - 1];
  const openSubmodule = (abs: string) => setStack(s => (s[s.length - 1] === abs ? s : [...s, abs]));
  const popTo = (i: number) => setStack(s => s.slice(0, i + 1));

  // The bottom block (tab strip + tab body) is a resizable, bottom-anchored region.
  // Default it to ~25% of the panel height; the commit/changes area takes the rest.
  const panelRef = useRef<HTMLDivElement>(null);
  const [bottomH, setBottomH] = useState(220);
  const [resizing, setResizing] = useState(false);
  const measured = useRef(false);
  useLayoutEffect(() => {
    if (!measured.current && panelRef.current) {
      const h = panelRef.current.clientHeight;
      if (h > 0) { setBottomH(Math.round(h * 0.25)); measured.current = true; }
    }
  });

  // Drag-to-resize the bottom block. Grabbable from BOTH the thin seam above it and the whole
  // GitHeader bar (the `folder / branch` line) — the header passes its bar pointer-down here,
  // guarding its own buttons. lockCursor pins a single row-resize cursor for the drag's lifetime
  // so it doesn't flicker as the pointer crosses the header/changes/content panes.
  const startResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    setResizing(true);
    const release = lockCursor("row-resize");
    const onMove = (ev: PointerEvent) => {
      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) return;
      // bottom-anchored: height = distance from the pointer down to the panel's bottom edge.
      // min keeps the header + tab strip visible; max leaves room for the commit box above.
      setBottomH(Math.max(120, Math.min(rect.height - 140, rect.bottom - ev.clientY)));
    };
    const onUp = () => { setResizing(false); release(); window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div ref={panelRef} className="flex-1 min-h-0 flex flex-col">
      {stack.length > 1 && <RepoBreadcrumb stack={stack} onPop={popTo} />}
      <ChangesSection rootPath={current} onOpenSubmodule={openSubmodule} />

      <div onPointerDown={startResize} title="Drag to resize"
        className={`relative z-20 h-1.5 shrink-0 cursor-row-resize border-t border-edge ${resizing ? "bg-accent/60" : "hover:bg-accent/40"}`} />

      {/* Solid, above the changes list: when dragged up over the changes area it cleanly covers
          it (the bg is the panel colour, so it's invisible in the normal layout). */}
      <div style={{ height: bottomH }} className="relative z-10 shrink-0 min-h-0 flex flex-col bg-canvas">
        {/* Only the thin top line resizes the panel; the header + tab strip are NOT grab bars. They
            still need `relative z-20` so they stack above the tab body — the graph body is a later
            flex sibling here and its first row's swimlane SVG is overflow-visible, so once the graph
            loads it would otherwise paint over the bars' (non-portalled) dropdowns. */}
        <div className="relative z-20 shrink-0 bg-canvas">
          <GitHeader rootPath={current} />
          <TabStrip tabs={TABS} active={tab} onSelect={setTab} />
        </div>

        {/* cursor-pointer cascades to every tab body so hovering the list rows (stash, worktrees,
            PRs, branches, graph) shows the hand instead of the text I-beam. */}
        <div className="flex-1 min-h-0 flex flex-col cursor-pointer">
          {tab === "graph" && <GraphTab rootPath={current} />}
          {tab === "branches" && <BranchesTab rootPath={current} />}
          {tab === "worktrees" && <WorktreesTab rootPath={current} />}
          {tab === "stash" && <StashTab rootPath={current} />}
          {tab === "prs" && <PrsTab rootPath={current} />}
        </div>
      </div>
    </div>
  );
}

/** Drill-in trail: workspace root › submodule › … Each non-last segment pops the stack back to it.
 *  Only rendered once you've opened a submodule (stack depth > 1). */
function RepoBreadcrumb({ stack, onPop }: { stack: string[]; onPop: (i: number) => void }) {
  return (
    <div className="flex items-center gap-1 px-3 h-7 shrink-0 border-b border-edge text-xs overflow-x-auto cursor-default">
      {stack.map((p, i) => {
        const name = p.split("/").pop() || p;
        const last = i === stack.length - 1;
        return (
          <span key={p} className="flex items-center gap-1 shrink-0">
            {i > 0 && <span className="text-muted">›</span>}
            {last
              ? <span className="text-fg truncate" title={p}>{name}</span>
              : <button className="text-dim hover:text-bright truncate" title={`Back to ${p}`} onClick={() => onPop(i)}>{name}</button>}
          </span>
        );
      })}
    </div>
  );
}
