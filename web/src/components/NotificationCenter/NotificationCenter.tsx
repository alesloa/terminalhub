import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { AppNotification, NotifyCategory } from "../../api/types";
import { useGoToTerminal } from "../../hooks/useGoToTerminal";
import { useNotifications } from "./useNotifications";

// Color by the notification-center bucket so the three kinds are tellable at a glance and the filter
// reads obviously: agent (the amber attention accent), error (red), info (blue).
const CHIP: Record<NotifyCategory, string> = { agent: "bg-amber-500", error: "bg-error", info: "bg-info" };

type Filter = "all" | NotifyCategory;
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "agent", label: "Agent" },
  { key: "error", label: "Error" },
  { key: "info", label: "Info" },
];

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

/** The top-bar notification bell: an unread badge + a dropdown panel of fired reminders (newest
 *  first) with mark-read / mark-all / clear and a Pushover monthly-usage readout. Self-contained —
 *  manages its own open state and click-away, like the app launcher. */
export function NotificationCenter() {
  const { notifications, unread, markRead, markAllRead, remove, clear } = useNotifications();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const goTo = useGoToTerminal();
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const counts = useMemo(() => {
    const c: Record<NotifyCategory, number> = { agent: 0, error: 0, info: 0 };
    for (const n of notifications) c[n.category] = (c[n.category] ?? 0) + 1;
    return c;
  }, [notifications]);
  const shown = filter === "all" ? notifications : notifications.filter((n) => n.category === filter);

  // Click a row: an agent/error notification deep-links to the terminal that fired it and is then
  // removed (you handled it, same as clicking its toast); a reminder with no target just marks read.
  const onRow = (n: AppNotification) => {
    if (n.workspaceId) { goTo(n.workspaceId, n.terminalId ?? undefined); remove(n.id); setOpen(false); }
    else markRead(n.id);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const raf = requestAnimationFrame(() => window.addEventListener("pointerdown", onDown));
    window.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("pointerdown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div className="relative">
      <button ref={btnRef} onClick={() => setOpen((o) => !o)} title="Notifications"
        className={`relative flex h-8 w-8 items-center justify-center rounded ${open ? "bg-edge text-bright" : "bg-elevated hover:bg-edge text-fg hover:text-bright"}`}>
        <BellIcon />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div ref={panelRef}
          className="absolute right-0 top-full z-50 mt-2 flex max-h-[70vh] w-[340px] max-w-[calc(100vw-1rem)] flex-col rounded-xl border border-edge bg-panel/95 shadow-2xl backdrop-blur">
          <div className="flex shrink-0 items-center justify-between border-b border-edge px-3 py-2">
            <div className="text-sm font-semibold">Notifications</div>
            <div className="flex items-center gap-2 text-xs">
              {unread > 0 && <button onClick={markAllRead} className="text-link hover:underline">Mark all read</button>}
              {notifications.length > 0 && <button onClick={clear} className="text-dim hover:text-fg">Clear all</button>}
            </div>
          </div>

          {notifications.length > 0 && (
            <div className="flex shrink-0 items-center gap-1 border-b border-edge px-2 py-1.5">
              {FILTERS.map((f) => {
                const n = f.key === "all" ? notifications.length : counts[f.key];
                return (
                  <button key={f.key} onClick={() => setFilter(f.key)}
                    className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition ${filter === f.key ? "bg-elevated text-bright" : "text-dim hover:text-fg"}`}>
                    {f.key !== "all" && <span className={`h-1.5 w-1.5 rounded-full ${CHIP[f.key]}`} />}
                    {f.label}
                    <span className="tabular-nums opacity-60">{n}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs text-dim">No notifications yet. Agent alerts you miss and reminders you schedule show up here.</div>
            ) : shown.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs text-dim">No {filter} notifications.</div>
            ) : (
              shown.map((n) => <NotificationRow key={n.id} n={n} onClick={() => onRow(n)} onRemove={() => remove(n.id)} />)
            )}
          </div>

          <PushoverUsage />
        </div>
      )}
    </div>
  );
}

function NotificationRow({ n, onClick, onRemove }: { n: AppNotification; onClick: () => void; onRemove: () => void }) {
  const clickable = Boolean(n.workspaceId);
  return (
    <div className={`group relative border-b border-surface px-3 py-2 ${n.read ? "" : "bg-elevated/30"}`}>
      <button onClick={onClick} className={`flex w-full items-start gap-2.5 pr-6 text-left ${clickable ? "cursor-pointer" : ""}`}>
        <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs font-bold text-white ${CHIP[n.category] ?? "bg-info"}`}>
          {(n.title || "•").charAt(0).toUpperCase()}
        </span>
        {n.imagePath && (
          <img src={n.imagePath} alt="" className="mt-0.5 h-7 w-7 shrink-0 rounded object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />}
            <span className="truncate text-[13px] font-medium text-bright">{n.title || (n.reminderId ? "Reminder" : "Notification")}</span>
            {n.wasMissed && <span className="shrink-0 rounded bg-amber-500/20 px-1 text-[9px] text-amber-400">missed</span>}
          </span>
          {n.body && <span className="mt-0.5 block whitespace-pre-wrap break-words text-xs text-fg">{n.body}</span>}
          <span className="mt-0.5 flex items-center gap-2 text-[10px] text-dim">
            {timeAgo(n.firedAt)}
            {n.pushover && (
              <span className={n.pushoverOk ? "text-success" : "text-error"}>
                {n.pushoverOk ? "· pushed" : "· push failed"}
              </span>
            )}
          </span>
        </span>
      </button>
      <button onClick={onRemove} aria-label="Remove"
        className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full text-dim opacity-0 transition hover:bg-error/20 hover:text-error group-hover:opacity-100">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className="h-3 w-3" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  );
}

/** Pushover monthly-usage readout. Reads the live quota; shows "not configured" when no keys are set
 *  (never faked). */
function PushoverUsage() {
  const { data } = useQuery({ queryKey: ["pushover", "quota"], queryFn: () => api.pushover.quota(), staleTime: 60_000 });
  if (!data) return null;
  if (!data.configured || !data.quota) {
    return (
      <div className="shrink-0 border-t border-edge px-3 py-2 text-[11px] text-dim">
        Pushover not configured — add your keys in Settings → Voice &amp; Speech to push reminders to your phone.
      </div>
    );
  }
  const { limit, remaining } = data.quota;
  const used = Math.max(0, limit - remaining);
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="shrink-0 space-y-1 border-t border-edge px-3 py-2">
      <div className="flex items-center justify-between text-[11px] text-dim">
        <span>Pushover this month</span>
        <span className="tabular-nums">{used.toLocaleString()} / {limit.toLocaleString()}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-canvas">
        <div className="h-full rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function BellIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
