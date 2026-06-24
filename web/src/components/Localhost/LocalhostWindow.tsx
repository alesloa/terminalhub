import { useEffect, useMemo, useRef, useState, type CSSProperties, type TransitionEventHandler } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { PortInfo } from "../../api/types";
import type { WinRect } from "../../store/ui";
import { useUi, spacesBarBottom } from "../../store/ui";
import { useDraggableWindow } from "../../hooks/useDraggableWindow";
import { ResizeHandles } from "../ResizeHandles";
import { PreviewTab } from "./PreviewTab";
import { resolvePreviewUrl, absolutePreviewUrl, isLoopbackHost } from "../../lib/preview";

const RECT_KEY = "tr.localhostRect";
const MIN_W = 480, MIN_H = 360;
const DURATION = 300; // ms — grow-from-icon / minimize-to-icon
const MAX_TABS = 8;   // each tab holds a live iframe; cap so a runaway click-spree can't pile them up

interface Tab { id: string; port: number; path: string; reloadSeq: number }
let tabSeq = 0;
const newTab = (port: number, path: string): Tab => ({ id: `t${++tabSeq}`, port, path: path || "/", reloadSeq: 0 });

function defaultRect(): WinRect {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(1000, Math.round(vw * 0.9));
  const h = Math.round(vh * 0.82);
  const top = spacesBarBottom() + 8;
  return { w, h, x: Math.max(8, Math.round((vw - w) / 2)), y: Math.max(top, Math.round((vh - h) / 2)) };
}
function loadRect(): WinRect {
  try {
    const r = JSON.parse(localStorage.getItem(RECT_KEY) || "null") as Partial<WinRect> | null;
    if (r && typeof r.x === "number" && typeof r.y === "number" && typeof r.w === "number" && typeof r.h === "number") {
      const vw = window.innerWidth, vh = window.innerHeight;
      const w = Math.max(MIN_W, Math.min(r.w, vw - 16)), h = Math.max(MIN_H, Math.min(r.h, vh - 16));
      return { w, h, x: Math.max(8, Math.min(vw - 80, r.x)), y: Math.max(8, Math.min(vh - 60, r.y)) };
    }
  } catch { /* corrupt/blocked storage */ }
  return defaultRect();
}

/** Host-local listening ports worth previewing: loopback/wildcard binds, minus terminalhub's own port. */
function previewablePorts(ports: PortInfo[] | undefined): { port: number; name: string }[] {
  const self = Number(window.location.port) || (window.location.protocol === "https:" ? 443 : 80);
  const seen = new Set<number>();
  const out: { port: number; name: string }[] = [];
  for (const p of ports ?? []) {
    const addr = p.address.replace(/^\[|\]$/g, "");
    const local = addr === "*" || addr === "0.0.0.0" || addr === "::" || addr === "127.0.0.1" || addr === "::1";
    if (!local || p.port === self || seen.has(p.port)) continue;
    seen.add(p.port);
    out.push({ port: p.port, name: p.name });
  }
  return out.sort((a, b) => a.port - b.port);
}

