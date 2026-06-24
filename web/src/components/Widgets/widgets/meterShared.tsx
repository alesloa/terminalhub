import { DisabledOverlay } from "../WidgetCard";
import type { MeterDecoration, MeterLevel } from "../../../api/types";

// Shared chrome for the usage meters (Claude + Codex) — a faithful port of TokenGauge
// (token-gauge/renderer + styles.css): two ring gauges (5-hour session + this week) with the live %
// in the centre, a forward-looking "Today" pace panel, and an "updated · trending" footer. There is
// NO status/verb line — the footer reports real numbers, not a fake "thinking" animation. The dark
// surface (bg/panel/track) is shared; the green→amber→red health ramp is per agent (`MeterRamp`) so
// each meter wears its brand — Claude keeps TokenGauge's terra-cotta, Codex leads with OpenAI green.
const METER = {
  bg: "#111110",
  panel: "#1f1f1e",
  text: "#faf9f5",
  dim: "#b0aea5",
  track: "#2a2a28",
  border: "rgba(250,249,245,0.09)",
};

const R = 46;
const C = 2 * Math.PI * R; // ring circumference ≈ 289.03

// A usable usage poll: the available branch of Claude/CodexUsageResult, narrowed to what the gauge
// reads (both result types are structurally assignable to this).
export interface MeterUsableWindow { pct: number; resetsAt: string | null }
export type MeterData =
  | ({ available: true; session: MeterUsableWindow; weekly: MeterUsableWindow } & MeterDecoration)
  | { available: false; reason: string };

// The three-tier health ramp (ok → warn → over). Per agent so each meter wears its own brand: Claude
// keeps TokenGauge's terra-cotta; Codex leads with OpenAI's signature green.
export interface MeterRamp { ok: string; warn: string; over: string }
export const CLAUDE_RAMP: MeterRamp = { ok: "#788c5d", warn: "#d97757", over: "#c0392b" };
export const CODEX_RAMP: MeterRamp = { ok: "#10a37f", warn: "#d9883a", over: "#e5484d" };

// Overlay any per-instance color overrides (from the widget's settings) onto the agent's brand ramp.
// A field that's absent/null falls back to the brand default — so "reset" just clears the override.
export function mergeRamp(base: MeterRamp, config?: Record<string, unknown> | null): MeterRamp {
  const c = (config ?? {}) as Partial<MeterRamp>;
  const pick = (k: keyof MeterRamp): string => (typeof c[k] === "string" ? (c[k] as string) : base[k]);
  return { ok: pick("ok"), warn: pick("warn"), over: pick("over") };
}

// 5h ring is coloured by its own pressure; the fill/week-ring/dot follow the pace `level`/`weekLevel`.
const ringColorByPct = (p: number, r: MeterRamp): string => (p < 70 ? r.ok : p < 90 ? r.warn : r.over);
const levelColor = (r: MeterRamp, l: MeterLevel): string => (l === "ok" ? r.ok : l === "warn" ? r.warn : r.over);

/** Minutes from now until an ISO reset timestamp (live, ticks with `now`); 0 if absent/elapsed. */
function minsUntil(resetsAt: string | null, now: number): number {
  if (!resetsAt) return 0;
  const t = Date.parse(resetsAt);
  if (!Number.isFinite(t)) return 0;
  const m = Math.round((t - now) / 60_000);
  return m > 0 ? m : 0;
}

