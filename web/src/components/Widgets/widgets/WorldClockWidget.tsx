import { useEffect, useState } from "react";
import { useTick } from "../time";

// World clock widget — analog + digital clocks per city via native Intl.DateTimeFormat (DST-correct,
// no tz library). Settings (layout, accent, background, size, 12/24h) live in the widget's own
// per-instance `config` (persists per space, syncs across tabs) and open from the card's title-bar
// gear in a pop-out window (see WorldClockSettings + WidgetSettingsWindow) — so the clocks stay
// visible while you tweak. Accent/background previews arrive live through the `config` prop (the card
// overlays a transient patch during a drag). A widget with no cities yet falls back to DEFAULT_CITIES.

export interface City { label: string; tz: string }
export interface WorldClockConfig {
  cities: City[];
  format24: boolean;
  accent: string | null;     // hex, or null = DEFAULT_ACCENT (blue)
  background: string | null; // hex card background, or null = DEFAULT_BG
  zoom: number;              // dial-size multiplier (1 = base)
}

// New-clock defaults: blue accent (the picker's "Blue" swatch, hue 222), the dark panel background,
// and a slightly zoomed-in dial so it reads bigger out of the box.
const DEFAULT_ACCENT = "#366ae2";
export const DEFAULT_BG = "#111110";
const DEFAULT_ZOOM = 1.4;

const DEFAULT_CITIES: City[] = [
  { label: "Los Angeles", tz: "America/Los_Angeles" },
  { label: "New York", tz: "America/New_York" },
  { label: "Tokyo", tz: "Asia/Tokyo" },
];

// A curated pick list for the "add city" dropdown — common zones, one canonical label each.
const ZONE_OPTIONS: City[] = [
  { label: "Honolulu", tz: "Pacific/Honolulu" },
  { label: "Los Angeles", tz: "America/Los_Angeles" },
  { label: "Denver", tz: "America/Denver" },
  { label: "Chicago", tz: "America/Chicago" },
  { label: "Guanajuato", tz: "America/Mexico_City" },
  { label: "New York", tz: "America/New_York" },
  { label: "São Paulo", tz: "America/Sao_Paulo" },
  { label: "London", tz: "Europe/London" },
  { label: "Paris", tz: "Europe/Paris" },
  { label: "Berlin", tz: "Europe/Berlin" },
  { label: "Athens", tz: "Europe/Athens" },
  { label: "Lagos", tz: "Africa/Lagos" },
  { label: "Dubai", tz: "Asia/Dubai" },
  { label: "Mumbai", tz: "Asia/Kolkata" },
  { label: "Bangkok", tz: "Asia/Bangkok" },
  { label: "Singapore", tz: "Asia/Singapore" },
  { label: "Hong Kong", tz: "Asia/Hong_Kong" },
  { label: "Tokyo", tz: "Asia/Tokyo" },
  { label: "Seoul", tz: "Asia/Seoul" },
  { label: "Sydney", tz: "Australia/Sydney" },
  { label: "Auckland", tz: "Pacific/Auckland" },
  { label: "UTC", tz: "UTC" },
];

const BASE_DIAL = 64;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Parse the opaque widget config into a fully-defaulted WorldClockConfig. A null config (never
 *  customised) falls back to the curated default cities; everything else has sane defaults. */
export function readConfig(config?: Record<string, unknown> | null): WorldClockConfig {
  const c = (config ?? {}) as Partial<WorldClockConfig>;
  const cities = Array.isArray(c.cities) && c.cities.every((v) => v && typeof (v as City).tz === "string" && typeof (v as City).label === "string")
    ? (c.cities as City[])
    : DEFAULT_CITIES;
  return {
    cities,
    format24: typeof c.format24 === "boolean" ? c.format24 : false,
    accent: typeof c.accent === "string" ? c.accent : DEFAULT_ACCENT,
    background: typeof c.background === "string" ? c.background : DEFAULT_BG,
    zoom: typeof c.zoom === "number" && Number.isFinite(c.zoom) ? clamp(c.zoom, 0.6, 2.2) : DEFAULT_ZOOM,
  };
}

interface Parts { h: number; m: number; s: number }
function zonedParts(date: Date, tz: string): Parts {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) if (part.type !== "literal") p[part.type] = part.value;
  return { h: parseInt(p.hour, 10) % 24, m: parseInt(p.minute, 10), s: parseInt(p.second, 10) };
}
function handAngles({ h, m, s }: Parts) {
  return { hour: (h % 12) * 30 + m * 0.5, minute: m * 6 + s * 0.1, second: s * 6 };
}
function formatDigital({ h, m, s }: Parts, format24: boolean): { time: string; ampm: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  if (format24) return { time: `${pad(h)}:${pad(m)}:${pad(s)}`, ampm: "" };
  const ampm = h < 12 ? "AM" : "PM";
  let hh = h % 12;
  if (hh === 0) hh = 12;
  return { time: `${hh}:${pad(m)}:${pad(s)}`, ampm };
}

