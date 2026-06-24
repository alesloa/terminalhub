import { useEffect, useRef, useState, type CSSProperties, type TransitionEventHandler } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { WinRect } from "../store/ui";
import { useUi, spacesBarBottom } from "../store/ui";
import { useDraggableWindow } from "../hooks/useDraggableWindow";
import { ResizeHandles } from "./ResizeHandles";

const RECT_KEY = "tr.scrollbackRect"; // remembered window geometry (per-browser)
const MIN_W = 480, MIN_H = 300;
const DURATION = 300;                  // ms — grow-from-icon / minimize-to-icon animation

/** A comfortable reading box (~820px), centered and clamped below the spaces bar. */
function defaultRect(): WinRect {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(820, Math.round(vw * 0.8));
  const h = Math.round(vh * 0.78);
  const top = spacesBarBottom() + 8;
  return { w, h, x: Math.max(8, Math.round((vw - w) / 2)), y: Math.max(top, Math.round((vh - h) / 2)) };
}

/** Restore the saved geometry, clamped back into the current viewport (it may have shrunk). */
function loadRect(): WinRect {
  try {
    const raw = localStorage.getItem(RECT_KEY);
    if (raw) {
      const r = JSON.parse(raw) as Partial<WinRect>;
      if (typeof r.x === "number" && typeof r.y === "number" && typeof r.w === "number" && typeof r.h === "number") {
        const vw = window.innerWidth, vh = window.innerHeight;
        const w = Math.max(MIN_W, Math.min(r.w, vw - 16));
        const h = Math.max(MIN_H, Math.min(r.h, vh - 16));
        return { w, h, x: Math.max(8, Math.min(vw - 80, r.x)), y: Math.max(8, Math.min(vh - 60, r.y)) };
      }
    }
  } catch { /* ignore corrupt/blocked storage */ }
  return defaultRect();
}

/**
 * Terminal scrollback viewer — a free-floating, draggable, resizable window that shows a terminal's
 * full tmux buffer (history + live screen) as REAL selectable DOM text. Native browser selection then
 * works the way the in-pane grid can't: click at the top, scroll all the way down, shift-click the
 * bottom, ⌘/Ctrl-C — the highlight follows because the text is real, not a repainting fixed grid.
 * Store-signalled (it lives in App, outside the transformed Room frame); grows from / minimizes into
 * the opener button on the terminal pane — mirrors SystemMonitor.
 */