export function LocalhostWindow({ onClose }: { onClose: () => void }) {
  const remote = !isLoopbackHost();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState(""); // address bar text for the active tab / new-tab entry

  // The cookie that authorizes iframe sub-resources on a remote/exposed instance must be set BEFORE
  // any iframe loads, or the first request 401s. On loopback there's no proxy and nothing to set.
  const [sessionReady, setSessionReady] = useState(!remote);
  useEffect(() => {
    if (!remote) return;
    let ok = true;
    api.previewSession().then(() => { if (ok) setSessionReady(true); }).catch(() => { if (ok) setSessionReady(true); });
    return () => { ok = false; };
  }, [remote]);

  const { data } = useQuery({ queryKey: ["ports"], queryFn: api.listPorts, refetchInterval: 4000 });
  const detected = useMemo(() => previewablePorts(data?.ports), [data]);

  const addTab = (port: number, path = "/") => setTabs((cur) => {
    const existing = cur.find((t) => t.port === port && t.path === (path || "/"));
    if (existing) { setActiveId(existing.id); return cur; }
    const t = newTab(port, path);
    setActiveId(t.id);
    return cur.length >= MAX_TABS ? [...cur.slice(1), t] : [...cur, t];
  });
  const closeTab = (id: string) => setTabs((cur) => {
    const idx = cur.findIndex((t) => t.id === id);
    const next = cur.filter((t) => t.id !== id);
    setActiveId((a) => (a !== id ? a : (next[idx] ?? next[idx - 1] ?? next[0])?.id ?? null));
    return next;
  });
  const active = tabs.find((t) => t.id === activeId) ?? null;

  // Drain a terminal-link-queued tab (open/focus came through the store).
  const pending = useUi((s) => s.localhostPending);
  const clearPending = useUi((s) => s.clearLocalhostPending);
  const seenPendingSeq = useRef(0);
  useEffect(() => {
    if (!pending || pending.seq === seenPendingSeq.current) return;
    seenPendingSeq.current = pending.seq;
    addTab(pending.port, pending.path);
    clearPending();
  }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reflect the active tab's address into the bar (unless the field is focused/being edited).
  const draftFocused = useRef(false);
  useEffect(() => {
    if (!draftFocused.current) setDraft(active ? `${active.port}${active.path === "/" ? "" : active.path}` : "");
  }, [active]);

  // ── grow-from-icon / minimize-to-icon (same pattern as SystemMonitor) ─────────────────────────
  const [seed] = useState(loadRect);
  const { rect, beginDrag, beginResize } = useDraggableWindow(seed, MIN_W, MIN_H, undefined, undefined, "localhost");
  const [origin] = useState<WinRect | null>(() => useUi.getState().localhostOrigin);
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
  const closeSeq = useUi((s) => s.localhostCloseSeq);
  const seenCloseSeq = useRef(closeSeq);
  useEffect(() => {
    if (closeSeq === seenCloseSeq.current) return;
    seenCloseSeq.current = closeSeq;
    handleClose();
  }, [closeSeq]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = window.setTimeout(() => { try { localStorage.setItem(RECT_KEY, JSON.stringify(rect)); } catch { /* blocked */ } }, 300);
    return () => window.clearTimeout(t);
  }, [rect]);

  const go = (text: string) => {
    const m = text.trim().match(/^(?:https?:\/\/)?(?:[^/:]+:)?(\d{2,5})(\/.*)?$/) || text.trim().match(/^(\d{2,5})(\/.*)?$/);
    if (!m) return;
    const port = Number(m[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return;
    addTab(port, m[2] || "/");
  };
  const reloadActive = () => active && setTabs((cur) => cur.map((t) => t.id === active.id ? { ...t, reloadSeq: t.reloadSeq + 1 } : t));
  const openActiveExternally = () => active && window.open(absolutePreviewUrl(active.port, active.path), "_blank", "noopener,noreferrer");

  // Back/forward drive the active tab's iframe history directly. The framed app is SAME-ORIGIN (it's
  // proxied under our origin), so we can reach its contentWindow.history; the in-app router pushes its
  // own entries, so this is real browser-style navigation. Wrapped in try/catch in case the frame is
  // mid-navigation. frames keeps the live <iframe> per tab id (PreviewTab registers it via frameRef).
  const frames = useRef<Record<string, HTMLIFrameElement | null>>({});
  const navFrame = (dir: "back" | "forward") => {
    try { frames.current[activeId ?? ""]?.contentWindow?.history[dir](); } catch { /* cross-state nav */ }
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
      transition: `transform ${DURATION}ms cubic-bezier(.22,.61,.36,1), opacity ${DURATION}ms ease`,
      willChange: "transform, opacity",
    }),
  };

  return (
    <div onTransitionEnd={onTransitionEnd} style={style}
      className="fixed z-50 flex flex-col rounded-lg overflow-hidden border border-edge-strong bg-canvas shadow-2xl">
      {/* Title bar = drag handle. Brand makes it unmistakably a LOCAL browser. */}
      <div onPointerDown={beginDrag}
        className="h-12 shrink-0 flex items-center justify-between gap-3 px-4 border-b border-edge cursor-move select-none">
        <div className="flex items-center gap-2 min-w-0">
          <GlobeHomeIcon />
          <div className="font-semibold">Localhost</div>
          <span className="text-xs text-dim truncate">· apps running on this host</span>
        </div>
        <div className="flex items-center gap-2" onPointerDown={(e) => e.stopPropagation()}>
          <button onClick={handleClose} className="px-3 py-1 bg-elevated rounded text-sm">Close</button>
        </div>
      </div>

      {/* Tab strip + the active tab's address bar. */}
      <div className="shrink-0 border-b border-edge bg-panel/60" onPointerDown={(e) => e.stopPropagation()}>
        <div className="flex items-stretch gap-1 px-2 pt-2 overflow-x-auto">
          {tabs.map((t) => (
            <div key={t.id} onClick={() => setActiveId(t.id)}
              className={`group flex items-center gap-2 max-w-[200px] px-3 py-1.5 rounded-t cursor-pointer text-sm
                ${t.id === activeId ? "bg-canvas text-bright" : "bg-elevated/60 text-muted hover:text-fg"}`}>
              <span className="truncate">localhost:{t.port}</span>
              <button onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}
                className="text-dim hover:text-red-400 leading-none">✕</button>
            </div>
          ))}
        </div>
        {active && (
          <div className="flex items-center gap-2 px-3 py-2">
            <button onClick={() => navFrame("back")} title="Back" className="px-2 py-1 bg-elevated rounded text-sm hover:bg-edge">←</button>
            <button onClick={() => navFrame("forward")} title="Forward" className="px-2 py-1 bg-elevated rounded text-sm hover:bg-edge">→</button>
            <button onClick={reloadActive} title="Reload" className="px-2 py-1 bg-elevated rounded text-sm hover:bg-edge">↻</button>
            <div className="flex-1 flex items-center bg-panel border border-edge rounded px-2">
              <span className="text-dim text-xs select-none">{remote ? "proxy → " : ""}localhost:</span>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onFocus={() => { draftFocused.current = true; }}
                onBlur={() => { draftFocused.current = false; }}
                onKeyDown={(e) => { if (e.key === "Enter") { go(draft); (e.target as HTMLInputElement).blur(); } }}
                spellCheck={false}
                placeholder="3000/path"
                className="flex-1 bg-transparent py-1 text-sm outline-none" />
            </div>
            <button onClick={openActiveExternally} title="Open in your real browser (for devtools)"
              className="px-2 py-1 bg-elevated rounded text-sm">↗</button>
          </div>
        )}
      </div>

      {/* Body: the active iframe, or the empty/port-picker state. */}
      <div className="relative flex-1 min-h-0">
        {!sessionReady ? (
          <div className="absolute inset-0 flex items-center justify-center text-dim text-sm">connecting…</div>
        ) : tabs.length === 0 ? (
          <EmptyState detected={detected} remote={remote} onPick={(p) => addTab(p, "/")} onGo={go} draft={draft} setDraft={setDraft} />
        ) : (
          tabs.map((t) => (
            <PreviewTab key={`${t.id}:${t.port}:${t.path}:${t.reloadSeq}`}
              url={resolvePreviewUrl(t.port, t.path)} title={`localhost:${t.port}`} active={t.id === activeId}
              frameRef={(el) => { frames.current[t.id] = el; }} />
          ))
        )}
      </div>

      <ResizeHandles onStart={beginResize} />
    </div>
  );
}

