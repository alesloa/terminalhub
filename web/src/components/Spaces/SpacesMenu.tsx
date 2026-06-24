import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useUi } from "../../store/ui";
import { useAttention } from "../../hooks/useAttention";
import { SpacesOverview } from "./SpacesOverview";

/** The virtual-spaces switcher, pinned in the Terminal Hub top bar. Shows the active space as a pill
 *  (icon + name + chevron) with quick-jump dots; clicking the pill drops the Mission-Control overview
 *  down beneath it so you can add/rename/recolor spaces. Replaces the old standalone spaces bar.
 *  Shares the app-wide spaces/workspaces/attention polls (react-query dedups), so it adds no requests. */
export function SpacesMenu() {
  const { data: spacesData } = useQuery({ queryKey: ["spaces"], queryFn: api.listSpaces, refetchInterval: 5000 });
  const { data: wsData } = useQuery({ queryKey: ["workspaces"], queryFn: api.listWorkspaces, refetchInterval: 5000 });
  const spaces = spacesData?.spaces ?? [];
  const homeSpaceId = spacesData?.homeSpaceId ?? null;
  const workspaces = wsData?.workspaces ?? [];

  const activeSpaceId = useUi(s => s.activeSpaceId);
  const setActiveSpace = useUi(s => s.setActiveSpace);
  const open = useUi(s => s.spacesOverviewOpen);
  const toggle = useUi(s => s.toggleSpacesOverview);
  const setOpen = useUi(s => s.setSpacesOverviewOpen);

  // Resolve the stored active id to a real space; fall back to the first when it's gone/unset.
  const activeIndex = Math.max(0, spaces.findIndex(s => s.id === activeSpaceId));
  const resolvedId = spaces[activeIndex]?.id ?? null;
  const active = spaces.find(s => s.id === resolvedId) ?? spaces[0];

  // workspaceId → spaceId, to light up a space's dot/tile when a terminal in it needs attention.
  const spaceOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of workspaces) if (w.spaceId) m.set(w.id, w.spaceId);
    return m;
  }, [workspaces]);
  const attention = useAttention();
  const attentionSpaceIds = useMemo(() => {
    const set = new Set<string>();
    for (const a of attention) { const sid = spaceOf.get(a.workspaceId); if (sid) set.add(sid); }
    return set;
  }, [attention, spaceOf]);

  // Click-away / Escape closes the dropdown (the dots + tiles inside the wrapper don't count as away).
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("pointerdown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open, setOpen]);

  return (
    <div ref={ref} className="relative flex items-center gap-3">
      <button onClick={toggle}
        className="flex items-center gap-2 rounded-full border border-edge bg-elevated px-3 py-1 text-sm hover:border-accent">
        <span className={`codicon codicon-${active?.icon ?? "layout"}`} aria-hidden />
        <span className="font-medium truncate max-w-[160px]">{active?.name ?? "Spaces"}</span>
        <span className={`codicon codicon-chevron-${open ? "up" : "down"} text-muted`} aria-hidden />
      </button>

      {/* one dot per space — click to jump straight there. Active dot fills the space's color with a
          ring; the rest stay dim. Blinks if a space you aren't viewing wants attention. */}
      {spaces.length > 1 && (
        <div className="flex items-center gap-1.5">
          {spaces.map(s => {
            const isActive = s.id === resolvedId;
            const blink = attentionSpaceIds.has(s.id) && !isActive;
            const color = s.color ?? "rgb(var(--tr-accent))";
            return (
              <button key={s.id} onClick={() => setActiveSpace(s.id)} title={s.name}
                aria-label={`Switch to ${s.name}`} aria-current={isActive}
                className="grid place-items-center w-5 h-5 rounded-full transition hover:scale-125">
                {/* Blinking dot leaves its fill to the lime-green tr-space-attn keyframe (no inline bg). */}
                <span className={`w-3 h-3 rounded-full transition-all ${blink ? "tr-space-attn" : ""}`}
                  style={isActive
                    ? { background: color, boxShadow: `0 0 0 2px rgb(var(--tr-panel)), 0 0 0 3px ${color}` }
                    : blink
                      ? undefined
                      : { background: "rgb(var(--tr-text-dim))", opacity: 0.55 }} />
              </button>
            );
          })}
        </div>
      )}

      {/* Mission-Control overview, dropped beneath the pill — grows/fades in on open and reverses on
          close (the pill toggle, click-away, Escape, or picking a space all flip the store flag).
          Capped to the viewport so a long row of spaces scrolls horizontally instead of running off. */}
      <SpacesDropdown open={open}>
        <SpacesOverview
          spaces={spaces} activeSpaceId={resolvedId} homeSpaceId={homeSpaceId}
          workspaces={workspaces} attentionSpaceIds={attentionSpaceIds} />
      </SpacesDropdown>
    </div>
  );
}

/** Open/close animation for the Mission-Control panel. Mounts on `open`, grows + fades from the top
 *  beneath the pill, and reverses on close — only unmounting once the transition ends, so the close is
 *  always seen. `open` is the store flag (flipped by the pill toggle, click-away, Escape, or a space
 *  pick). Mirrors the launcher dropdown. Respects prefers-reduced-motion. */
function SpacesDropdown({ open, children }: { open: boolean; children: ReactNode }) {
  const reduce = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [mounted, setMounted] = useState(open);
  const [show, setShow] = useState(open && reduce);
  const showRef = useRef(show);
  showRef.current = show;

  useEffect(() => {
    if (open) { setMounted(true); return; }
    if (reduce || !showRef.current) setMounted(false); // never animated open → just unmount
    else setShow(false);                               // animate out; onTransitionEnd unmounts
  }, [open, reduce]);

  useEffect(() => {
    if (!mounted || !open) return;
    if (reduce) { setShow(true); return; }
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setShow(true)));
    return () => cancelAnimationFrame(id);
  }, [mounted, open, reduce]);

  if (!mounted) return null;
  return (
    <div role="menu"
      onTransitionEnd={(e) => { if (e.target === e.currentTarget && e.propertyName === "transform" && !show) setMounted(false); }}
      style={{ transformOrigin: "top center" }}
      className={`absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 max-w-[calc(100vw-2rem)]
        rounded-xl border border-edge bg-panel/95 backdrop-blur shadow-2xl
        ${reduce ? "" : "transition-[opacity,transform] duration-150 ease-out"}
        ${show ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}>
      {children}
    </div>
  );
}
