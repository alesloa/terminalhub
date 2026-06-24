import { useEffect, useRef, useState } from "react";

// Tracks which child (by its data-stage-id) sits nearest the center of a scroll container along
// `axis`. Drives the carousel's "centered tile" emphasis and (in spotlight) which room is staged.
export function useCenteredChild(axis: "x" | "y", deps: unknown[] = []) {
  const ref = useRef<HTMLDivElement>(null);
  const [centeredId, setCenteredId] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const box = el.getBoundingClientRect();
      const center = axis === "x" ? box.left + box.width / 2 : box.top + box.height / 2;
      let best: string | null = null;
      let bestD = Infinity;
      el.querySelectorAll<HTMLElement>("[data-stage-id]").forEach((c) => {
        const r = c.getBoundingClientRect();
        const mid = axis === "x" ? r.left + r.width / 2 : r.top + r.height / 2;
        const d = Math.abs(mid - center);
        if (d < bestD) { bestD = d; best = c.dataset.stageId ?? null; }
      });
      setCenteredId(best);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axis, ...deps]);
  return { ref, centeredId };
}
