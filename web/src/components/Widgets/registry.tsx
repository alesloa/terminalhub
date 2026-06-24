import type { ReactNode } from "react";
import type { SpaceWidgetKind } from "../../api/types";
import { ClaudeMeterWidget } from "./widgets/ClaudeMeterWidget";
import { CodexMeterWidget } from "./widgets/CodexMeterWidget";
import { WorldClockWidget, DEFAULT_BG as WORLD_CLOCK_BG } from "./widgets/WorldClockWidget";
import { WorldClockSettings } from "./widgets/WorldClockSettings";
import { MeterSettings } from "./widgets/MeterSettings";
import { BackgroundRow } from "./widgets/settingsShared";
import { AgentActivityWidget } from "./widgets/AgentActivityWidget";
import { TodayWidget } from "./widgets/TodayWidget";
import { HeadroomSavingsWidget, HeadroomSavingsSettings } from "./widgets/HeadroomSavingsWidget";

// The catalog the Widgets picker offers and the canvas cards render from. `w`/`h` are the spawn size
// when a widget is dropped onto a space; the user can resize from there. `hasSettings` makes the card
// show a gear in its title bar that toggles the widget's own settings overlay (e.g. the world clock).
// `selfBackground`: the widget paints `config.background` onto its own inner container (the meters'
// rounded screen), so the card must NOT also tint the body — that keeps the outer frame/padding at the
// default and only the inner container recolors.
// `defaultBackground`: the card body's background when the instance hasn't set `config.background` yet
// (a fresh drop). Lets a widget ship a non-panel default (e.g. the world clock's dark `#111110`).
export interface WidgetDef {
  kind: SpaceWidgetKind;
  label: string;
  description: string;
  icon: ReactNode;
  w: number;
  h: number;
  hasSettings?: boolean;
  selfBackground?: boolean;
  defaultBackground?: string;
}

// Per-instance context handed to a widget body: its persisted `config` (opaque JSON) + a setter that
// saves it. Undefined in the gallery preview (a preview is read-only — no config), so every widget
// must render fine without it.
export interface WidgetBodyCtx {
  config?: Record<string, unknown> | null;
  onConfigChange?: (config: Record<string, unknown>) => void;
}

// Context handed to a widget's settings body (rendered in the pop-out WidgetSettingsWindow). The card
// owns a transient preview overlay so changes show live on the widget without persisting every frame:
//   preview(patch)  — overlay a partial config (no save) for live drag feedback
//   commit(patch)   — persist a partial config (merged over current) and drop the preview
//   clearPreview()  — drop a dangling preview (e.g. a color popover closed mid-drag)
export interface WidgetSettingsCtx {
  config: Record<string, unknown> | null | undefined;
  preview: (patch: Record<string, unknown>) => void;
  commit: (patch: Record<string, unknown>) => void;
  clearPreview: () => void;
}

export const WIDGET_DEFS: WidgetDef[] = [
  { kind: "claude-meter", label: "Claude Usage", description: "5-hour + weekly rings with a today-pace panel.", icon: <SparkGlyph />, w: 250, h: 290, hasSettings: true, selfBackground: true },
  { kind: "codex-meter", label: "Codex Usage", description: "OpenAI Codex 5-hour + weekly rings + today pace.", icon: <HexGlyph />, w: 250, h: 290, hasSettings: true, selfBackground: true },
  { kind: "world-clock", label: "World Clock", description: "Analog + digital clocks for your cities; pick accent, size.", icon: <ClockGlyph />, w: 230, h: 500, hasSettings: true, defaultBackground: WORLD_CLOCK_BG },
  { kind: "agent-activity", label: "Agent Activity", description: "Running agents and which need input.", icon: <PulseGlyph />, w: 230, h: 175, hasSettings: true },
  { kind: "today", label: "Today", description: "Today's reminders and events.", icon: <CalGlyph />, w: 250, h: 220, hasSettings: true },
  { kind: "headroom-savings", label: "Headroom Savings", description: "Live tokens + dollars saved by the Headroom compression proxy.", icon: <CompressGlyph />, w: 260, h: 320, hasSettings: true, selfBackground: true },
];

export function widgetDef(kind: SpaceWidgetKind): WidgetDef {
  return WIDGET_DEFS.find((d) => d.kind === kind) ?? WIDGET_DEFS[0];
}

export function renderWidgetBody(kind: SpaceWidgetKind, ctx?: WidgetBodyCtx): ReactNode {
  switch (kind) {
    case "claude-meter": return <ClaudeMeterWidget config={ctx?.config} />;
    case "codex-meter": return <CodexMeterWidget config={ctx?.config} />;
    case "world-clock": return <WorldClockWidget config={ctx?.config} onConfigChange={ctx?.onConfigChange} />;
    case "agent-activity": return <AgentActivityWidget />;
    case "today": return <TodayWidget />;
    case "headroom-savings": return <HeadroomSavingsWidget config={ctx?.config} />;
    default: return null;
  }
}

/** The settings body for a widget's pop-out window. Every body includes the universal Background
 *  control; widgets without their own options fall back to a Background-only panel. */
export function renderWidgetSettings(kind: SpaceWidgetKind, ctx: WidgetSettingsCtx): ReactNode {
  switch (kind) {
    case "claude-meter": return <MeterSettings agent="claude" {...ctx} />;
    case "codex-meter": return <MeterSettings agent="codex" {...ctx} />;
    case "world-clock": return <WorldClockSettings {...ctx} />;
    case "headroom-savings": return <HeadroomSavingsSettings {...ctx} />;
    default: return <div className="flex flex-col gap-3"><BackgroundRow {...ctx} /></div>;
  }
}

/** Four-point spark — the Claude usage meter (terra-cotta brand). */
function SparkGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ color: "#d97757" }}>
      <path d="M12 2c.4 4.3 2.7 6.6 7 7-4.3.4-6.6 2.7-7 7-.4-4.3-2.7-6.6-7-7 4.3-.4 6.6-2.7 7-7Z" />
    </svg>
  );
}
/** OpenAI-style hexagon with a centred knot — the Codex usage meter (OpenAI green brand). */
function HexGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden style={{ color: "#10a37f" }}>
      <path d="M12 2.5 20 7v10l-8 4.5L4 17V7z" /><circle cx="12" cy="12" r="3.1" />
    </svg>
  );
}
function ClockGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" />
    </svg>
  );
}
function PulseGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 12h3l2.5 7 5-14 2.5 7H21" />
    </svg>
  );
}
function CalGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3.5" y="4.5" width="17" height="16" rx="2" /><path d="M3.5 9h17M8 3v3M16 3v3" />
    </svg>
  );
}
/** Two arrows compressing toward a centre line — the Headroom savings meter (brand teal). */
function CompressGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ color: "#2fb89b" }}>
      <path d="M8 3.5l4 4 4-4" /><path d="M8 20.5l4-4 4 4" /><path d="M4 12h16" />
    </svg>
  );
}
