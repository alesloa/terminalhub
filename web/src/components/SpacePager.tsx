import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useUi } from "../store/ui";
import { SpaceCanvas } from "./SpaceCanvas";
import { CanvasBackdrop } from "./CanvasBackdrop";
import { DEFAULT_CANVAS_BACKGROUND } from "../lib/wallpapers";

/** Owns the spaces + workspaces polls and renders the horizontally-sliding filmstrip of per-space
 *  canvases. The Mission-Control switcher itself lives in the Terminal Hub top bar (SpacesMenu); this
 *  just draws the canvases and pans between them. One network poll for all spaces. */
export function SpacePager() {
  const { data: spacesData } = useQuery({ queryKey: ["spaces"], queryFn: api.listSpaces, refetchInterval: 5000 });
  const { data: wsData } = useQuery({ queryKey: ["workspaces"], queryFn: api.listWorkspaces, refetchInterval: 5000 });
  // Global canvas backdrop default (Settings → Appearance); each space falls back to it when it has
  // no override. Cached query shared with the rest of the app.
  const { data: settingsData } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const globalBg = settingsData?.canvasBackground ?? DEFAULT_CANVAS_BACKGROUND;
  const spaces = spacesData?.spaces ?? [];
  const desktopWorkspaceId = spacesData?.desktopWorkspaceId ?? null;
  const workspaces = wsData?.workspaces ?? [];

  const activeSpaceId = useUi(s => s.activeSpaceId);
  const setActiveSpace = useUi(s => s.setActiveSpace);

  // Resolve the stored active id to a real index; fall back to the first space when it's gone/unset.
  const activeIndex = Math.max(0, spaces.findIndex(s => s.id === activeSpaceId));
  const resolvedId = spaces[activeIndex]?.id ?? null;

  useEffect(() => {
    if (spaces.length && resolvedId && resolvedId !== activeSpaceId) setActiveSpace(resolvedId);
  }, [resolvedId, activeSpaceId, spaces.length, setActiveSpace]);

  // Keep the latest list + position in a ref so the global key handler binds once, not on every poll.
  const navRef = useRef({ spaces, activeIndex });
  navRef.current = { spaces, activeIndex };
  // Alt+←/→ jumps to the previous/next space — fast switching without the mouse. Skipped while
  // typing in a field or terminal so it never hijacks Option+word-motion there.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, [contenteditable='true'], .xterm")) return;
      const { spaces: list, activeIndex: i } = navRef.current;
      if (list.length < 2) return;
      const next = Math.min(list.length - 1, Math.max(0, i + (e.key === "ArrowRight" ? 1 : -1)));
      if (next !== i) { e.preventDefault(); setActiveSpace(list[next].id); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setActiveSpace]);

  // Don't slide on first load. activeSpaceId hydrates from localStorage instantly, but the spaces
  // query is empty on first paint, so the strip starts at index 0 (Home) and jumps to the remembered
  // space once spaces arrive. Keeping the transition off until that first settle (one rAF after spaces
  // load) makes the remembered canvas simply *be there* on refresh — no junky pan from Home — while
  // later user-driven space switches still glide. Gated on `animate` state (not a ref) so it survives
  // StrictMode's dev double-invoke.
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    if (animate || !spaces.length) return;
    const id = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(id);
  }, [animate, spaces.length]);

  const n = Math.max(1, spaces.length);
  return (
    <div className="flex flex-col h-full">
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <div className="flex h-full"
          style={{ width: `${n * 100}%`, transform: `translateX(-${activeIndex * (100 / n)}%)`, transition: animate ? "transform 300ms ease" : "none" }}>
          {spaces.map(sp => (
            <div key={sp.id} className="relative h-full shrink-0" style={{ width: `${100 / n}%` }}>
              <CanvasBackdrop bg={sp.background ?? globalBg} />
              <SpaceCanvas
                spaceId={sp.id}
                workspaces={workspaces.filter(w => w.spaceId === sp.id)}
                spaces={spaces}
                desktopWorkspaceId={desktopWorkspaceId}
                globalBg={globalBg}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
