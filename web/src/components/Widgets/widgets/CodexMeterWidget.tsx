import { useQuery } from "@tanstack/react-query";
import { api } from "../../../api/client";
import { useTick } from "../time";
import { MeterScreen, CODEX_RAMP, mergeRamp } from "./meterShared";

// The Codex usage meter — the OpenAI sibling of the Claude meter, rendering the identical TokenGauge
// gauge (rings + Today pace panel + footer; see meterShared.tsx). Numbers come from
// `codex app-server`'s account/rateLimits/read (`primary` → 5-hour, `secondary` → weekly) plus the
// same forward-looking pace the server computes (server/src/meters). `config` carries optional
// per-instance ring-color overrides (ok/warn/over), layered over Codex's OpenAI-green brand ramp.
export function CodexMeterWidget({ config }: { config?: Record<string, unknown> | null }) {
  const now = useTick();
  const { data } = useQuery({ queryKey: ["codex-usage"], queryFn: () => api.getCodexUsage(), refetchInterval: 60_000 });
  const background = config && typeof config.background === "string" ? config.background : undefined;
  return <MeterScreen data={data} now={now} ramp={mergeRamp(CODEX_RAMP, config)} background={background} />;
}
