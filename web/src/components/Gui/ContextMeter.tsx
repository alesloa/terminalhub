import { memo } from "react";
import type { GuiContextUsage } from "../../api/guiTypes";

// How full the window is, and what the session has cost so far. Both numbers come from the CLI's own
// accounting — the context window also holds the system prompt, tools, skills and memory files, so
// anything derived from message token counts here would read low and drift further as it grows.

const fmtTokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
const fmtCost = (n: number) => (n < 0.01 ? `<$0.01` : `$${n.toFixed(2)}`);

export const ContextMeter = memo(function ContextMeter({
  usage, costUsd,
}: {
  usage: GuiContextUsage | null;
  costUsd: number | null;
}) {
  if (!usage && costUsd === null) return null;

  const pct = usage ? Math.max(0, Math.min(100, usage.percentage)) : 0;
  // Amber before it bites, red once compaction (or truncation) is imminent.
  const tone = pct >= 90 ? "text-error" : pct >= 75 ? "text-warn" : "text-dim";

  const radius = 6;
  const circumference = 2 * Math.PI * radius;

  return (
    <span className="flex items-center gap-2 text-[11px] text-dim">
      {usage && (
        <span
          className={`flex items-center gap-1 ${tone}`}
          title={`${fmtTokens(usage.usedTokens)} of ${fmtTokens(usage.maxTokens)} context tokens used${usage.autoCompact ? " · auto-compacts when full" : ""}`}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" className="-rotate-90" aria-hidden>
            <circle cx="8" cy="8" r={radius} fill="none" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.25" />
            <circle
              cx="8" cy="8" r={radius} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - pct / 100)}
            />
          </svg>
          <span className="tabular-nums">{Math.round(pct)}%</span>
        </span>
      )}
      {costUsd !== null && costUsd > 0 && (
        <span className="tabular-nums" title="Estimated cost of this session">{fmtCost(costUsd)}</span>
      )}
    </span>
  );
});
