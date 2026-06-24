import { useQuery } from "@tanstack/react-query";
import { api } from "../../../api/client";
import { useTick } from "../time";
import { MeterScreen, CLAUDE_RAMP, mergeRamp } from "./meterShared";

// The Claude usage meter — a faithful port of the TokenGauge app (rings + Today pace panel + footer;
// see meterShared.tsx). Numbers come from the unified 5h/7d rate-limit headers the server reads, plus
// the forward-looking pace it computes (server/src/meters). `now` ticks once a second so the reset
// countdowns stay live. `config` carries optional per-instance ring-color overrides from the widget's
// settings (ok/warn/over), layered over Claude's terra-cotta brand ramp.
export function ClaudeMeterWidget({ config }: { config?: Record<string, unknown> | null }) {
  const now = useTick();
  const { data } = useQuery({ queryKey: ["claude-usage"], queryFn: () => api.getClaudeUsage(), refetchInterval: 60_000 });
  const background = config && typeof config.background === "string" ? config.background : undefined;
  return <MeterScreen data={data} now={now} ramp={mergeRamp(CLAUDE_RAMP, config)} background={background} />;
}
