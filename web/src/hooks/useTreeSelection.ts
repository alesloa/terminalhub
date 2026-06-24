import { useContext, type MouseEvent as ReactMouseEvent, type DragEvent as ReactDragEvent } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { FsListing } from "../api/types";
import { RoomContext, useRoom } from "../store/room";
import { startPathDrag } from "../lib/dragImage";

// Flatten the *visible* tree into render order — the exact sequence the rows appear on screen, so a
// shift-range selects precisely what the eye sees. Mirrors DirChildren: a dir's children show only
// when expanded; within a dir, folders come before files, and files honour the filename filter.
function flattenVisible(qc: QueryClient, root: string, expanded: Set<string>, filter: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    const data = qc.getQueryData<FsListing>(["fs", dir]);
    if (!data) return;
    for (const d of data.entries.filter(e => e.type === "dir")) {
      out.push(d.path);
      if (expanded.has(d.path)) walk(d.path);
    }
    for (const f of data.entries.filter(e => e.type === "file" && (!filter || e.name.toLowerCase().includes(filter)))) {
      out.push(f.path);
    }
  };
  walk(root);
  return out;
}

/**
 * Explorer multi-selection: plain click selects one (and opens/toggles via `onPlain`), Ctrl/Cmd-click
 * toggles a row in/out, Shift-click selects the contiguous range from the anchor. `dragStart` carries
 * the whole selection when you grab a selected row, else just the grabbed one. Reads live state
 * imperatively off the room store so it doesn't re-subscribe (or re-render) every row on each click.
 */
export function useTreeSelection(rootPath: string, filter: string) {
  const qc = useQueryClient();
  const store = useContext(RoomContext)!;
  const select = useRoom(s => s.selectExplorer);
  const addSelect = useRoom(s => s.addSelect);
  const selectRange = useRoom(s => s.selectRange);

  const range = (clicked: string) => {
    const st = store.getState();
    const anchor = st.selectionAnchor ?? clicked;
    const order = flattenVisible(qc, rootPath, st.expandedDirs, filter.trim().toLowerCase());
    const a = order.indexOf(anchor), b = order.indexOf(clicked);
    if (a === -1 || b === -1) { select(clicked); return; }
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    selectRange(order.slice(lo, hi + 1), clicked);
  };

  const click = (path: string, e: ReactMouseEvent, onPlain: () => void) => {
    if (e.metaKey || e.ctrlKey) { addSelect(path); return; }   // toggle, no open/expand
    if (e.shiftKey) { range(path); return; }                   // range, no open/expand
    select(path); onPlain();                                   // plain: select + open/expand
  };

  const dragStart = (path: string, e: ReactDragEvent<HTMLElement>) => {
    const sel = store.getState().selectedPaths;
    const paths = sel.has(path) && sel.size > 1 ? [...sel] : [path];
    if (!sel.has(path)) select(path); // grabbing an unselected row selects it first
    startPathDrag(e, paths);
  };

  return { click, dragStart };
}
