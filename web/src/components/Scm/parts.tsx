import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { GitRef } from "../../api/types";

// path helpers
export const base = (p: string) => p.split("/").pop() || p;
export const dir = (p: string) => { const i = p.lastIndexOf("/"); return i > 0 ? p.slice(0, i) : ""; };

/** Compact "12m" / "3d" style age from a unix-seconds timestamp. */
export function relTime(sec: number): string {
  if (!sec) return "";
  const d = Math.floor(Date.now() / 1000) - sec;
  if (d < 60) return `${d}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  if (d < 2592000) return `${Math.floor(d / 86400)}d`;
  if (d < 31536000) return `${Math.floor(d / 2592000)}mo`;
  return `${Math.floor(d / 31536000)}y`;
}

/** Map a git status char (porcelain v2 index/worktree code) to a coloured badge. */
export function badge(ch: string): { t: string; c: string; label: string } {
  switch (ch) {
    case "M": return { t: "M", c: "text-amber-400", label: "Modified" };
    case "A": return { t: "A", c: "text-green-400", label: "Added" };
    case "D": return { t: "D", c: "text-red-400", label: "Deleted" };
    case "R": return { t: "R", c: "text-blue-400", label: "Renamed" };
    case "C": return { t: "C", c: "text-blue-400", label: "Copied" };
    case "?": return { t: "U", c: "text-green-400", label: "Untracked" };
    case "U": return { t: "!", c: "text-red-400", label: "Conflict" };
    default: return { t: ch || "•", c: "text-muted", label: ch };
  }
}

export function Counts({ ahead, behind }: { ahead: number; behind: number }) {
  if (!ahead && !behind) return null;
  return (
    <span className="text-[11px] text-dim tabular-nums flex items-center gap-1">
      {behind > 0 && <span title={`${behind} behind`}>↓{behind}</span>}
      {ahead > 0 && <span title={`${ahead} ahead`}>↑{ahead}</span>}
    </span>
  );
}

export function Popover({ open, onClose, className, children }:
  { open: boolean; onClose: () => void; className: string; children: ReactNode }) {
  const measureRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  // Measure the menu at its natural (`className`-anchored) spot via an invisible in-flow copy, then
  // render the real menu in a body portal at those FIXED viewport coords. The portal escapes any
  // `overflow:hidden`/`transform` ancestor (e.g. the room window) that would otherwise clip a menu
  // opening near the panel's bottom edge, and the coords are clamped/flipped to stay fully on screen.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const el = measureRef.current;
      const r = el?.getBoundingClientRect();
      if (!el || !r) return;
      const m = 8; // viewport margin
      // The invisible copy is `absolute`, so its offsetParent IS the anchor wrapper — use it to mirror
      // the menu above the trigger (a real flip) instead of merely sliding it up over the trigger.
      const anchor = (el.offsetParent as HTMLElement | null)?.getBoundingClientRect() ?? null;
      const gap = anchor ? Math.max(0, r.top - anchor.bottom) : 0;
      const below = window.innerHeight - m - r.top;             // room at the natural spot
      const above = anchor ? anchor.top - gap - m : 0;          // room if flipped above the trigger
      let top: number, maxHeight: number;
      if (r.height <= below) { top = r.top; maxHeight = below; }
      else if (anchor && above > below) { top = Math.max(m, anchor.top - gap - r.height); maxHeight = above; }
      else { top = Math.max(m, window.innerHeight - m - r.height); maxHeight = window.innerHeight - m * 2; }
      const left = Math.max(m, Math.min(r.left, window.innerWidth - r.width - m));
      setPos({ top, left, width: r.width, maxHeight });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);
  if (!open) return null;
  return (
    <>
      {/* invisible in-flow copy: lets the existing `className` anchors resolve the natural position */}
      <div ref={measureRef} aria-hidden
        className={`absolute z-50 invisible pointer-events-none bg-panel border border-edge rounded shadow-lg py-1 text-sm ${className}`}>{children}</div>
      {pos && createPortal(
        <>
          <div className="fixed inset-0 z-[70]" onClick={onClose} />
          <div style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight, overflowY: "auto", zIndex: 71 }}
            className="bg-panel border border-edge rounded shadow-lg py-1 text-sm">{children}</div>
        </>,
        document.body)}
    </>
  );
}

export function MenuItem({ onClick, disabled, children }:
  { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`w-full text-left px-3 py-1.5 truncate ${disabled ? "text-dim cursor-not-allowed" : "hover:bg-elevated"}`}>
      {children}
    </button>
  );
}

export function MenuSep() { return <div className="my-1 border-t border-edge" />; }

export function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return <button title={title} onClick={onClick} className="w-6 h-6 rounded hover:bg-elevated text-muted hover:text-bright leading-none">{children}</button>;
}

/** A git ref decoration (branch / remote / tag) as a small pill, coloured by kind. */
export function RefBadge({ refItem }: { refItem: GitRef }) {
  const { name, kind, current } = refItem;
  const cls = kind === "tag" ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
    : current ? "bg-blue-500/20 text-blue-200 border-blue-500/40"
    : kind === "remote" ? "bg-surface text-dim border-edge"
    : "bg-elevated text-fg border-edge-strong";
  return <span className={`shrink-0 px-1 rounded text-[10px] border ${cls}`}>{name}</span>;
}

/** Absolute date for the commit hover card, e.g. "7 Jun 2026". */
export function fmtDate(sec: number): string {
  if (!sec) return "";
  const d = new Date(sec * 1000);
  return `${d.getDate()} ${d.toLocaleString("en-US", { month: "short" })} ${d.getFullYear()}`;
}

export function Centered({ children }: { children: ReactNode }) {
  return <div className="flex-1 flex items-center justify-center text-xs text-dim p-4">{children}</div>;
}

/** Empty-state / missing-tool card with a Refresh action (git + gh gates reuse it). */
export function Notice({ title, hint, onRefresh }: { title: string; hint: string; onRefresh: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 p-5 text-center">
      <div className="text-fg text-sm font-medium">{title}</div>
      <div className="text-dim text-xs leading-relaxed">{hint}</div>
      <button onClick={onRefresh} className="mt-1 px-3 py-1.5 bg-elevated hover:bg-edge rounded text-xs text-fg">↻ Refresh</button>
    </div>
  );
}

/** Small inline spinner for in-flight buttons (git ops, etc.). */
export function Spinner() {
  return (
    <svg className="animate-spin shrink-0" width="12" height="12" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" className="shrink-0">
      <path d="M2 4.2a1 1 0 0 1 1-1h3l1.3 1.6H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4h10M6.5 4V2.8a.8.8 0 0 1 .8-.8h1.4a.8.8 0 0 1 .8.8V4M4.5 4l.6 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8" />
    </svg>
  );
}
