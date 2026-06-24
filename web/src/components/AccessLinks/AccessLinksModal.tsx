import {
  forwardRef, useEffect, useImperativeHandle, useMemo, useState,
  type CSSProperties, type TransitionEventHandler,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { AccessKey } from "../../api/types";
import type { WinRect } from "../../store/ui";
import { spacesBarBottom } from "../../store/ui";
import { useDraggableWindow, type WindowHandle } from "../../hooks/useDraggableWindow";
import { ResizeHandles } from "../ResizeHandles";
import { useAccessKeys } from "./useAccessKeys";
import { useTunnel } from "./useTunnel";
import { loadShareBase, saveShareBase, isLocalOrigin, buildAccessLink } from "./shareLink";

const RECT_KEY = "tr.accessLinksRect";
const MIN_W = 460, MIN_H = 420;
const DURATION = 300;

const EXPIRY_OPTIONS: { label: string; ms: number | null }[] = [
  { label: "1 hour", ms: 3_600_000 },
  { label: "24 hours", ms: 86_400_000 },
  { label: "7 days", ms: 604_800_000 },
  { label: "30 days", ms: 2_592_000_000 },
  { label: "Never expires", ms: null },
];

function relFuture(ms: number): string {
  if (ms <= 0) return "expired";
  const m = Math.round(ms / 60000);
  if (m < 60) return `in ${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `in ${h}h`;
  return `in ${Math.round(h / 24)}d`;
}
function relPast(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Robust copy: the async Clipboard API needs a secure context (https / localhost) — on a plain-http
// LAN address it's missing, so fall back to a hidden textarea + execCommand.
async function copyText(text: string): Promise<boolean> {
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; } } catch { /* fall through */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

function defaultRect(): WinRect {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(640, Math.round(vw * 0.6));
  const h = Math.min(640, Math.round(vh * 0.78));
  const top = spacesBarBottom() + 8;
  return { w, h, x: Math.max(8, Math.round((vw - w) / 2)), y: Math.max(top, Math.round((vh - h) / 2)) };
}
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
  } catch { /* ignore */ }
  return defaultRect();
}

/**
 * "Add a teammate" manager: mint revocable, expiring access links, copy the shareable URL, and watch
 * + control who's connected (Accept happens in the center-screen prompt; here you revoke links and
 * kick sessions). A free-floating draggable/resizable window that grows out of the launcher tile and
 * minimizes back into it — same convention as NotesModal.
 */
export const AccessLinksModal = forwardRef<WindowHandle, { origin?: WinRect | null; onClose: () => void }>(
  function AccessLinksModal({ origin, onClose }, ref) {
    const { keys, sessions, isLoading, create, revoke, kick } = useAccessKeys();
    const { data: wsData } = useQuery({ queryKey: ["workspaces"], queryFn: api.listWorkspaces });
    const wsName = useMemo(() => {
      const m = new Map<string, string>();
      for (const w of wsData?.workspaces ?? []) m.set(w.id, w.name);
      return m;
    }, [wsData]);

    const [seed] = useState(loadRect);
    const { rect, beginDrag, beginResize } = useDraggableWindow(seed, MIN_W, MIN_H);

    // Grow-from-icon on open, minimize-to-icon on close (same trick as NotesModal).
    const reduce = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const [expanded, setExpanded] = useState(reduce);
    useEffect(() => {
      if (reduce) return;
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setExpanded(true)));
      return () => cancelAnimationFrame(id);
    }, [reduce]);
    const handleClose = () => { if (reduce) { onClose(); return; } setExpanded(false); };
    useImperativeHandle(ref, () => ({ close: handleClose }));
    const onTransitionEnd: TransitionEventHandler = (e) => {
      if (e.target === e.currentTarget && e.propertyName === "transform" && !expanded) onClose();
    };
    useEffect(() => {
      const t = window.setTimeout(() => { try { localStorage.setItem(RECT_KEY, JSON.stringify(rect)); } catch { /* blocked */ } }, 300);
      return () => window.clearTimeout(t);
    }, [rect]);

    // Form + share-base state.
    const [label, setLabel] = useState("");
    const [room, setRoom] = useState("");                  // "" = no room
    const [expiryIdx, setExpiryIdx] = useState(1);          // default "24 hours"
    // Presentation defaults: a new link mirrors your view AND locks the viewer (pure show-and-tell).
    const [mirror, setMirror] = useState(true);
    const [lock, setLock] = useState(true);
    const [shareBase, setShareBase] = useState(loadShareBase);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const localBase = isLocalOrigin(shareBase);

    // One-click public Cloudflare tunnel. The port the browser is served from (5173 dev / 8189 prod) is
    // what the tunnel must target, since that layer serves the SPA + proxies /api + /ws.
    const { status: tunnel, start: startTunnel, stop: stopTunnel } = useTunnel();
    const localPort = Number(location.port) || (location.protocol === "https:" ? 443 : 80);
    // While a tunnel is live, every link points at its public URL; when it stops, fall back to the saved
    // base. The trycloudflare URL is throwaway (new each run), so it's never persisted via saveShareBase.
    const tunnelUrl = tunnel.status === "running" ? tunnel.url : null;
    useEffect(() => { setShareBase(tunnelUrl ?? loadShareBase()); }, [tunnelUrl]);

    const generate = () => {
      if (create.isPending) return;
      const ms = EXPIRY_OPTIONS[expiryIdx].ms;
      create.mutate(
        { label: label.trim(), workspaceId: room || null, expiresAt: ms == null ? null : Date.now() + ms, mirror, lock },
        // Clear the name ONLY once the link is actually saved. A failed create (validation, a network blip
        // mid dev-restart) used to clear the field anyway and surface nothing — so a link silently vanished
        // and looked created. Keep the name on failure and show the error so it can be retried.
        { onSuccess: () => setLabel("") },
      );
    };
    const copy = async (k: AccessKey) => {
      const ok = await copyText(buildAccessLink(shareBase, k.secret, k.workspaceId));
      if (ok) { setCopiedId(k.id); window.setTimeout(() => setCopiedId((c) => (c === k.id ? null : c)), 1500); }
    };
    const onShareBaseChange = (v: string) => { setShareBase(v); saveShareBase(v); };

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
        <div onPointerDown={beginDrag}
          className="h-8 shrink-0 flex items-center justify-between px-4 border-b border-edge cursor-move select-none">
          <div className="font-semibold">Access links</div>
          <div onPointerDown={(e) => e.stopPropagation()}>
            <button onClick={handleClose} title="Close" className="px-3 h-6 inline-flex items-center bg-elevated rounded text-sm">Close</button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto p-4 space-y-5 text-sm">
          {/* Create a link */}
          <section className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-dim">Create a link</div>
            <input value={label} onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); generate(); } }}
              placeholder="Who's this for? (e.g. Bob — review)"
              className="w-full rounded border border-edge bg-canvas px-3 py-2 outline-none focus:border-blue-500" />
            <div className="flex gap-2">
              <select value={room} onChange={(e) => setRoom(e.target.value)}
                className="flex-1 min-w-0 rounded border border-edge bg-canvas px-2 py-2 outline-none focus:border-blue-500">
                <option value="">Land on the canvas (no room)</option>
                {(wsData?.workspaces ?? []).map((w) => <option key={w.id} value={w.id}>Open “{w.name}”</option>)}
              </select>
              <select value={expiryIdx} onChange={(e) => setExpiryIdx(Number(e.target.value))}
                className="w-36 rounded border border-edge bg-canvas px-2 py-2 outline-none focus:border-blue-500">
                {EXPIRY_OPTIONS.map((o, i) => <option key={o.label} value={i}>{o.label}</option>)}
              </select>
            </div>
            {/* Presentation controls — what the viewer sees and whether they can touch anything. */}
            <div className="space-y-1.5">
              <label className="flex items-start gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} className="mt-0.5 accent-blue-600" />
                <span className="flex-1">
                  <span className="font-medium">Mirror my view</span>
                  <span className="block text-[11px] text-dim">They follow the space, rooms, fullscreen, and panels you open.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} className="mt-0.5 accent-blue-600" />
                <span className="flex-1">
                  <span className="font-medium">Lock their input (view-only)</span>
                  <span className="block text-[11px] text-dim">A passive spectator — they can't click, drag, or type into your terminals.</span>
                </span>
              </label>
            </div>
            <button onClick={generate} disabled={create.isPending}
              className="w-full py-2 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50">
              {create.isPending ? "Generating…" : "Generate link"}
            </button>
            {create.isError && (
              <div className="text-[11px] text-red-400">
                Couldn't create the link: {(create.error as Error)?.message || "unknown error"}. Your name's kept — try again.
              </div>
            )}
          </section>

          {/* Existing links */}
          <section className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-dim">Your links</div>
            {localBase && keys.length > 0 && (
              <div className="text-[11px] text-amber-400">These links use a local address — make a public link below so a friend off your network can open them.</div>
            )}
            {isLoading && <div className="text-dim">loading…</div>}
            {!isLoading && keys.length === 0 && <div className="text-dim">No links yet. Generate one above to share access.</div>}
            <div className="space-y-2">
              {keys.map((k) => (
                <div key={k.id} className="rounded border border-edge bg-elevated px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 min-w-0 truncate font-medium">{k.label || "Untitled link"}</span>
                    <button onClick={() => copy(k)}
                      className="shrink-0 px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs">
                      {copiedId === k.id ? "Copied!" : "Copy link"}
                    </button>
                    <button onClick={() => revoke.mutate(k.id)}
                      className="shrink-0 px-2 py-1 rounded bg-elevated border border-edge hover:border-red-500 hover:text-red-400 text-xs">
                      Revoke
                    </button>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-dim">
                    <span>{k.workspaceId ? `→ ${wsName.get(k.workspaceId) ?? "room"}` : "→ canvas"}</span>
                    <span>{k.expiresAt == null ? "never expires" : `expires ${relFuture(k.expiresAt - Date.now())}`}</span>
                    <span>{k.lastUsedAt ? `used ${relPast(k.lastUsedAt)}` : "never used"}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Who's connected */}
          <section className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-dim">Who's here</div>
            {sessions.length === 0 && <div className="text-dim">No one connected right now.</div>}
            <div className="space-y-2">
              {sessions.map((s) => (
                <div key={s.sessionId} className="flex items-center gap-2 rounded border border-edge bg-elevated px-3 py-2">
                  <span className={`shrink-0 w-2 h-2 rounded-full ${s.status === "admitted" ? "bg-green-500" : "bg-amber-400"}`} />
                  <span className="flex-1 min-w-0 truncate">{s.name}</span>
                  <span className="shrink-0 text-[11px] text-dim">{s.status === "admitted" ? "connected" : "waiting"}</span>
                  <button onClick={() => kick.mutate(s.sessionId)}
                    className="shrink-0 px-2 py-1 rounded bg-elevated border border-edge hover:border-red-500 hover:text-red-400 text-xs">
                    Kick
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Share URL base + one-click public tunnel */}
          <section className="space-y-1.5">
            <div className="text-xs font-semibold uppercase tracking-wider text-dim">Public share URL</div>
            <input value={shareBase} onChange={(e) => onShareBaseChange(e.target.value)} spellCheck={false}
              disabled={!!tunnelUrl}
              className={`w-full rounded border bg-canvas px-3 py-2 outline-none disabled:opacity-60 ${localBase ? "border-amber-500 focus:border-amber-400" : "border-edge focus:border-blue-500"}`} />
            {localBase
              ? <div className="text-[11px] text-amber-400">This is a local/LAN address — a teammate off your network can't reach it. Make a public link below, or paste your own tunnel URL.</div>
              : <div className="text-[11px] text-dim">Links are built from this address. It must be reachable by whoever you share with.</div>}

            <div className="pt-1">
              {tunnel.status === "running" ? (
                <div className="rounded border border-green-600/40 bg-green-600/10 px-3 py-2 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 w-2 h-2 rounded-full bg-green-500" />
                    <span className="text-xs font-medium text-green-300">Public link is live</span>
                    <button onClick={() => stopTunnel.mutate()} disabled={stopTunnel.isPending}
                      className="ml-auto shrink-0 px-2 py-1 rounded bg-elevated border border-edge hover:border-red-500 hover:text-red-400 text-xs disabled:opacity-50">
                      {stopTunnel.isPending ? "Stopping…" : "Stop"}
                    </button>
                  </div>
                  <div className="font-mono text-[11px] text-dim break-all">{tunnel.url}</div>
                  <div className="text-[11px] text-dim">Every link now uses this address. It stays up until you stop it or quit the server.</div>
                </div>
              ) : tunnel.status === "starting" ? (
                <button disabled className="w-full py-2 rounded bg-elevated border border-edge text-dim text-xs">
                  Starting tunnel… (can take a few seconds)
                </button>
              ) : (
                <div className="space-y-1.5">
                  <button onClick={() => startTunnel.mutate(localPort)} disabled={startTunnel.isPending}
                    className="w-full py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium disabled:opacity-50">
                    {startTunnel.isPending ? "Starting…" : "Make a public link"}
                  </button>
                  <div className="text-[11px] text-dim">Spins up a free Cloudflare tunnel — no account, reachable from anywhere. Needs the <span className="font-mono">cloudflared</span> tool installed once.</div>
                  {tunnel.status === "error" && <div className="text-[11px] text-red-400">{tunnel.message}</div>}
                </div>
              )}
            </div>
          </section>
        </div>

        <ResizeHandles onStart={beginResize} />
      </div>
    );
  },
);
