import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Terminal, TerminalMode } from "../api/types";
import { useUi } from "../store/ui";

// Base hues across the spectrum (lime, orange, teal, etc.). The lightness slider
// shades whichever one you pick. Stored as hex so the label tint stays a plain color.
const HUES: { name: string; h: number }[] = [
  { name: "Red", h: 0 }, { name: "Orange", h: 25 }, { name: "Yellow", h: 50 }, { name: "Lime", h: 82 },
  { name: "Green", h: 140 }, { name: "Emerald", h: 160 }, { name: "Teal", h: 178 }, { name: "Cyan", h: 192 },
  { name: "Sky", h: 205 }, { name: "Blue", h: 222 }, { name: "Indigo", h: 245 }, { name: "Violet", h: 268 },
  { name: "Purple", h: 285 }, { name: "Fuchsia", h: 312 }, { name: "Pink", h: 335 },
];
const SAT = 75, L_MIN = 28, L_MAX = 82, L_DEFAULT = 55;
// Workspace/Peacock pickers let the slider reach much darker shades (deep, near-black
// tints for the room chrome). Terminal text labels keep the higher L_MIN floor so a tab
// label can't be dragged down to an unreadable near-black on the dark background.
export const WS_L_MIN = 10;
// Widget colors (accent, background, meter rings, sticky notes) drag all the way down to a true
// near-black — these are decorative fills, not text, so there's no readability floor to protect.
export const WIDGET_L_MIN = 3;

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}
function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const int = parseInt(m[1], 16);
  const r = ((int >> 16) & 255) / 255, g = ((int >> 8) & 255) / 255, b = (int & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = h * 60; if (h < 0) h += 360;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

interface Props {
  anchor: { x: number; y: number }; // the cursor position at right-click
  term: Terminal;
  index: number;
  terminals: Terminal[];
  onRename: (t: Terminal) => void;
  onChangeIcon: (t: Terminal) => void;
  onColor: (id: string, color: string | null) => void;
  onClose: (ids: string[]) => void;
  onForkSession?: (t: Terminal) => void; // clone the Claude session running in this terminal
  onSetMode?: (t: Terminal, mode: TerminalMode) => void; // flip between the xterm pane and the GUI chat
  dismiss: () => void;
}

const MENU_W = 224, MENU_H = 320, FLYOUT_W = 176; // MENU_H = first-paint estimate; real height is measured

/** Native-replacing right-click menu for a terminal tab. Opens at the cursor (like any context
 *  menu), clamped into the viewport so it never hangs off an edge; the Text Color flyout flips to
 *  the left when a right-side one would overflow. */
export function TerminalContextMenu({ anchor, term, index, terminals, onRename, onChangeIcon, onColor, onClose, onForkSession, onSetMode, dismiss }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [menuH, setMenuH] = useState(MENU_H);
  const [colorOpen, setColorOpen] = useState(false);
  // The menu's height shifts with the Fork item's presence; measure the real height after layout and
  // re-clamp the top from it so a click low in the viewport can't push the bottom rows off-screen.
  useLayoutEffect(() => { if (ref.current) setMenuH(ref.current.offsetHeight); }, []);
  const setPreviewColor = useUi((s) => s.setPreviewColor);
  const clearPreviewColor = useUi((s) => s.clearPreviewColor);
  // Drop any live preview if the menu unmounts mid-drag (commit normally clears it on release).
  useEffect(() => () => clearPreviewColor(term.id), [clearPreviewColor, term.id]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) dismiss(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    // Defer the outside-click listener by a frame so the right-click gesture that
    // opened the menu can't immediately close it. No window-"blur" dismiss: it fires
    // spuriously when the OS or an extension overlay (e.g. Claude-in-Chrome) steals
    // focus, yanking the menu away mid-hover.
    const raf = requestAnimationFrame(() => window.addEventListener("mousedown", onDown));
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [dismiss]);

  const ids = terminals.map((t) => t.id);
  const others = ids.filter((id) => id !== term.id);
  const above = ids.slice(0, index);
  const below = ids.slice(index + 1);

  const run = (fn: () => void) => { fn(); dismiss(); };

  // Open at the cursor, clamped into the viewport — if it'd hang off the right edge it slides left,
  // off the bottom it slides up (measured height). No flip-beside-the-row: a context menu belongs
  // under the pointer.
  const left = Math.max(8, Math.min(anchor.x, window.innerWidth - MENU_W - 8));
  const top = Math.max(8, Math.min(anchor.y, window.innerHeight - menuH - 8));
  // Color picker flyout opens to the right of the menu, flipping left only when a right-side one
  // would overflow the viewport.
  const flipLeft = left + MENU_W + FLYOUT_W + 8 > window.innerWidth;
  const flyoutSide = flipLeft ? "right-full mr-1" : "left-full ml-1";

  // Portal to <body> so position:fixed is viewport-relative — the Room has a transform
  // (open/close animation) which would otherwise become the containing block and shove
  // the menu off-screen.
  return createPortal(
    <div ref={ref} style={{ position: "fixed", left, top, zIndex: 70 }}
      className="w-56 py-1 rounded-lg border border-edge bg-panel shadow-2xl text-sm text-fg select-none">
      <Item label="Rename Terminal" onClick={() => run(() => onRename(term))} />
      <Item label="Change Icon" onClick={() => run(() => onChangeIcon(term))} />

      <div className="relative">
        <Item label="Text Color" submenu active={colorOpen} onClick={() => setColorOpen((o) => !o)} />
        {colorOpen && (
          <div className={`absolute ${flyoutSide} top-0`}>
            <ColorPicker current={term.color ?? null}
              onPreview={(c) => setPreviewColor(term.id, c)} onPick={(c) => onColor(term.id, c)} />
          </div>
        )}
      </div>

      {/* Agent-session group. "Open in GUI Chat" swaps this terminal's pane for the in-app Claude
          chat (and back); both surfaces continue the same conversation. */}
      {(onSetMode || onForkSession) && <Sep />}
      {onSetMode && (
        <Item label={term.mode === "gui" ? "Back to Terminal" : "Open in GUI Chat"}
          onClick={() => run(() => onSetMode(term, term.mode === "gui" ? "tmux" : "gui"))} />
      )}
      {onForkSession && <Item label="Fork Agent Session" onClick={() => run(() => onForkSession(term))} />}

      <Sep />
      <Item label="Close" onClick={() => run(() => onClose([term.id]))} />
      <Item label="Close Others" hint="⌥⌘T" disabled={others.length === 0} onClick={() => run(() => onClose(others))} />
      <Sep />
      <Item label="Close Above" hint="⌘K E" disabled={above.length === 0} onClick={() => run(() => onClose(above))} />
      <Item label="Close Below" hint="⌘K T" disabled={below.length === 0} onClick={() => run(() => onClose(below))} />
      <Sep />
      <Item label="Close All" hint="⌘K W" disabled={ids.length === 0} onClick={() => run(() => onClose(ids))} />
    </div>,
    document.body,
  );
}

/** Grid of base hues + a lightness slider that shades the selected one.
 *  `defaultColor`: when set, the "no color" swatch previews that fallback hue (workspaces
 *  fall back to the default blue accent) instead of the text-color "A" glyph.
 *  `onPreview`: called on every slider move (and on hue/default select) with the live color, so
 *  the target can track the drag in real time without a server round-trip. `onPick` is the commit
 *  (fires on release) that actually persists. Pickers without `onPreview` just commit on release.
 *  `allowNeutral`: adds a gray swatch (saturation 0) so the slider can shade a true neutral — used
 *  for backgrounds, where "make it darker" should land on near-black, not a tinted blue.
 *  All internal state (hue/light/saturation/no-color) seeds from `current` on mount, so a picker
 *  that's re-mounted each time it opens (the swatch popover does this) always starts on the live
 *  value — the slider darkens *that* color instead of a stale default hue. */
export function ColorPicker({ current, onPick, onPreview, defaultColor, minLight = L_MIN, allowNeutral = false }: {
  current: string | null; onPick: (color: string | null) => void; onPreview?: (color: string | null) => void;
  defaultColor?: string; minLight?: number; allowNeutral?: boolean;
}) {
  const init = current ? hexToHsl(current) : null;
  const [hue, setHue] = useState(init?.h ?? 222);
  const [light, setLight] = useState(init?.l ?? L_DEFAULT);
  // Saturation is fixed at SAT for hues; the neutral swatch drops it to 0. Seed it from the current
  // color so re-opening on a gray starts neutral (the slider keeps shading gray, not snapping to blue).
  const [sat, setSat] = useState(init && init.s < 18 ? 0 : SAT);
  const [noColor, setNoColor] = useState(current == null);

  // Hue/neutral/default are discrete commits — onPick's optimistic write already paints instantly, so
  // they don't go through the preview path (keeps them working even if a preview handler is unavailable).
  const pickHue = (h: number) => { setHue(h); setSat(SAT); setNoColor(false); onPick(hslToHex(h, SAT, light)); };
  const pickNeutral = () => { setSat(0); setNoColor(false); onPick(hslToHex(hue, 0, light)); };
  const pickDefault = () => { setNoColor(true); onPick(null); };
  // While dragging, stream the live shade to onPreview (no persist); on release, commit it via
  // onPick. Always a shade of the current hue/saturation — even from "no color" — so it's never stuck.
  const preview = (l: number) => { setLight(l); setNoColor(false); onPreview?.(hslToHex(hue, sat, l)); };
  const commit = (l: number) => { setLight(l); setNoColor(false); onPick(hslToHex(hue, sat, l)); };
  const neutralSelected = !noColor && sat === 0;

  return (
    <div className="w-44 p-2 rounded-lg border border-edge bg-panel shadow-2xl">
      <div className="grid grid-cols-4 gap-2">
        <button title={defaultColor ? "Default" : "Default (no color)"} onClick={pickDefault}
          className={`w-7 h-7 rounded flex items-center justify-center border ${noColor ? "border-white" : "border-edge-strong"}`}
          style={defaultColor ? { background: defaultColor } : undefined}>
          {!defaultColor && <span className="text-[10px] text-muted">A</span>}
        </button>
        {allowNeutral && (
          <button title="Neutral gray" onClick={pickNeutral}
            className={`w-7 h-7 rounded border ${neutralSelected ? "border-white" : "border-transparent"}`}
            style={{ background: hslToHex(0, 0, light) }} />
        )}
        {HUES.map((c) => {
          const selected = !noColor && sat > 0 && Math.abs(hue - c.h) < 8;
          return (
            <button key={c.name} title={c.name} onClick={() => pickHue(c.h)}
              className={`w-7 h-7 rounded border ${selected ? "border-white" : "border-transparent"}`}
              style={{ background: hslToHex(c.h, SAT, light) }} />
          );
        })}
      </div>
      <input type="range" min={minLight} max={L_MAX} value={light}
        onChange={(e) => preview(Number(e.target.value))}
        onPointerUp={() => commit(light)}
        onKeyUp={() => commit(light)}
        className="tr-light-slider w-full mt-3"
        style={{ background: `linear-gradient(to right, ${hslToHex(hue, sat, minLight)}, ${hslToHex(hue, sat, L_MAX)})` }} />
    </div>
  );
}

export function Item({ label, hint, disabled, submenu, active, danger, onClick }: {
  label: string; hint?: string; disabled?: boolean; submenu?: boolean; active?: boolean; danger?: boolean; onClick?: () => void;
}) {
  return (
    <button disabled={disabled} onClick={onClick}
      className={`w-full px-3 py-1.5 flex items-center justify-between gap-6 text-left
        disabled:opacity-30 disabled:hover:bg-transparent
        ${danger ? "text-red-300 hover:bg-[#3a1d2a]" : "hover:bg-elevated"} ${active ? "bg-elevated" : ""}`}>
      <span>{label}</span>
      {hint && <span className="text-xs text-dim">{hint}</span>}
      {submenu && <span className="text-xs text-dim">▸</span>}
    </button>
  );
}

export function Sep() {
  return <div className="my-1 h-px bg-edge" />;
}