// TokenGauge's wording: "resets now" / "resets in Xm" / "Xh Ym" / "Xd Yh".
function fmtReset(mins: number): string {
  const m = Math.round(mins || 0);
  if (m <= 0) return "resets now";
  if (m < 60) return `resets in ${m}m`;
  if (m < 1440) return `resets in ${Math.floor(m / 60)}h ${m % 60}m`;
  return `resets in ${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
}

function fmtClock(at: number): string {
  const t = new Date(at);
  return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
}

const RING_PX = 96;

function Ring({ pct, color, label, reset }: { pct: number; color: string; label: string; reset: string }) {
  const p = Math.max(0, Math.min(100, pct || 0));
  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: RING_PX, height: RING_PX }}>
        <svg viewBox="0 0 120 120" width={RING_PX} height={RING_PX} className="block">
          <circle cx="60" cy="60" r={R} fill="none" stroke={METER.track} strokeWidth="9" />
          <circle
            cx="60" cy="60" r={R} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - p / 100)} transform="rotate(-90 60 60)"
            style={{ transition: "stroke-dashoffset 0.6s ease, stroke 0.3s ease" }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span className="text-[22px] font-bold tabular-nums leading-none" style={{ color: METER.text }}>{p}%</span>
        </div>
      </div>
      <div className="mt-1 text-[11px]" style={{ color: METER.dim }}>{label}</div>
      <div className="mt-0.5 h-3 text-[10px] opacity-75 tabular-nums" style={{ color: METER.dim }}>{reset}</div>
    </div>
  );
}

function TodayPanel({ pace, ramp }: { pace: MeterDecoration["pace"]; ramp: MeterRamp }) {
  const { paceDelta, todayBudget, usedToday, todayRemaining, perDay, level } = pace;

  // Pace tag — how far ahead/behind the even weekly split you are.
  let paceTxt = "on pace";
  let paceColor = METER.dim;
  if (paceDelta > 1) { paceTxt = `${Math.round(paceDelta)}% ahead of pace`; paceColor = ramp.warn; }
  else if (paceDelta < -1) { paceTxt = `${Math.round(-paceDelta)}% under pace`; paceColor = ramp.ok; }

  const fillPct = Math.min(100, todayBudget > 0 ? (usedToday / todayBudget) * 100 : 100);
  const left = Math.round(todayRemaining);
  const usedTxt = `${Math.round(usedToday)}% used today`;
  const metaLeft = left >= 0 ? `${usedTxt} · ${left}% left` : `${usedTxt} · over by ${-left}%`;
  const budgetRound = Math.round(todayBudget);
  const rollColor = budgetRound < perDay - 0.5 ? ramp.warn : ramp.ok;

  return (
    <div className="mt-3.5">
      <div className="mb-1.5 flex items-baseline justify-between text-[11px]" style={{ color: METER.dim }}>
        <span>Today</span>
        <span className="font-semibold" style={{ color: paceColor }}>{paceTxt}</span>
      </div>
      <div className="h-3 overflow-hidden rounded-[7px]" style={{ background: METER.track }}>
        <div
          className={`h-full rounded-[7px] ${level !== "ok" ? "animate-pulse" : ""}`}
          style={{ width: `${fillPct}%`, background: levelColor(ramp, level), transition: "width 0.6s ease, background 0.3s ease" }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px]">
        <span style={{ color: METER.text }}>{metaLeft}</span>
        <span className="font-semibold" style={{ color: rollColor }}>~{budgetRound}%/day budget</span>
      </div>
    </div>
  );
}

function Footer({ at, projectedWeekEnd, level, ramp }: { at: number; projectedWeekEnd: number; level: MeterLevel; ramp: MeterRamp }) {
  return (
    <div className="mt-auto flex items-center gap-[7px] pt-2.5 text-[11px]" style={{ color: METER.dim }}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: levelColor(ramp, level) }} />
      <span className="tabular-nums">updated {fmtClock(at)} · trending ~{Math.round(projectedWeekEnd)}% by week end</span>
    </div>
  );
}

/** The full TokenGauge "card": loading skeleton, greyed-out unavailable state, or the live rings +
 *  Today panel + footer. `now` (a per-second tick) keeps the reset countdowns live. `ramp` is the
 *  agent's brand health ramp (Claude terra-cotta vs Codex OpenAI-green). */
export function MeterScreen({ data, now, ramp = CLAUDE_RAMP, background }: { data: MeterData | undefined; now: number; ramp?: MeterRamp; background?: string | null }) {
  return (
    <div className="flex h-full min-h-0 flex-col rounded-[14px] p-3" style={{ background: background ?? METER.bg, border: `1px solid ${METER.border}` }}>
      {!data ? (
        <>
          <div className="flex justify-center gap-4">
            {[0, 1].map((i) => (
              <div key={i} className="rounded-full animate-pulse" style={{ width: RING_PX, height: RING_PX, background: METER.panel }} />
            ))}
          </div>
          <div className="mt-3.5 h-3 rounded-[7px] animate-pulse" style={{ background: METER.panel }} />
          <div className="mt-auto h-3" />
        </>
      ) : !data.available ? (
        <div className="relative flex h-full min-h-0 flex-col">
          <div className="pointer-events-none select-none opacity-30">
            <div className="flex justify-center gap-4">
              <Ring pct={0} color={ramp.ok} label="5 h session" reset="" />
              <Ring pct={0} color={ramp.ok} label="this week" reset="" />
            </div>
          </div>
          <DisabledOverlay reason={data.reason} />
        </div>
      ) : (
        <>
          <div className="flex justify-center gap-4">
            <Ring pct={data.session.pct} color={ringColorByPct(data.session.pct, ramp)} label={"5 h session"} reset={fmtReset(minsUntil(data.session.resetsAt, now))} />
            <Ring pct={data.weekly.pct} color={levelColor(ramp, data.pace.weekLevel)} label="this week" reset={fmtReset(minsUntil(data.weekly.resetsAt, now))} />
          </div>
          <TodayPanel pace={data.pace} ramp={ramp} />
          <Footer at={data.at} projectedWeekEnd={data.pace.projectedWeekEnd} level={data.pace.level} ramp={ramp} />
        </>
      )}
    </div>
  );
}