function EmptyState({ detected, remote, onPick, onGo, draft, setDraft }: {
  detected: { port: number; name: string }[];
  remote: boolean;
  onPick: (port: number) => void;
  onGo: (text: string) => void;
  draft: string;
  setDraft: (s: string) => void;
}) {
  return (
    <div className="absolute inset-0 overflow-auto flex flex-col items-center justify-center gap-5 p-8 text-center">
      <GlobeHomeIcon large />
      <div>
        <div className="text-lg font-semibold">Browse web apps running on this host</div>
        <div className="text-sm text-dim mt-1 max-w-md">
          A local browser for the dev servers you spin up on this machine — not the open web.
          {remote ? " Reached through Terminal Hub, so it works from anywhere." : ""}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center bg-panel border border-edge rounded px-2">
          <span className="text-dim text-xs select-none">localhost:</span>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus spellCheck={false} placeholder="3000"
            onKeyDown={(e) => { if (e.key === "Enter") onGo(draft); }}
            className="w-28 bg-transparent py-1.5 text-sm outline-none" />
        </div>
        <button onClick={() => onGo(draft)} className="px-3 py-1.5 bg-blue-600 rounded text-sm">Open</button>
      </div>
      <div className="w-full max-w-md">
        <div className="text-xs text-dim mb-2">{detected.length ? "Detected on this host:" : "No listening servers detected yet."}</div>
        <div className="flex flex-wrap gap-2 justify-center">
          {detected.map((d) => (
            <button key={d.port} onClick={() => onPick(d.port)}
              className="px-3 py-1.5 bg-elevated hover:bg-edge rounded text-sm">
              <span className="font-medium">:{d.port}</span>
              {d.name && <span className="text-dim ml-1.5">{d.name}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Globe inside a house outline — reads as "a browser, but local". */
function GlobeHomeIcon({ large }: { large?: boolean }) {
  const s = large ? 40 : 17;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18Z" />
    </svg>
  );
}
