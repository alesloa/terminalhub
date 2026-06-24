import { useQuery } from "@tanstack/react-query";
import { api } from "../../../api/client";
import type { HeadroomSavings } from "../../../api/types";
import { DisabledOverlay } from "../WidgetCard";
import { ColorSwatch } from "../../ColorSwatch";
import { WIDGET_L_MIN } from "../../TerminalContextMenu";
import type { WidgetSettingsCtx } from "../registry";
import { Row, BackgroundRow } from "./settingsShared";

// The Headroom Savings meter — a live readout of how much the local compression proxy is saving:
// tokens stripped before each request hits the model, the dollar value of that, and how aggressively
// it's compressing. Numbers come from the proxy's /stats (server/src/agents/headroom.ts), polled on
// an interval. Brand teal (#2fb89b) is the same accent as the "Claude (Headroom)" launcher icon, so
// the two read as one feature; the user can recolor it per instance from the settings gear (the green
// $ / bar / dots all follow `config.accent`). Dark "screen" surface matches the usage meters.
const DEFAULT_ACCENT = "#2fb89b"; // headroom teal — also the settings swatch's default
const HR = {
  bg: "#0e1413",      // near-black with a faint teal cast
  panel: "#16201d",
  text: "#eef5f3",
  dim: "#8aa39d",
  track: "#22302c",
  border: "rgba(47,184,155,0.18)",
};

function readAccent(config?: Record<string, unknown> | null): string {
  return config && typeof config.accent === "string" ? config.accent : DEFAULT_ACCENT;
}

/** Compact token count: 2_188_082 → "2.2M", 18_378_603 → "18M". One decimal under 10× the unit. */
function fmtTokens(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "K";
  return String(Math.round(n));
}
/** Dollars: cents under $100 ("$7.24"), whole above ("$118"). */
function fmtUsd(n: number): string {
  return "$" + (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(2));
}
function fmtClock(at: number): string {
  const t = new Date(at);
  return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
}
/** opus-4-8 from claude-opus-4-8 — drop the vendor prefix for the footer. */
function shortModel(m: string | null): string {
  if (!m) return "";
  return m.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

export function HeadroomSavingsWidget({ config }: { config?: Record<string, unknown> | null }) {
  // 30s cadence: /stats only moves when a request flows through the proxy, so a tighter poll buys
  // nothing. react-query keeps the last good value on screen across refetches (no fl‑to‑skeleton flicker).
  const { data } = useQuery({ queryKey: ["headroom-savings"], queryFn: api.headroomSavings, refetchInterval: 30_000 });
  const background = config && typeof config.background === "string" ? config.background : undefined;
  return <SavingsScreen data={data} background={background} accent={readAccent(config)} />;
}

/** Settings body — recolor the teal Accent and the card Background, per instance. */
export function HeadroomSavingsSettings(ctx: WidgetSettingsCtx) {
  const { config, preview, commit, clearPreview } = ctx;
  const c = (config ?? {}) as { accent?: unknown };
  const accent = typeof c.accent === "string" ? c.accent : null;
  return (
    <div className="flex flex-col gap-3">
      <Row label="Accent">
        <ColorSwatch value={accent} defaultColor={DEFAULT_ACCENT} minLight={WIDGET_L_MIN} allowNeutral
          onPreview={(col) => preview({ accent: col })} onPick={(col) => commit({ accent: col })} onClose={clearPreview} />
      </Row>
      <div className="h-px bg-edge" />
      <BackgroundRow {...ctx} />
    </div>
  );
}

function SavingsScreen({ data, background, accent }: { data: HeadroomSavings | undefined; background?: string | null; accent: string }) {
  return (
    <div
      className="flex h-full min-h-0 flex-col rounded-[14px] p-3.5"
      style={{ background: background ?? HR.bg, border: `1px solid ${HR.border}`, color: HR.text }}
    >
      <Header live={!!data && data.available} accent={accent} />
      {!data ? (
        <Skeleton />
      ) : !data.available ? (
        <div className="relative flex flex-1 min-h-0 flex-col">
          <div className="pointer-events-none select-none opacity-30">
            <Body data={PLACEHOLDER} accent={accent} />
          </div>
          <DisabledOverlay reason={data.reason} />
        </div>
      ) : (
        <Body data={data} accent={accent} />
      )}
    </div>
  );
}

type Live = Extract<HeadroomSavings, { available: true }>;

// Shape the dimmed background renders behind the "unavailable" overlay — never shown as real data.
const PLACEHOLDER: Live = {
  available: true, tokensSaved: 0, tokensBefore: 1, tokensAfter: 1, tokenSavingsPct: 0, usdSaved: 0,
  usdSavingsPct: 0, cacheSavedUsd: 0, avgCompressionPct: 0, bestCompressionPct: 0, requestsCompressed: 0,
  apiRequests: 0, primaryModel: null, at: 0,
};

function Header({ live, accent }: { live: boolean; accent: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: HR.dim }}>Headroom</span>
      <span className="flex items-center gap-1.5 text-[10px]" style={{ color: live ? accent : HR.dim }}>
        <span
          className={`h-1.5 w-1.5 rounded-full ${live ? "animate-pulse" : ""}`}
          style={{ background: live ? accent : HR.track }}
        />
        {live ? "live" : "idle"}
      </span>
    </div>
  );
}

