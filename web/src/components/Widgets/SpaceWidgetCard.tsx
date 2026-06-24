import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { SpaceWidget } from "../../api/types";
import { useUi, rectOf, itemKey, type WinRect } from "../../store/ui";
import type { WindowHandle } from "../../hooks/useDraggableWindow";
import { widgetDef, renderWidgetBody, renderWidgetSettings } from "./registry";
import { WidgetSettingsWindow } from "./WidgetSettingsWindow";

const MIN_W = 200, MIN_H = 140;

/** One widget placed on the canvas. Drag by the title bar, resize from the corner — both use direct
 *  viewport pointer math and persist on release, exactly like a sticky note. The body renders the
 *  live widget for this `kind`. */
export function SpaceWidgetCard({ widget, save, remove, zoom }: {
  widget: SpaceWidget;
  save: (id: string, patch: Partial<{ x: number; y: number; w: number; h: number; config: Record<string, unknown> | null }>) => void;
  remove: (id: string) => void;
  zoom: number; // its space's canvas zoom (the world layer scales the card; drag/resize deltas ÷ this)
}) {
  const def = widgetDef(widget.kind);
  const [box, setBox] = useState({ x: widget.x, y: widget.y, w: widget.w, h: widget.h });
  // Canvas multi-select: selection ring + riding the shared group-drag delta (its own title-bar drag
  // is suppressed for that gesture by CanvasSelection).
  const selKey = itemKey("widget", widget.id);
  const selected = useUi(s => s.selection.has(selKey));
  const gd = useUi(s => (s.groupDrag && s.selection.has(selKey)) ? s.groupDrag : null);
  // `zoom` (the card's space canvas zoom) arrives as a prop now: the world layer in SpaceWidgetsLayer
  // applies the scale, so the card no longer scales itself. Drag/resize deltas are screen px, so they
  // divide by zoom to map back into the (scaled) world the card now lives in.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsOrigin, setSettingsOrigin] = useState<WinRect | null>(null);
  const settingsWin = useRef<WindowHandle>(null);
  // Transient settings preview: the settings window overlays a partial config here (no save) so an
  // accent/background/zoom drag shows live on the widget; commit persists and clears it.
  const [previewConfig, setPreviewConfig] = useState<Record<string, unknown> | null>(null);
  const interacting = useRef(false);
  // The config the body actually renders from: the live preview if one's in flight, else the saved row.
  const effectiveConfig = previewConfig ?? widget.config;
  // A widget may set its body background via `config.background` (e.g. the world clock sits directly on
  // it). Widgets that paint their own inner container instead (the meters' rounded screen) opt out via
  // `selfBackground`, so the card's outer frame/padding stays the default and only the inner box recolors.
  // A fresh instance with no saved background falls back to the widget's `defaultBackground` (the world
  // clock ships dark `#111110`); widgets without one fall through to the card's panel color.
  const bg = def.selfBackground
    ? undefined
    : effectiveConfig && typeof effectiveConfig.background === "string"
      ? effectiveConfig.background
      : def.defaultBackground;

  // Re-sync from the server row when we're not mid-drag (e.g. another tab moved it). useLayoutEffect so
  // a group-drag drop (moves us via cache patch while clearing the shared transform) lands at the new
  // spot in the same paint — no one-frame flash back to the old position.
  useLayoutEffect(() => {
    if (!interacting.current) setBox({ x: widget.x, y: widget.y, w: widget.w, h: widget.h });
  }, [widget.x, widget.y, widget.w, widget.h]);

  // A group drag moves this card via a shared transform (`gd`); on drop CanvasSelection clears `gd`
  // and writes the new position to the query cache. But that cache write takes ~50ms to propagate
  // back as a re-render, while `gd` clears instantly — so for those few frames the card snaps to its
  // pre-drag spot (the "blink back to the old position" on a multi-select drop). Bake the final delta
  // into `box` the instant `gd` clears — same frame the transform is removed — so the card never shows
  // the old spot. Same clamp as CanvasSelection.commitGroupMove, so the slower patch lands identical.
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

  const beginDrag = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, input, textarea, select, [data-no-drag]")) return;
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
      save(widget.id, { x: cur.x, y: cur.y });
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
      save(widget.id, { w: cur.w, h: cur.h });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // The world layer (SpaceWidgetsLayer) applies the zoom scale now, so the card no longer scales itself.
  // Here we only carry a group-drag translate: gd is screen px and we live inside that scaled layer, so
  // divide by zoom — it renders back ×zoom to the exact distance the cursor moved (matches DraggableCard).
  const xform = gd ? `translate3d(${gd.dx / zoom}px, ${gd.dy / zoom}px, 0)` : "";

  return (
    <div data-canvas-item="" data-item-key={selKey}
      style={{
        position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h,
        ...(xform ? { transform: xform, transformOrigin: "0 0" } : null),
        ...(selected ? { outline: "2px solid rgb(var(--tr-info) / 0.4)", outlineOffset: "2px" } : null),
      }}
      className="pointer-events-auto flex flex-col rounded-lg border border-edge bg-panel shadow-2xl overflow-hidden">
      <div onPointerDown={beginDrag}
        className="flex items-center justify-between gap-1 px-2 h-7 shrink-0 cursor-move border-b border-edge bg-elevated/60">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-dim shrink-0">{def.icon}</span>
          <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted">{def.label}</span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {def.hasSettings && (
            <button data-no-drag title="Settings"
              onClick={(e) => {
                if (settingsOpen) { settingsWin.current?.close(); return; } // second press minimizes back into the gear
                setSettingsOrigin(rectOf(e.currentTarget));
                setSettingsOpen(true);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className={`w-5 h-5 grid place-items-center rounded hover:bg-edge ${settingsOpen ? "text-bright" : "text-dim hover:text-bright"}`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          )}
          <button data-no-drag title="Remove widget" onClick={() => remove(widget.id)} onPointerDown={(e) => e.stopPropagation()}
            className="w-5 h-5 grid place-items-center rounded text-dim hover:text-error hover:bg-edge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-2.5" style={bg ? { backgroundColor: bg } : undefined}>
        {renderWidgetBody(widget.kind, {
          config: effectiveConfig,
          onConfigChange: (c) => save(widget.id, { config: c }),
        })}
      </div>
      <div onPointerDown={beginResize} title="Resize" className="absolute bottom-0 right-0 w-5 h-5 grid place-items-center cursor-se-resize text-dim">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="opacity-60 pointer-events-none"><path d="M11 4 4 11M11 8 8 11" /></svg>
      </div>

      {settingsOpen && (
        <WidgetSettingsWindow ref={settingsWin} title={`${def.label} settings`} origin={settingsOrigin}
          onClose={() => { setSettingsOpen(false); setPreviewConfig(null); }}>
          {/* Each settings body owns its full content including the Background row (see
              renderWidgetSettings). Reads use `effectiveConfig` so a control (e.g. the size slider)
              tracks its own live preview instead of snapping back to the saved value mid-drag; preview
              overlays a transient patch (no save), commit persists it merged over the saved row, and
              clearPreview drops a dangling preview when a color popover is dismissed mid-drag. */}
          {renderWidgetSettings(widget.kind, {
            config: effectiveConfig,
            preview: (patch) => setPreviewConfig({ ...(widget.config ?? {}), ...patch }),
            commit: (patch) => { save(widget.id, { config: { ...(widget.config ?? {}), ...patch } }); setPreviewConfig(null); },
            clearPreview: () => setPreviewConfig(null),
          })}
        </WidgetSettingsWindow>
      )}
    </div>
  );
}
