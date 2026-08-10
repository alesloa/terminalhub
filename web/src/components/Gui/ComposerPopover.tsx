import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const GAP = 6;          // breathing room between a pill and the menu growing out of it
const EDGE = 8;         // closest a menu ever gets to a viewport edge
const MIN_MENU_H = 140; // below this a menu is too cramped to be worth opening on that side

/** One composer pill — the closed state of a popover. `tone` repaints it when the choice behind it
 *  is worth noticing without opening anything (full access bypasses every prompt). */
export const Pill = forwardRef<HTMLButtonElement, {
  label: string;
  title: string;
  open: boolean;
  tone?: "warn";
  icon?: ReactNode;
  onClick: () => void;
}>(function Pill({ label, title, open, tone, icon, onClick }, ref) {
  const tint = tone === "warn"
    ? "border-warn/40 bg-warn/10 text-warn hover:bg-warn/20"
    : `border-edge text-muted hover:bg-elevated hover:text-bright ${open ? "bg-elevated text-bright" : "bg-surface"}`;
  return (
    <button
      ref={ref}
      type="button"
      title={title}
      aria-expanded={open}
      onClick={onClick}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] leading-5 transition-colors ${tint}`}
    >
      {icon}
      <span className="min-w-0 truncate">{label}</span>
      <Chevron open={open} />
    </button>
  );
});

/**
 * The menu a pill opens. It grows UPWARD: the composer lives at the bottom of the pane, so a
 * downward menu would open straight off-screen. Anchoring its bottom edge to the pill's top also
 * keeps the list's growth away from the pointer instead of shoving rows under it.
 *
 * Portalled to <body> for the same reason TerminalContextMenu is — an ancestor transform (the room's
 * open/close animation) would otherwise become the containing block for `position: fixed`.
 */
export function PillPopover({ anchor, width, onClose, children }: {
  anchor: React.RefObject<HTMLElement>;
  width: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Measure before paint so the menu never shows a frame at the wrong place, and re-measure on
  // resize — the terminal dock is resizable, and a stale rect would leave the menu floating.
  useLayoutEffect(() => {
    const measure = () => setRect(anchor.current?.getBoundingClientRect() ?? null);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      // The pill itself toggles; letting the outside-click close it too would immediately re-open it.
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    // Deferred a frame so the click that opened the menu can't be the click that closes it.
    const raf = requestAnimationFrame(() => window.addEventListener("mousedown", onDown));
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);

  if (!rect) return null;
  const w = Math.min(width, window.innerWidth - EDGE * 2);
  const left = Math.max(EDGE, Math.min(rect.left, window.innerWidth - w - EDGE));
  // Upward by default, but a composer floated to the middle of a short dock (the empty-state hero)
  // can have more room below than above — take whichever side actually fits.
  const above = rect.top - GAP - EDGE;
  const below = window.innerHeight - rect.bottom - GAP - EDGE;
  const up = above >= MIN_MENU_H || above >= below;
  const place = up
    ? { bottom: window.innerHeight - rect.top + GAP, maxHeight: Math.max(MIN_MENU_H, above) }
    : { top: rect.bottom + GAP, maxHeight: Math.max(MIN_MENU_H, below) };

  return createPortal(
    <div
      ref={ref}
      style={{ position: "fixed", left, width: w, zIndex: 70, ...place }}
      className="flex flex-col overflow-hidden rounded-xl border border-edge bg-panel text-sm text-fg shadow-2xl"
    >
      {children}
    </div>,
    document.body,
  );
}

/** A labelled group of rows. Groups scroll as one list, so the label rides along with its rows. */
export function PopoverSection({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="py-1">
      {label && (
        <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-dim">{label}</div>
      )}
      {children}
    </div>
  );
}

export function PopoverDivider() {
  return <div className="h-px bg-edge" />;
}

/** Scroll container for the rows. Kept separate from PillPopover so a fixed header (the model
 *  search field) can sit above it without scrolling away. */
export function PopoverBody({ children }: { children: ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>;
}

/**
 * One selectable row. `chip` marks a row as the standing default; `badge` carries its keyboard
 * chord. Everything is a <span> because the row is a <button> — a <div> inside one is invalid.
 */
export function PopoverRow({ title, description, badge, chip, selected, icon, onClick }: {
  title: string;
  description?: string;
  badge?: string;
  chip?: string;
  selected?: boolean;
  icon?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors hover:bg-elevated ${selected ? "bg-elevated" : ""}`}
    >
      {icon && <span className="mt-0.5 shrink-0 text-muted">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={`truncate text-[13px] ${selected ? "text-bright" : "text-fg"}`}>{title}</span>
          {chip && (
            <span className="shrink-0 rounded border border-edge px-1 text-[9px] uppercase tracking-wide text-dim">{chip}</span>
          )}
        </span>
        {description && <span className="mt-0.5 block text-[11px] leading-snug text-dim">{description}</span>}
      </span>
      <span className="mt-0.5 flex shrink-0 items-center gap-1.5">
        {badge && <span className="font-mono text-[10px] text-dim">{badge}</span>}
        {selected && <CheckIcon />}
      </span>
    </button>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
      className={`shrink-0 opacity-70 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="M6 15l6-6 6 6" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

/** Padlock. Open-shackle for the one mode that asks for nothing. */
export function LockIcon({ unlocked }: { unlocked?: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      {unlocked ? <path d="M8 11V7a4 4 0 0 1 7.5-2" /> : <path d="M8 11V7a4 4 0 0 1 8 0v4" />}
    </svg>
  );
}

/** Fast mode is on. */
export function BoltIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 text-warn">
      <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" />
    </svg>
  );
}