function Body({ data, accent }: { data: Live; accent: string }) {
  const reductionPct = Math.max(0, Math.min(100, data.tokenSavingsPct));
  return (
    <>
      {/* Hero: the headline win is tokens removed; dollars sit beside it as the money translation. */}
      <div className="mt-2.5 flex items-end justify-between">
        <div>
          <div className="text-[30px] font-bold leading-none tabular-nums" style={{ color: HR.text }}>
            {fmtTokens(data.tokensSaved)}
          </div>
          <div className="mt-1 text-[11px]" style={{ color: HR.dim }}>tokens saved</div>
        </div>
        <div className="text-right">
          <div className="text-[20px] font-semibold leading-none tabular-nums" style={{ color: accent }}>
            {fmtUsd(data.usdSaved)}
          </div>
          <div className="mt-1 text-[11px]" style={{ color: HR.dim }}>
            saved · {Math.round(data.usdSavingsPct)}% off
          </div>
        </div>
      </div>

      {/* Compression bar: track = everything that entered the proxy, accent fill = the slice removed. */}
      <div className="mt-3.5">
        <div className="h-2 overflow-hidden rounded-full" style={{ background: HR.track }}>
          <div
            className="h-full rounded-full"
            style={{ width: `${reductionPct}%`, background: accent, transition: "width .6s ease" }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[11px]" style={{ color: HR.dim }}>
          <span className="tabular-nums">{fmtTokens(data.tokensBefore)} → {fmtTokens(data.tokensAfter)}</span>
          <span className="font-semibold tabular-nums" style={{ color: HR.text }}>{reductionPct.toFixed(1)}% smaller</span>
        </div>
      </div>

      {/* Supporting stats — two columns, four facts. */}
      <div className="mt-3.5 grid grid-cols-2 gap-x-3 gap-y-2.5">
        <Stat label="avg compression" value={`${Math.round(data.avgCompressionPct)}%`} />
        <Stat label="best request" value={`${Math.round(data.bestCompressionPct)}%`} />
        <Stat label="requests compressed" value={`${data.requestsCompressed}/${data.apiRequests}`} />
        <Stat label="saved by caching" value={`+${fmtUsd(data.cacheSavedUsd)}`} color={accent} />
      </div>

      <Footer at={data.at} model={shortModel(data.primaryModel)} accent={accent} />
    </>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-[15px] font-semibold leading-none tabular-nums" style={{ color: color ?? HR.text }}>
        {value}
      </div>
      <div className="mt-1 text-[10px] leading-tight" style={{ color: HR.dim }}>{label}</div>
    </div>
  );
}

function Footer({ at, model, accent }: { at: number; model: string; accent: string }) {
  return (
    <div className="mt-auto flex items-center gap-[7px] pt-3 text-[11px]" style={{ color: HR.dim }}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: accent }} />
      <span className="tabular-nums">updated {fmtClock(at)}{model ? ` · ${model}` : ""}</span>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="mt-2.5 flex justify-between">
        <div className="h-8 w-20 animate-pulse rounded-md" style={{ background: HR.panel }} />
        <div className="h-7 w-16 animate-pulse rounded-md" style={{ background: HR.panel }} />
      </div>
      <div className="mt-4 h-2 animate-pulse rounded-full" style={{ background: HR.panel }} />
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-7 animate-pulse rounded-md" style={{ background: HR.panel }} />)}
      </div>
      <div className="mt-auto h-3" />
    </div>
  );
}
