import { useEffect, useMemo, useRef, useState, type MouseEvent, type CSSProperties, type TransitionEventHandler } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { ProcessInfo } from "../api/types";
import type { WinRect } from "../store/ui";
import { useUi, spacesBarBottom } from "../store/ui";
import { useDraggableWindow } from "../hooks/useDraggableWindow";
import { ResizeHandles } from "./ResizeHandles";
import { CpuRamReadout } from "./SystemStatsBar";
import { PortsView } from "./PortsView";

type SortKey = "pid" | "name" | "cpu" | "mem" | "rss";
type Tab = "processes" | "ports";

const RECT_KEY = "tr.monitorRect"; // remembered window geometry (per-browser)
const MIN_W = 560, MIN_H = 320;    // enough for the process table columns to stay readable
const DURATION = 300;              // ms — grow-from-icon / minimize-to-icon animation

/** A wide monitor box (~900px), centered and clamped below the spaces bar. */
function defaultRect(): WinRect {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(900, Math.round(vw * 0.92));
  const h = Math.round(vh * 0.8);
  const top = spacesBarBottom() + 8;
  return {
    w, h,
    x: Math.max(8, Math.round((vw - w) / 2)),
    y: Math.max(top, Math.round((vh - h) / 2)),
  };
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

export function SystemMonitor({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["processes"],
    queryFn: api.listProcesses,
    refetchInterval: 2000,
  });
  const [tab, setTab] = useState<Tab>("processes");
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("cpu");
  const [asc, setAsc] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; proc: ProcessInfo } | null>(null);
  const [killErr, setKillErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Free-floating, draggable, resizable window — drag the title bar, grab the edges to resize.
  const [seed] = useState(loadRect);
  const { rect, beginDrag, beginResize } = useDraggableWindow(seed, MIN_W, MIN_H, undefined, undefined, "monitor");

  // Grow-from-icon on open, minimize-to-icon on close — same trick as the room↔card / Notes window.
  // The opener icon's rect rides in on the store; capture it once so a later store change can't move
  // the target mid-animation. Mount collapsed onto the icon, flip to full size next frame, and only
  // unmount (onClose) once the collapse transition ends.
  const [origin] = useState<WinRect | null>(() => useUi.getState().monitorOrigin);
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

  // A second press of the TopBar Monitor icon bumps monitorCloseSeq (the monitor lives in App, not
  // TopBar, so it's signalled through the store). Run the same minimize-to-icon close on each bump
  // after mount — the ref seeds with the mount value so the initial render never self-closes.
  const closeSeq = useUi(s => s.monitorCloseSeq);
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

  // Dismiss the right-click menu on any outside click or scroll. The modal panel stops
  // click propagation, so the backdrop handler can't see clicks landing inside the modal
  // — a document-level listener is the only reliable way to catch them.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: globalThis.MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null); };
    const onScroll = () => setMenu(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("scroll", onScroll, true);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("scroll", onScroll, true); };
  }, [menu]);

  const kill = useMutation({
    mutationFn: ({ pid, signal }: { pid: number; signal: "TERM" | "KILL" }) => api.killProcess(pid, signal),
    onSuccess: () => { setKillErr(null); qc.invalidateQueries({ queryKey: ["processes"] }); },
    onError: (e: Error) => setKillErr(e.message),
  });

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = (data?.processes ?? []).filter(p =>
      !q || p.name.toLowerCase().includes(q) || p.command.toLowerCase().includes(q) || String(p.pid) === q);
    const dir = asc ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [data, filter, sortKey, asc]);

  // New numeric column → start descending (biggest first); name column → ascending.
  const setSort = (k: SortKey) => { if (k === sortKey) setAsc(a => !a); else { setSortKey(k); setAsc(k === "name"); } };

  // stopPropagation is load-bearing: without it the event bubbles to the backdrop's
  // onContextMenu/onClick and clears the menu the same instant it opens.
  const openMenu = (e: MouseEvent, proc: ProcessInfo) => { e.preventDefault(); e.stopPropagation(); setSelected(proc.pid); setMenu({ x: e.clientX, y: e.clientY, proc }); };
  const doKill = (signal: "TERM" | "KILL") => {
    if (!menu) return;
    const p = menu.proc; setMenu(null);
    const verb = signal === "KILL" ? "Force kill" : "Kill";
    if (confirm(`${verb} ${p.name} (pid ${p.pid})?`)) kill.mutate({ pid: p.pid, signal });
  };

  // Collapse target: scale down + slide the window's top-left onto the icon's top-left. Falls back
  // to a centered shrink when the opener rect is unknown.
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
    // A free-floating, draggable, resizable window (NOT a modal — it never dims the canvas) that
    // stays above the room windows. Right-clicking the chrome just clears the kill menu.
    <div onTransitionEnd={onTransitionEnd} style={style}
      className="fixed z-50 flex flex-col rounded-lg overflow-hidden border border-edge-strong bg-canvas shadow-2xl"
      onContextMenu={e => { e.preventDefault(); setMenu(null); }}>
        {/* Title bar = drag handle. The tabs/filter/Close are buttons or stop pointer-down, so they
            never start a drag. The centered CPU/RAM readout is pointer-events-none so you can still
            grab the bar through it. */}
        <div onPointerDown={beginDrag}
          className="relative h-12 shrink-0 flex items-center justify-between px-4 border-b border-edge cursor-move select-none">
          <div className="flex items-center gap-3">
            <div className="font-semibold">System Monitor</div>
            <div className="flex items-center gap-1 bg-panel border border-edge rounded p-0.5 text-xs">
              <TabButton label="Processes" active={tab === "processes"} onClick={() => setTab("processes")} />
              <TabButton label="Ports" active={tab === "ports"} onClick={() => setTab("ports")} />
            </div>
          </div>
          <CpuRamReadout className="absolute left-1/2 -translate-x-1/2 pointer-events-none text-xs" />
          <div className="flex items-center gap-2" onPointerDown={e => e.stopPropagation()}>
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="filter…" spellCheck={false}
              className="px-2 py-1 bg-panel border border-edge rounded text-sm w-48" />
            <button onClick={handleClose} className="px-3 py-1 bg-elevated rounded text-sm">Close</button>
          </div>
        </div>

        {tab === "ports" ? <PortsView filter={filter} /> : (
        <><div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-sm table-fixed">
            <thead className="sticky top-0 bg-panel text-muted select-none">
              <tr>
                <Th label="PID" k="pid" sortKey={sortKey} asc={asc} setSort={setSort} className="w-20 text-right" />
                <Th label="Name" k="name" sortKey={sortKey} asc={asc} setSort={setSort} className="text-left" />
                <Th label="%CPU" k="cpu" sortKey={sortKey} asc={asc} setSort={setSort} className="w-20 text-right" />
                <Th label="%MEM" k="mem" sortKey={sortKey} asc={asc} setSort={setSort} className="w-20 text-right" />
                <Th label="Mem" k="rss" sortKey={sortKey} asc={asc} setSort={setSort} className="w-24 text-right" />
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => (
                // Zebra striping: even rows keep the window bg, odd rows get a faint fg wash so the
                // eye can track across columns. fg (not white) → lightens on dark themes, darkens on
                // light ones. Selected/hover are opaque tokens that override the stripe.
                <tr key={p.pid} onClick={() => setSelected(p.pid)} onContextMenu={e => openMenu(e, p)}
                  className={`border-t border-surface cursor-default ${p.pid === selected ? "bg-accent/20" : `${i % 2 ? "bg-fg/[0.04]" : ""} hover:bg-surface`}`}>
                  <td className="px-3 py-1 text-right tabular-nums text-muted">{p.pid}</td>
                  <td className="px-3 py-1 truncate" title={p.command}>{p.name}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{p.cpu.toFixed(1)}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{p.mem.toFixed(1)}</td>
                  <td className="px-3 py-1 text-right tabular-nums text-muted">{fmtMem(p.rss)}</td>
                  <td className="px-2 py-1 text-center">
                    <button onClick={e => openMenu(e, p)} title="Kill process…"
                      className="text-dim hover:text-red-400 px-1 leading-none">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {isLoading && <div className="p-4 text-dim text-sm">loading…</div>}
          {error && <div className="p-4 text-red-400 text-sm">{(error as Error).message}</div>}
          {data && rows.length === 0 && <div className="p-4 text-dim text-sm">no matching processes</div>}
        </div>

        <div className="h-8 shrink-0 flex items-center justify-between px-4 border-t border-edge text-xs">
          <span className="text-dim">{data ? `${data.processes.length} processes · click ✕ or right-click a row to kill · refreshes every 2s` : ""}</span>
          {killErr && <span className="text-red-400">kill failed: {killErr}</span>}
        </div></>)}

      {/* Portal to <body>: the window's open/close transform makes it the containing block for
          position:fixed, which would otherwise shove this menu off-screen (see TerminalContextMenu). */}
      {menu && createPortal(
        <div ref={menuRef} className="fixed z-[60] w-40 bg-panel border border-edge rounded shadow-lg py-1 text-sm"
          style={{ left: menu.x, top: menu.y }} onClick={e => e.stopPropagation()} onContextMenu={e => e.preventDefault()}>
          <div className="px-3 py-1 text-xs text-dim truncate">{menu.proc.name} · {menu.proc.pid}</div>
          <button onClick={() => doKill("TERM")} className="w-full text-left px-3 py-1.5 hover:bg-elevated">Kill</button>
          <button onClick={() => doKill("KILL")} className="w-full text-left px-3 py-1.5 text-red-300 hover:bg-elevated">Force kill</button>
        </div>,
        document.body,
      )}

      <ResizeHandles onStart={beginResize} />
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`px-2.5 py-1 rounded ${active ? "bg-elevated text-bright" : "text-muted hover:text-fg"}`}>
      {label}
    </button>
  );
}

function Th({ label, k, sortKey, asc, setSort, className }:
  { label: string; k: SortKey; sortKey: SortKey; asc: boolean; setSort: (k: SortKey) => void; className?: string }) {
  return (
    <th onClick={() => setSort(k)} className={`px-3 py-1.5 font-medium cursor-pointer hover:text-fg ${className ?? ""}`}>
      {label}{sortKey === k ? (asc ? " ▲" : " ▼") : ""}
    </th>
  );
}

function fmtMem(kb: number): string {
  if (kb >= 1024 * 1024) return (kb / 1024 / 1024).toFixed(1) + " GB";
  if (kb >= 1024) return (kb / 1024).toFixed(0) + " MB";
  return kb + " KB";
}