function Dial({ tz, now, size, accentColor }: { tz: string; now: number; size: number; accentColor: string }) {
  const a = handAngles(zonedParts(new Date(now), tz));
  const ticks = [];
  for (let i = 0; i < 12; i++) {
    const ang = (i * 30 * Math.PI) / 180;
    const outer = 46;
    const major = i % 3 === 0;
    const inner = major ? 38 : 41;
    ticks.push(
      <line key={i}
        x1={50 + outer * Math.sin(ang)} y1={50 - outer * Math.cos(ang)}
        x2={50 + inner * Math.sin(ang)} y2={50 - inner * Math.cos(ang)}
        strokeWidth={major ? 2.2 : 1.5}
        style={{ stroke: major ? accentColor : "rgb(var(--tr-edge-strong))" }} />,
    );
  }
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden>
      <circle cx="50" cy="50" r="46" fill="none" strokeWidth="2.5" style={{ stroke: "rgb(var(--tr-edge))" }} />
      {ticks}
      <line x1="50" y1="50" x2="50" y2="28" strokeWidth="3.2" strokeLinecap="round" transform={`rotate(${a.hour} 50 50)`} style={{ stroke: "rgb(var(--tr-text-bright))" }} />
      <line x1="50" y1="50" x2="50" y2="18" strokeWidth="2.2" strokeLinecap="round" transform={`rotate(${a.minute} 50 50)`} style={{ stroke: "rgb(var(--tr-text-bright))" }} />
      <line x1="50" y1="57" x2="50" y2="13" strokeWidth="1.3" strokeLinecap="round" transform={`rotate(${a.second} 50 50)`} style={{ stroke: accentColor }} />
      <circle cx="50" cy="50" r="2.3" style={{ fill: accentColor }} />
    </svg>
  );
}

function CityClock({ city, now, format24, size, accentColor, onRemove }: {
  city: City; now: number; format24: boolean; size: number; accentColor: string; onRemove: () => void;
}) {
  const dig = formatDigital(zonedParts(new Date(now), city.tz), format24);
  const nameFont = Math.round(clamp(9 + (size - BASE_DIAL) * 0.05, 9, 14));
  const timeFont = Math.round(clamp(12 + (size - BASE_DIAL) * 0.12, 12, 24));
  return (
    <div className="group relative flex flex-col items-center gap-1">
      <div className="max-w-full truncate text-center font-bold uppercase tracking-wider leading-tight" style={{ color: accentColor, fontSize: nameFont }}>{city.label}</div>
      <Dial tz={city.tz} now={now} size={size} accentColor={accentColor} />
      <div className="font-semibold tabular-nums text-fg leading-none" style={{ fontSize: timeFont }}>
        {dig.time}{dig.ampm ? <span className="ml-0.5 text-[9px] font-semibold text-dim">{dig.ampm}</span> : null}
      </div>
      <button onClick={onRemove} title={`Remove ${city.label}`} data-no-drag
        className="absolute -top-1 right-0 grid h-4 w-4 place-items-center rounded text-dim opacity-0 transition hover:text-error group-hover:opacity-100">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
  );
}

/** A tiny segmented toggle (Vertical/Horizontal, 12h/24h). Shared with WorldClockSettings. */
export function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="inline-flex rounded-md border border-edge bg-canvas p-0.5">
      {options.map(([v, label]) => (
        <button key={v} data-no-drag onClick={() => onChange(v)}
          className={`rounded px-2 py-0.5 text-[11px] font-medium transition ${value === v ? "bg-elevated text-bright" : "text-dim hover:text-fg"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function WorldClockWidget({ config, onConfigChange }: {
  config?: Record<string, unknown> | null;
  onConfigChange?: (config: Record<string, unknown>) => void;
}) {
  const now = useTick();
  const [cfg, setCfg] = useState<WorldClockConfig>(() => readConfig(config));

  // Resync when the persisted row changes — another tab, or the card overlaying a live settings
  // preview onto `config` during an accent/background drag. readConfig is idempotent, so our own
  // saves don't loop.
  useEffect(() => { setCfg(readConfig(config)); }, [config]);

  const update = (patch: Partial<WorldClockConfig>) => {
    setCfg((prev) => {
      const next = { ...prev, ...patch };
      onConfigChange?.(next as unknown as Record<string, unknown>);
      return next;
    });
  };

  const addCity = (tz: string) => {
    const opt = ZONE_OPTIONS.find((o) => o.tz === tz);
    if (opt && !cfg.cities.some((c) => c.tz === tz)) update({ cities: [...cfg.cities, opt] });
  };
  const available = ZONE_OPTIONS.filter((o) => !cfg.cities.some((c) => c.tz === o.tz));

  const accentColor = cfg.accent ?? "rgb(var(--tr-accent))";
  const dialPx = Math.round(BASE_DIAL * cfg.zoom);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {cfg.cities.length === 0 ? (
        <div className="py-3 text-center text-xs text-dim">No clocks — add a city below.</div>
      ) : (
        // Always a responsive wrapping grid: clocks reflow into as many columns as the card width
        // allows, so resizing the card is the layout control (no separate vertical/horizontal toggle).
        <div className="flex flex-wrap justify-center gap-x-3 gap-y-3">
          {cfg.cities.map((c) => (
            <div key={c.tz} style={{ width: dialPx + 22 }}>
              <CityClock city={c} now={now} format24={cfg.format24} size={dialPx} accentColor={accentColor} onRemove={() => update({ cities: cfg.cities.filter((x) => x.tz !== c.tz) })} />
            </div>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center gap-2 border-t border-edge pt-2">
        <select value="" data-no-drag onChange={(e) => { if (e.target.value) addCity(e.target.value); e.target.value = ""; }}
          disabled={available.length === 0}
          className="min-w-0 flex-1 rounded border border-edge bg-canvas px-2 py-1 text-[11px] text-fg outline-none disabled:opacity-50">
          <option value="">{available.length ? "+ Add city…" : "All cities added"}</option>
          {available.map((o) => <option key={o.tz} value={o.tz}>{o.label}</option>)}
        </select>
      </div>
    </div>
  );
}
