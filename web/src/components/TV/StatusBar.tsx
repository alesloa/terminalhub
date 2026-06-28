import type { ReactNode } from "react";

export interface StatusStat {
  key: string;
  icon: ReactNode;
  content: ReactNode;
  good?: boolean; // tints the icon accent (e.g. an active HLS stream)
}

/** PM2-style status strip pinned to the very bottom: a source label (green dot) on the left, then a row
 *  of stat cells separated by hairlines on the right. Stream-relevant info only — no CPU history. */
export function StatusBar({ sourceLabel, stats }: { sourceLabel: string; stats: StatusStat[] }) {
  return (
    <div className="h-[30px] shrink-0 flex items-center px-3.5 bg-canvas border-t border-edge text-[11px] text-muted select-none">
      <div className="flex items-center gap-2 text-bright font-medium text-[11.5px]">
        <span className="w-[7px] h-[7px] rounded-full bg-accent shadow-[0_0_7px_var(--tw-shadow-color)] shadow-accent" />
        {sourceLabel}
      </div>
      <div className="flex-1" />
      <div className="flex items-center h-[18px]">
        {stats.map((s, i) => (
          <div key={s.key}
            className={`flex items-center gap-1.5 px-3 h-full ${i > 0 ? "border-l border-edge" : ""} ${s.good ? "[&_svg]:text-accent" : "[&_svg]:text-dim"}`}>
            {s.icon}
            <span className="[&_b]:text-bright [&_b]:font-semibold">{s.content}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
