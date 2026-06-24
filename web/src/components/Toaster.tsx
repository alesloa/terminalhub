import { useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useToasts, type Toast, type ToastLevel } from "../store/toasts";
import { useUi, type ToastPosition } from "../store/ui";
import { useGoToTerminal } from "../hooks/useGoToTerminal";

// Stack anchor for each of the 9 positions. `items-*` aligns the cards within the column; the
// translate utilities center the stack on whichever axis is "center".
const POS: Record<ToastPosition, string> = {
  "top-left": "top-5 left-5 items-start",
  "top-center": "top-5 left-1/2 -translate-x-1/2 items-center",
  "top-right": "top-5 right-5 items-end",
  "center-left": "top-1/2 left-5 -translate-y-1/2 items-start",
  "center": "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 items-center",
  "center-right": "top-1/2 right-5 -translate-y-1/2 items-end",
  "bottom-left": "bottom-5 left-5 items-start",
  "bottom-center": "bottom-5 left-1/2 -translate-x-1/2 items-center",
  "bottom-right": "bottom-5 right-5 items-end",
};
/** Which vertical band a position sits in — picks the enter/exit animation direction. */
function band(p: ToastPosition): "top" | "center" | "bottom" {
  return p.startsWith("top") ? "top" : p.startsWith("bottom") ? "bottom" : "center";
}
const ENTER = { top: "tr-toast-drop", center: "tr-toast-pop", bottom: "tr-toast-rise" } as const;
const EXIT = { top: "tr-toast-out-up", center: "tr-toast-out-fade", bottom: "tr-toast-out-down" } as const;

// Per-level visual identity: a left accent rail, a tinted icon badge, and a faint matching card
// border. Every color is a theme token (--tr-success/-error/-warn/-info via the Tailwind palette),
// so the toast tracks the active palette instead of hard-coded hex. The icon — not a letter — is
// what makes the severity readable at a glance: a check for success, a triangle-bang for a warning,
// an octagon-bang for an error, an i-in-a-circle for info. A toast with no level is an attention
// alert (an agent rang its bell) → amber bell, matching the workspace-card attention language.
type Variant = { border: string; rail: string; badge: string; Icon: () => ReactElement };
const VARIANT: Record<ToastLevel, Variant> = {
  success: { border: "border-success/30", rail: "bg-success", badge: "bg-success/15 text-success ring-success/25", Icon: CheckCircleIcon },
  warn:    { border: "border-warn/30",    rail: "bg-warn",    badge: "bg-warn/15 text-warn ring-warn/25",          Icon: TriangleAlertIcon },
  error:   { border: "border-error/30",   rail: "bg-error",   badge: "bg-error/15 text-error ring-error/25",        Icon: OctagonAlertIcon },
  info:    { border: "border-info/30",    rail: "bg-info",    badge: "bg-info/15 text-info ring-info/25",           Icon: InfoCircleIcon },
};
const ATTENTION: Variant = { border: "border-warn/30", rail: "bg-warn", badge: "bg-warn/15 text-warn ring-warn/25", Icon: BellIcon };

/** Stack of toasts — attention alerts and agent-sent messages. A small, glassy notification: a
 *  left accent rail + level icon (success/warn/error/info) that reads the severity at a glance, a
 *  header (which workspace/agent it's from), the message (truncated, with Show more), and an
 *  always-visible ✕ to dismiss WITHOUT navigating. Clicking the body instead jumps to the terminal
 *  that fired it — sliding to its virtual desktop and restoring it if it was minimized. Position
 *  (a 3×3 grid) is user-configurable in Settings → Voice & Speech. */
