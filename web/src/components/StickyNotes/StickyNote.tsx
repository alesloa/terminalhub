import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { StickyNote as Note, Space } from "../../api/types";
import { useUi, itemKey } from "../../store/ui";
import { ColorPicker, Item, WIDGET_L_MIN } from "../TerminalContextMenu";
import { createPortal } from "react-dom";

export const NOTE_W = 240;
export const NOTE_H = 200;
const MIN_W = 160, MIN_H = 120;
// A new note's default look (no custom color): a dark, theme-matching post-it. The title strip is a
// hair lighter than the body. Picking a color from the swatch tints the whole note instead.
export const STICKY_BODY = "#141414";
export const STICKY_TITLE = "#1c1c1c";

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
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s, l };
}
function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

// Text/ink harmonized with the fill instead of flat black/white: a deep "burnt" shade of the same
// hue on light fills, a pale tint of it on dark fills. A desaturated fill (the default near-black
// note) stays neutral gray, so the hue only colors the text when the note itself is colored.
function inkFor(bg: string): string {
  const hsl = hexToHsl(bg);
  if (!hsl) return "#f5f5f5";
  const { h, s, l } = hsl;
  return l >= 0.55 ? hslToHex(h, Math.min(1, s), 0.16) : hslToHex(h, Math.min(0.85, s * 0.9), 0.9);
}

type Save = (id: string, patch: Partial<Pick<Note, "spaceId" | "content" | "color" | "x" | "y" | "w" | "h" | "pinned">>) => void;

/** One floating post-it: drag by the header, recolor with the shared workspace picker, pin it above
 *  open rooms, resize from the corner, delete with ✕, right-click the header to send it to another
 *  space. Geometry/content round-trip on release/idle. */