export function ScrollbackViewer({ terminalId, onClose }: { terminalId: string; onClose: () => void }) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  // Snapshot the buffer once on open (capture-pane is a point-in-time dump). The Refresh button
  // re-captures on demand; otherwise it never auto-polls — a moving target while you select is the
  // exact bug this window exists to avoid.
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["scrollback", terminalId],
    queryFn: () => api.terminalScrollback(terminalId),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const text = data?.text ?? "";

  // The terminal's name for the title bar, read free from the cached workspaces list.
  const wsData = useQuery({ queryKey: ["workspaces"], queryFn: api.listWorkspaces }).data;
  const title = wsData?.workspaces.flatMap(w => w.terminals ?? []).find(t => t.id === terminalId)?.title ?? "Terminal";

  // Free-floating, draggable, resizable window — drag the title bar, grab the edges to resize.
  const [seed] = useState(loadRect);
  const { rect, beginDrag, beginResize } = useDraggableWindow(seed, MIN_W, MIN_H);

  // Grow-from-icon on open, minimize-to-icon on close. The opener button rect rides in on the store;
  // capture it once so a later store change can't move the target mid-animation.
  const [origin] = useState<WinRect | null>(() => useUi.getState().scrollbackOrigin);
  const reduce = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [expanded, setExpanded] = useState(reduce);
  useEffect(() => {
    if (reduce) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setExpanded(true)));
    return () => cancelAnimationFrame(id);
  }, [reduce]);
  const handleClose = () => { if (reduce) { onClose(); return; } setExpanded(false); };
  const onTransitionEnd: TransitionEventHandler = (e) => {
    if (e.target === e.currentTarget && e.propertyName === "transform" && !expanded) onClose();
  };

  // A second press of the terminal's "view buffer" button bumps scrollbackCloseSeq (the viewer lives
  // in App, not the pane, so it's signalled through the store). Run the same minimize-to-icon close on
  // each bump after mount — the ref seeds with the mount value so the initial render never self-closes.
  const closeSeq = useUi(s => s.scrollbackCloseSeq);
  const seenCloseSeq = useRef(closeSeq);
  useEffect(() => {
    if (closeSeq === seenCloseSeq.current) return;
    seenCloseSeq.current = closeSeq;
    handleClose();
  }, [closeSeq]); // eslint-disable-line react-hooks/exhaustive-deps

  // Remember the geometry, debounced so a drag/resize doesn't hammer localStorage every frame.
  useEffect(() => {
    const t = window.setTimeout(() => { try { localStorage.setItem(RECT_KEY, JSON.stringify(rect)); } catch { /* blocked */ } }, 300);
    return () => window.clearTimeout(t);
  }, [rect]);

  const copyAll = () => {
    navigator.clipboard?.writeText(text)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })
      .catch(() => {});
  };
  // Select the whole buffer as a real DOM selection (so the user can then ⌘/Ctrl-C, or just see it
  // highlighted), exactly like "Select All" in a text view.
  const selectAll = () => {
    const el = preRef.current;
    if (!el) return;
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
  };

  const collapsed = origin
    ? `translate(${origin.x - rect.x}px, ${origin.y - rect.y}px) scale(${origin.w / rect.w}, ${origin.h / rect.h})`
    : "scale(0.94)";
  const style: CSSProperties = {
    left: rect.x, top: rect.y, width: rect.w, height: rect.h,
    ...(reduce ? {} : {
      transformOrigin: origin ? "0 0" : "50% 50%",
      transform: expanded ? "translate(0px, 0px) scale(1, 1)" : collapsed,
      opacity: expanded ? 1 : 0,
      // Animate transform/opacity only — NOT left/top/width/height — so drag/resize tracks instantly.
      transition: `transform ${DURATION}ms cubic-bezier(.22,.61,.36,1), opacity ${DURATION}ms ease`,
      willChange: "transform, opacity",
    }),
  };

  return (
    // A free-floating, draggable, resizable window (NOT a modal — it never dims the canvas).
    <div onTransitionEnd={onTransitionEnd} style={style}
      className="fixed z-50 flex flex-col rounded-lg overflow-hidden border border-edge-strong bg-canvas shadow-2xl">
      {/* Title bar = drag handle. The buttons stop pointer-down so they never start a drag. */}
      <div onPointerDown={beginDrag}
        className="h-9 shrink-0 flex items-center justify-between gap-3 px-3 border-b border-edge cursor-move select-none">
        <div className="min-w-0 flex items-center gap-2">
          <span className="font-semibold truncate">Buffer</span>
          <span className="text-dim text-sm truncate">{title}</span>
        </div>
        <div className="flex items-center gap-1.5" onPointerDown={e => e.stopPropagation()}>
          <button onClick={selectAll} title="Select the whole buffer"
            className="px-2.5 h-6 inline-flex items-center bg-elevated hover:bg-edge rounded text-xs text-fg hover:text-bright">Select all</button>
          <button onClick={copyAll} title="Copy the whole buffer to the clipboard"
            className="px-2.5 h-6 inline-flex items-center bg-elevated hover:bg-edge rounded text-xs text-fg hover:text-bright">{copied ? "Copied" : "Copy all"}</button>
          <button onClick={() => refetch()} disabled={isFetching} title="Re-capture the buffer now"
            className="px-2.5 h-6 inline-flex items-center bg-elevated hover:bg-edge rounded text-xs text-fg hover:text-bright disabled:opacity-40">
            {isFetching ? "…" : "Refresh"}</button>
          <button onClick={handleClose} title="Close"
            className="px-2.5 h-6 inline-flex items-center bg-elevated rounded text-xs">Close</button>
        </div>
      </div>

      {/* The buffer as real, selectable DOM text. select-text overrides any inherited select-none;
          whitespace-pre-wrap keeps every character reachable by VERTICAL scroll (no horizontal
          scroll hiding content mid-selection), so a top-to-bottom drag selects exactly what you see.
          The bg-panel parent fills the area; the scroller is inset 8px on the right (marginRight) so
          its fat scrollbar sits INSIDE the window's resize strip — the thumb stays grabbable with the
          normal cursor instead of triggering ew-resize. The gutter shows the parent's panel bg. */}
      <div className="flex-1 min-h-0 bg-panel">
        <div className="h-full overflow-auto tr-scroll-wide" style={{ marginRight: 8 }}>
          {isLoading ? (
            <div className="p-4 text-dim text-sm">capturing…</div>
          ) : error ? (
            <div className="p-4 text-red-400 text-sm">{(error as Error).message}</div>
          ) : text ? (
            <pre ref={preRef} className="select-text whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-fg p-3 m-0">{text}</pre>
          ) : (
            <div className="p-4 text-dim text-sm">This terminal's buffer is empty.</div>
          )}
        </div>
      </div>

      <ResizeHandles onStart={beginResize} />
    </div>
  );
}