export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  const position = useUi((s) => s.toastPosition);
  const goTo = useGoToTerminal();
  // Cached app-wide (App polls it; react-query dedups) — lets a toast name its workspace.
  const { data: wsData } = useQuery({ queryKey: ["workspaces"], queryFn: api.listWorkspaces });
  if (toasts.length === 0) return null;

  const wsOf = (id?: string) => (id ? wsData?.workspaces.find((w) => w.id === id) : undefined);

  // Handling the toast = "you saw it" → cancel its pending center entry (it never persists), and the
  // server broadcasts the removal so every open browser drops this toast too. Letting it time out
  // instead lets the server persist it as history. No-op for plain UI toasts (no notifId).
  const handled = (notifId?: string) => { if (notifId) api.notifications.dismissPending(notifId).catch(() => {}); };

  const go = (t: Toast) => {
    goTo(t.workspaceId, t.terminalId);
    handled(t.notifId);
    dismiss(t.id);
  };

  const onDismiss = (t: Toast) => {
    handled(t.notifId);
    dismiss(t.id);
  };

  const b = band(position);
  // Newest toast sits nearest the edge it enters from: at the top for top-anchored stacks, at the
  // bottom otherwise. The store appends newest last, so reverse only for top anchors.
  const ordered = b === "top" ? [...toasts].reverse() : toasts;

  return (
    <div className={`pointer-events-none fixed z-[60] flex flex-col gap-2.5 ${POS[position]}`}>
      {ordered.map((t) => (
        <ToastItem
          key={t.id}
          t={t}
          anim={t.leaving ? EXIT[b] : ENTER[b]}
          from={t.title ?? wsOf(t.workspaceId)?.name}
          onGo={() => go(t)}
          onDismiss={() => onDismiss(t)}
        />
      ))}
    </div>
  );
}

function ToastItem({ t, anim, from, onGo, onDismiss }: {
  t: Toast; anim: string; from?: string; onGo: () => void; onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const long = t.text.length > 64; // ~two lines at this width — anything longer gets a Show more
  const label = from ?? "Terminal Hub";
  const v = t.level ? VARIANT[t.level] : ATTENTION;

  return (
    <div className={`group pointer-events-auto relative w-80 max-w-[calc(100vw-2.5rem)] overflow-hidden rounded-2xl border ${v.border} bg-panel/90 shadow-2xl shadow-black/30 ring-1 ring-white/5 backdrop-blur-xl transition-transform hover:-translate-y-0.5 ${anim}`}>
      {/* Left accent rail — the strongest at-a-glance severity signal, in the level's theme color. */}
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${v.rail}`} />
      <button onClick={onGo} className="flex w-full items-start gap-3 py-3 pl-4 pr-9 text-left hover:bg-surface/40">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1 ${v.badge}`}>
          <v.Icon />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-bright">{label}</span>
          <span className={`mt-0.5 block text-sm text-fg ${expanded ? "whitespace-pre-wrap break-words" : "truncate"}`}>{t.text}</span>
          {t.imageUrl && (
            <img src={t.imageUrl} alt="" className="mt-2 max-h-28 w-full rounded-lg object-cover"
              onError={(e) => { e.currentTarget.style.display = "none"; }} />
          )}
        </span>
      </button>
      {long && (
        <button type="button" onClick={() => setExpanded((v) => !v)}
          className="block w-full pb-2 pl-[4rem] pr-3 text-left text-[11px] text-link hover:underline">
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
      {/* Small neutral ✕ — dismiss without navigating. Always visible (not hover-gated) so it's
          findable, and neutral so it never competes with the level's accent color. */}
      <button type="button" onClick={onDismiss} aria-label="Dismiss"
        className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full text-sm leading-none text-muted transition hover:bg-surface hover:text-bright">
        ×
      </button>
    </div>
  );
}

// --- Level icons (inline SVG, lucide-style: 24-box, currentColor stroke, 1.8 weight, round caps).
// They inherit the badge's `text-<level>` color. A dot is drawn as a near-zero-length round-capped
// path (`M.. h.01`) — the standard single-pixel-dot trick.
const SVG = "h-[18px] w-[18px]";
function svgProps() {
  return { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", className: SVG, "aria-hidden": true } as const;
}
function CheckCircleIcon() {
  return (
    <svg {...svgProps()}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.4l2.4 2.4 4.6-5.2" />
    </svg>
  );
}
function TriangleAlertIcon() {
  return (
    <svg {...svgProps()}>
      <path d="M12 4.2 21 19H3z" />
      <path d="M12 10v4" />
      <path d="M12 16.6h.01" />
    </svg>
  );
}
function OctagonAlertIcon() {
  return (
    <svg {...svgProps()}>
      <path d="M8.2 3.2h7.6L20.8 8.2v7.6L15.8 20.8H8.2L3.2 15.8V8.2z" />
      <path d="M12 8v4.5" />
      <path d="M12 16h.01" />
    </svg>
  );
}
function InfoCircleIcon() {
  return (
    <svg {...svgProps()}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  );
}
function BellIcon() {
  return (
    <svg {...svgProps()}>
      <path d="M6 9a6 6 0 0 1 12 0c0 4.6 1.4 6 1.4 6H4.6S6 13.6 6 9z" />
      <path d="M10 19.5a2.3 2.3 0 0 0 4 0" />
    </svg>
  );
}