export function StickyNote({ note, spaces, save, remove, zoom }: { note: Note; spaces: Space[]; save: Save; remove: (id: string) => void; zoom: number }) {
  const setPreviewColor = useUi((s) => s.setPreviewColor);
  const clearPreviewColor = useUi((s) => s.clearPreviewColor);
  const preview = useUi((s) => s.previewColors[note.id]);

  const [box, setBox] = useState({ x: note.x, y: note.y, w: note.w, h: note.h });
  // Canvas multi-select: a selection ring + riding the shared group-drag delta (its own header drag is
  // suppressed for that gesture by CanvasSelection).
  const selKey = itemKey("note", note.id);
  const selected = useUi(s => s.selection.has(selKey));
  const gd = useUi(s => (s.groupDrag && s.selection.has(selKey)) ? s.groupDrag : null);
  // `zoom` (the note's space canvas zoom) arrives as a prop now: the world layer in StickyNotesLayer
  // applies the scale, so the note no longer scales itself. Drag/resize deltas are screen px, so they
  // divide by zoom to map back into the (scaled) world the note now lives in.
  const interacting = useRef(false);
  // Resync from the server row whenever it changes and we're not mid-drag/resize. useLayoutEffect (not
  // useEffect) so a group-drag drop — which moves us via cache patch while clearing the shared transform
  // — lands at the new spot in the same paint, with no one-frame flash back to the old position.
  useLayoutEffect(() => {
    if (!interacting.current) setBox({ x: note.x, y: note.y, w: note.w, h: note.h });
  }, [note.x, note.y, note.w, note.h]);

  // Same as SpaceWidgetCard: a group drag moves the note via a shared transform (`gd`) that clears
  // instantly on drop, while the new position arrives via the query cache ~50ms later — so the note
  // would blink back to its pre-drag spot for those frames. Bake the final delta into box the instant
  // `gd` clears, same frame the transform drops. Same clamp as CanvasSelection.commitGroupMove.
  const lastGd = useRef<{ dx: number; dy: number } | null>(null);
  useLayoutEffect(() => {
    if (gd) { lastGd.current = gd; return; }
    const d = lastGd.current;
    if (!d) return;
    lastGd.current = null;
    // Raw world coords, no clamp (a board citizen, like a card). The group-drag delta is screen px, so
    // divide by zoom. Same math as CanvasSelection.commitGroupMove, so the slower cache patch lands here.
    setBox((b) => ({ ...b, x: b.x + d.dx / zoom, y: b.y + d.dy / zoom }));
  }, [gd, zoom]);

  const [text, setText] = useState(note.content);
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setText(note.content); }, [note.content]);
  const debounce = useRef<number | undefined>(undefined);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPos, setPickerPos] = useState({ left: 0, top: 0 });
  const colorWrap = useRef<HTMLDivElement>(null);
  const pickerPop = useRef<HTMLDivElement>(null); // the portaled popover (lives in <body>, not the note)
  const closePicker = () => { setPickerOpen(false); clearPreviewColor(note.id); };
  const openPicker = () => {
    // Anchor the popover to the palette button and portal it to <body> so it pops OUT of the note —
    // the note (and its live color) stays visible instead of being covered by the picker.
    const b = colorWrap.current?.getBoundingClientRect();
    if (b) {
      const left = Math.min(Math.max(8, b.left), window.innerWidth - 192);
      let top = b.bottom + 6;
      if (top + 150 > window.innerHeight - 8) top = Math.max(8, b.top - 150 - 6); // flip above if no room
      setPickerPos({ left, top });
    }
    setPickerOpen(true);
  };
  useEffect(() => () => clearPreviewColor(note.id), [clearPreviewColor, note.id]); // drop any live preview on unmount
  // Click anywhere outside the button or the (portaled) popover closes it (and drops the live preview),
  // like the workspace picker — so the slider can be dragged across shades without it snapping shut.
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (colorWrap.current?.contains(t) || pickerPop.current?.contains(t)) return;
      closePicker();
    };
    const raf = requestAnimationFrame(() => window.addEventListener("mousedown", onDown));
    return () => { cancelAnimationFrame(raf); window.removeEventListener("mousedown", onDown); };
  }, [pickerOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  // preview (slider drag) wins; else the saved color; else null = the dark default note.
  const fill = preview !== undefined ? preview : note.color;
  const body = fill ?? STICKY_BODY;
  // A custom fill darkens the title with a translucent wash; the default uses the explicit title hue.
  const titleBg = fill ? "rgba(0,0,0,0.12)" : STICKY_TITLE;
  const ink = inkFor(body);

  const beginDrag = (e: ReactPointerEvent) => {
    if (e.button !== 0) return; // left-drag only — right-click opens the move menu
    if ((e.target as HTMLElement).closest("button, input, textarea, [data-no-drag]")) return;
    e.preventDefault();
    interacting.current = true;
    const start = { px: e.clientX, py: e.clientY, x: box.x, y: box.y };
    let cur = { ...box };
    const onMove = (ev: PointerEvent) => {
      // World coords, no clamp (free placement like a card). Pointer delta is screen px → ÷ zoom.
      const x = start.x + (ev.clientX - start.px) / zoom;
      const y = start.y + (ev.clientY - start.py) / zoom;
      cur = { ...cur, x, y };
      setBox((b) => ({ ...b, x, y }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      interacting.current = false;
      save(note.id, { x: cur.x, y: cur.y });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const beginResize = (e: ReactPointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    interacting.current = true;
    const start = { px: e.clientX, py: e.clientY, w: box.w, h: box.h };
    let cur = { ...box };
    const onMove = (ev: PointerEvent) => {
      const w = Math.max(MIN_W, start.w + (ev.clientX - start.px) / zoom);
      const h = Math.max(MIN_H, start.h + (ev.clientY - start.py) / zoom);
      cur = { ...cur, w, h };
      setBox((b) => ({ ...b, w, h }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      interacting.current = false;
      save(note.id, { w: cur.w, h: cur.h });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onText = (v: string) => {
    editing.current = true;
    setText(v);
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => save(note.id, { content: v }), 400);
  };
  const flush = () => {
    editing.current = false;
    window.clearTimeout(debounce.current);
    if (text !== note.content) save(note.id, { content: text });
  };

  // The world layer (StickyNotesLayer) applies the zoom scale now, so the note no longer scales itself.
  // Here we only carry a group-drag translate: gd is screen px and we live inside that scaled layer, so
  // divide by zoom — it renders back ×zoom to the exact distance the cursor moved (matches DraggableCard).
  const xform = gd ? `translate3d(${gd.dx / zoom}px, ${gd.dy / zoom}px, 0)` : "";

  return (
    <div
      data-canvas-item="" data-item-key={selKey}
      style={{
        position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, background: body, color: ink,
        ...(xform ? { transform: xform, transformOrigin: "0 0" } : null),
        ...(selected ? { outline: "2px solid rgb(var(--tr-info) / 0.4)", outlineOffset: "2px" } : null),
      }}
      className="pointer-events-auto flex flex-col rounded-lg shadow-2xl ring-1 ring-black/15 overflow-hidden">
      {/* Header = drag handle + controls; right-click sends the note to another space */}
      <div onPointerDown={beginDrag} onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
        className="relative flex items-center justify-between gap-1 px-1.5 h-7 shrink-0 cursor-move"
        style={{ background: titleBg }}>
        <div className="flex items-center gap-0.5" onPointerDown={(e) => e.stopPropagation()}>
          {/* Color */}
          <div ref={colorWrap} className="relative">
            <button data-no-drag title="Change color" onClick={() => (pickerOpen ? closePicker() : openPicker())}
              className="w-5 h-5 grid place-items-center rounded hover:bg-black/10" style={{ color: ink }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="13.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="10.5" r="2.5" /><circle cx="8.5" cy="7.5" r="2.5" /><circle cx="6.5" cy="12.5" r="2.5" />
                <path d="M12 2a10 10 0 1 0 0 20 2.5 2.5 0 0 0 2-4 2.5 2.5 0 0 1 2-4h2a4 4 0 0 0 4-4 10 10 0 0 0-12-8z" />
              </svg>
            </button>
            {pickerOpen && createPortal(
              <div ref={pickerPop} data-no-drag onPointerDown={(e) => e.stopPropagation()}
                style={{ position: "fixed", left: pickerPos.left, top: pickerPos.top, zIndex: 80 }}>
                <ColorPicker current={note.color} defaultColor={STICKY_BODY} minLight={WIDGET_L_MIN} allowNeutral
                  onPreview={(c) => setPreviewColor(note.id, c)}
                  onPick={(c) => { save(note.id, { color: c }); clearPreviewColor(note.id); }} />
              </div>,
              document.body,
            )}
          </div>
          {/* Always on top */}
          <button data-no-drag title={note.pinned ? "Unpin (stop floating above rooms)" : "Keep always on top"}
            onClick={() => save(note.id, { pinned: !note.pinned })}
            className={`w-5 h-5 grid place-items-center rounded hover:bg-black/10 ${note.pinned ? "" : "opacity-50"}`} style={{ color: ink }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill={note.pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 17v5" /><path d="M9 10.76V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v5.76l2 3.24H7l2-3.24z" />
            </svg>
          </button>
        </div>
        {/* Delete */}
        <button data-no-drag title="Delete note" onClick={() => remove(note.id)} onPointerDown={(e) => e.stopPropagation()}
          className="w-5 h-5 grid place-items-center rounded hover:bg-black/15" style={{ color: ink }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => onText(e.target.value)}
        onFocus={() => { editing.current = true; }}
        onBlur={flush}
        placeholder="Jot a note…"
        spellCheck={false}
        className="flex-1 min-h-0 w-full resize-none bg-transparent px-2.5 py-2 text-sm leading-snug outline-none placeholder:opacity-40"
        style={{ color: ink }} />

      {/* Resize grip (bottom-right) — diagonal lines tinted by the ink so they read on any fill */}
      <div onPointerDown={beginResize} title="Resize" className="absolute bottom-0 right-0 w-5 h-5 grid place-items-center cursor-se-resize">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
          className="opacity-60 pointer-events-none" style={{ color: ink }}>
          <path d="M11 4 4 11M11 8 8 11" />
        </svg>
      </div>

      {menu && <MoveMenu anchor={menu} spaces={spaces} currentSpaceId={note.spaceId}
        onMove={(spaceId) => save(note.id, { spaceId })} dismiss={() => setMenu(null)} />}
    </div>
  );
}

/** Right-click menu on a note's header: send it to another space (or just dismiss). Portals to
 *  <body> and matches the workspace card's "Move to space" list, using the shared Item rows. */
function MoveMenu({ anchor, spaces, currentSpaceId, onMove, dismiss }: {
  anchor: { x: number; y: number }; spaces: Space[]; currentSpaceId: string | null;
  onMove: (spaceId: string) => void; dismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) dismiss(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    const raf = requestAnimationFrame(() => window.addEventListener("mousedown", onDown));
    window.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [dismiss]);

  const W = 192, H = 40 + spaces.length * 32;
  const left = Math.max(8, Math.min(anchor.x, window.innerWidth - W - 8));
  const top = Math.max(8, Math.min(anchor.y, window.innerHeight - H - 8));

  return createPortal(
    <div ref={ref} onPointerDown={(e) => e.stopPropagation()} style={{ position: "fixed", left, top, zIndex: 70 }}
      className="w-48 py-1 rounded-lg border border-edge bg-panel shadow-2xl text-sm text-fg select-none">
      <div className="px-3 py-1 text-xs text-dim">Send to space</div>
      {spaces.length <= 1 && <div className="px-3 py-1.5 text-dim">No other spaces</div>}
      {spaces.map((s) => (
        <Item key={s.id} label={s.name} disabled={s.id === currentSpaceId}
          onClick={() => { onMove(s.id); dismiss(); }} />
      ))}
    </div>,
    document.body,
  );
}
