import type { ReactNode } from "react";

// Shared Settings control primitives — extracted from SettingsModal so the modal and the per-tab
// section components (TerminalAppearance, …) render identical controls without duplicating styles.
// Row and Toggle take an optional `id` that becomes a `data-setting-id` anchor the search box scrolls
// to and flashes (see Settings/settingsSearch + the .tr-setting-flash rule in theme.css).

/** Titled group of controls — small uppercase header, then evenly spaced rows. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs uppercase tracking-wide text-dim">{title}</h2>
      {children}
    </section>
  );
}

/** A label/hint on the left, a control on the right — the workhorse settings row. */
export function Row({ id, title, hint, children }: { id?: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <div data-setting-id={id} className="flex items-center justify-between gap-4 rounded">
      <div className="min-w-0">
        <div className="text-fg">{title}</div>
        {hint && <div className="text-xs text-dim">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

export function Toggle({ id, title, hint, checked, onChange }: { id?: string; title: string; hint: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label data-setting-id={id} className="flex items-center justify-between gap-4 rounded">
      <span>
        <span className="block text-fg">{title}</span>
        <span className="block text-xs text-dim">{hint}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-blue-500"
      />
    </label>
  );
}

export function Segment({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button onClick={onClick}
      className={`min-w-12 rounded px-2 py-1 text-xs ${active ? "bg-edge-strong text-bright" : "text-dim hover:text-fg"}`}>
      {children}
    </button>
  );
}

/** −/+ stepper with a centered value readout, for clamped numeric prefs that apply live (1 per click). */
export function Stepper({ value, min, max, suffix, onChange }: { value: number; min: number; max: number; suffix?: string; onChange: (n: number) => void }) {
  const btn = "flex h-7 w-7 items-center justify-center rounded text-base leading-none text-muted hover:bg-surface hover:text-bright disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    <div className="flex items-center gap-1 rounded border border-edge-strong bg-canvas p-0.5">
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label="Decrease" className={btn}>−</button>
      <span className="w-12 text-center text-sm tabular-nums text-bright">{value}{suffix ? ` ${suffix}` : ""}</span>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="Increase" className={btn}>+</button>
    </div>
  );
}

/** A swatch + hex readout for a color pref that applies live as you pick. Native color input (hex
 *  only — no alpha), styled to match the dark surfaces. Value must be a 6-digit hex for the swatch. */
export function ColorField({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-xs tabular-nums text-muted">{value.toUpperCase()}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Pick color"
        className="h-7 w-10 cursor-pointer rounded border border-edge-strong bg-canvas p-0.5"
      />
    </div>
  );
}

/** A range slider with a right-aligned % readout, for clamped prefs that apply live as you drag. */
export function Slider({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input type="range" min={min} max={max} step={1} value={value}
        onChange={(e) => onChange(Number(e.target.value))} className="w-40 accent-blue-500" />
      <span className="w-9 text-right tabular-nums text-xs text-muted">{value}%</span>
    </div>
  );
}

/** A range slider with a custom-formatted readout + step, for live numeric prefs that aren't percent
 *  (line height, letter spacing, padding…). `format` turns the raw value into the readout text. */
export function Range({ value, min, max, step = 1, format, onChange }: {
  value: number; min: number; max: number; step?: number; format: (n: number) => string; onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} className="w-40 accent-blue-500" />
      <span className="w-12 text-right tabular-nums text-xs text-muted">{format(value)}</span>
    </div>
  );
}

/** A dark-styled native <select> for enum prefs that apply live. */
export function Select<T extends string | number>({ value, options, onChange }: {
  value: T; options: { label: string; value: T }[]; onChange: (v: T) => void;
}) {
  return (
    <select
      value={String(value)}
      onChange={(e) => {
        const raw = e.target.value;
        const picked = options.find((o) => String(o.value) === raw);
        if (picked) onChange(picked.value);
      }}
      className="w-44 rounded border border-edge-strong bg-canvas px-2 py-1 text-bright outline-none focus:border-blue-500">
      {options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
    </select>
  );
}

export function Code({ children }: { children: string }) {
  return <code className="rounded bg-canvas px-1 py-0.5 font-mono text-[11px] text-fg">{children}</code>;
}
