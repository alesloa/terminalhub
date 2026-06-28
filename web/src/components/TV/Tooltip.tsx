import type { ReactNode } from "react";

/** CSS-only hover tooltip (no JS/state) for the TV tool's icon controls — a label that fades in on
 *  hover of its wrapper. Sized to its child (inline-flex), so it drops into the transport/title flex
 *  rows without disturbing layout. `side` picks above (transport) or below (title bar). */
export function Tooltip({ label, side = "top", children }: { label: string; side?: "top" | "bottom"; children: ReactNode }) {
  return (
    <span className="relative group/tt inline-flex">
      {children}
      <span
        className={`pointer-events-none absolute left-1/2 -translate-x-1/2 z-[60] whitespace-nowrap rounded-md border border-edge-strong bg-code px-2 py-1 text-[11px] font-medium text-bright opacity-0 shadow-lg transition-opacity duration-100 group-hover/tt:opacity-100 ${side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5"}`}>
        {label}
      </span>
    </span>
  );
}
