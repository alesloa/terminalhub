import type { ReactNode } from "react";

/** Shared chrome for one widget in the Widgets menu: a titled, bordered card. Each widget owns its
 *  own body (loading / empty / disabled states) — this is just the frame. */
export function WidgetCard({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-edge bg-canvas/40 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-edge">
        <span className="grid place-items-center text-dim">{icon}</span>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

/** Greyed-out overlay for a widget whose data source isn't available (e.g. Claude Code not logged
 *  in). The widget body renders dimmed behind it; hovering reveals the reason. */
export function DisabledOverlay({ reason }: { reason: string }) {
  return (
    <div className="group absolute inset-0 grid place-items-center rounded-md bg-canvas/70 backdrop-blur-[1px] cursor-help">
      <div className="flex items-center gap-1.5 text-[11px] text-dim">
        <LockGlyph />
        <span>Unavailable</span>
      </div>
      <div className="pointer-events-none absolute inset-x-2 bottom-2 rounded-md border border-edge-strong bg-panel/95 px-2.5 py-1.5 text-[11px] leading-snug text-muted opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100">
        {reason}
      </div>
    </div>
  );
}

function LockGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </svg>
  );
}
