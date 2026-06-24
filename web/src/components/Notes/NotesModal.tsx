import { forwardRef, useCallback, useEffect, useImperativeHandle, useState, type CSSProperties, type TransitionEventHandler } from "react";
import type { Note } from "../../api/types";
import type { WinRect } from "../../store/ui";
import { spacesBarBottom } from "../../store/ui";
import { useDraggableWindow, type WindowHandle } from "../../hooks/useDraggableWindow";
import { ResizeHandles } from "../ResizeHandles";
import { DictationButton } from "../DictationButton";
import { useNotes } from "./useNotes";
import { NoteEditor } from "./NoteEditor";

const RECT_KEY = "tr.notesRect"; // remembered window geometry (per-browser)
const MIN_W = 480, MIN_H = 320;  // list pane (256) + a usable editor
const DURATION = 300;            // ms — grow-from-icon / minimize-to-icon animation

/** Display title for a note: its title, else the first non-empty line, else a placeholder. */
function noteTitle(n: Note): string {
  if (n.title.trim()) return n.title.trim();
  const first = n.content.split("\n").find((l) => l.trim());
  return first?.trim() || "Untitled note";
}

function preview(n: Note): string {
  const body = n.content.replace(/\s+/g, " ").trim();
  return body || "No content";
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

/** A moderate notepad-sized box, centered and clamped below the spaces bar. */
function defaultRect(): WinRect {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(820, Math.round(vw * 0.7));
  const h = Math.min(560, Math.round(vh * 0.7));
  const top = spacesBarBottom() + 8;
  return {
    w, h,
    x: Math.max(8, Math.round((vw - w) / 2)),
    y: Math.max(top, Math.round((vh - h) / 2)),
  };
}

/** Restore the saved geometry, clamped back into the current viewport (it may have shrunk). */
function loadRect(): WinRect {
  try {
    const raw = localStorage.getItem(RECT_KEY);
    if (raw) {
      const r = JSON.parse(raw) as Partial<WinRect>;
      if (typeof r.x === "number" && typeof r.y === "number" && typeof r.w === "number" && typeof r.h === "number") {
        const vw = window.innerWidth, vh = window.innerHeight;
        const w = Math.max(MIN_W, Math.min(r.w, vw - 16));
        const h = Math.max(MIN_H, Math.min(r.h, vh - 16));
        return { w, h, x: Math.max(8, Math.min(vw - 80, r.x)), y: Math.max(8, Math.min(vh - 60, r.y)) };
      }
    }
  } catch { /* ignore corrupt/blocked storage */ }
  return defaultRect();
}

/**
 * The Notes scratchpad: a free-floating, draggable, resizable window (NOT a modal — it never dims
 * or blocks the canvas behind it) that stays above the room windows. A history list on the left
 * (newest-edited first) + an editor on the right; edits autosave. Drag the title bar to move,
 * grab the edges/corners to resize; geometry is remembered per-browser. Opening grows the window
 * out of the Notes icon (`origin`); Close minimizes it back into the icon before unmounting.
 */
export const NotesModal = forwardRef<WindowHandle, { origin?: WinRect | null; onClose: () => void }>(function NotesModal({ origin, onClose }, ref) {
  const { notes, isLoading, create, save, remove } = useNotes();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [seed] = useState(loadRect);
  const { rect, beginDrag, beginResize } = useDraggableWindow(seed, MIN_W, MIN_H, undefined, undefined, "notes");

  // Grow-from-icon on open, minimize-to-icon on close — same trick as the room↔card animation.
  // Mount collapsed onto the icon's rect, then flip to full size next frame so the CSS transition
  // fires; closing reverses it and only unmounts (onClose) once the collapse transition ends.
  const reduce = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [expanded, setExpanded] = useState(reduce);
  useEffect(() => {
    if (reduce) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setExpanded(true)));
    return () => cancelAnimationFrame(id);
  }, [reduce]);
  const handleClose = () => { if (reduce) { onClose(); return; } setExpanded(false); };
  // Expose the same minimize-to-icon close to the TopBar Notes icon so a second press collapses it.
  useImperativeHandle(ref, () => ({ close: handleClose }));
  const onTransitionEnd: TransitionEventHandler = (e) => {
    if (e.target === e.currentTarget && e.propertyName === "transform" && !expanded) onClose();
  };

  // Remember the geometry, debounced so a drag/resize doesn't hammer localStorage every frame.
  useEffect(() => {
    const t = window.setTimeout(() => { try { localStorage.setItem(RECT_KEY, JSON.stringify(rect)); } catch { /* blocked */ } }, 300);
    return () => window.clearTimeout(t);
  }, [rect]);

  // The active note's textarea inserter, registered by the mounted NoteEditor — the title-bar mic
  // drops transcribed speech here. Stored via the updater form so a function isn't treated as one.
  const [insert, setInsert] = useState<((text: string) => void) | null>(null);
  const registerInsert = useCallback((fn: ((text: string) => void) | null) => setInsert(() => fn), []);

  // Default to the most-recent note once the list loads, until the user picks one.
  useEffect(() => {
    if (selectedId === null && notes.length) setSelectedId(notes[0].id);
  }, [notes, selectedId]);

  const selected = notes.find((n) => n.id === selectedId) ?? null;

  const newNote = async () => { const n = await create(); setSelectedId(n.id); };
  const del = async (n: Note) => {
    if (!confirm(`Delete "${noteTitle(n)}"?`)) return;
    await remove(n.id);
    if (selectedId === n.id) setSelectedId(notes.find((x) => x.id !== n.id)?.id ?? null);
  };

  // Collapse target: scale down + slide the window's top-left onto the icon's top-left. Falls back
  // to a centered shrink when the opener rect is unknown.
  const collapsed = origin
    ? `translate(${origin.x - rect.x}px, ${origin.y - rect.y}px) scale(${origin.w / rect.w}, ${origin.h / rect.h})`
    : "scale(0.94)";
  const style: CSSProperties = {
    left: rect.x, top: rect.y, width: rect.w, height: rect.h,
    ...(reduce ? {} : {
      transformOrigin: origin ? "0 0" : "50% 50%",
      transform: expanded ? "translate(0px, 0px) scale(1, 1)" : collapsed,
      opacity: expanded ? 1 : 0,
      // Animate transform/opacity only — NOT left/top/width/height — so drag/resize tracks instantly.
      transition: `transform ${DURATION}ms cubic-bezier(.22,.61,.36,1), opacity ${DURATION}ms ease`,
      willChange: "transform, opacity",
    }),
  };

  return (
    <div onTransitionEnd={onTransitionEnd} style={style}
      className="fixed z-50 flex flex-col rounded-lg overflow-hidden border border-edge-strong bg-canvas shadow-2xl">
      {/* Title bar = drag handle. Mirrors the room window chrome: title left, [mic][Close] right
          (no maximize). The control cluster swallows pointer-down so clicking it never starts a drag. */}
      <div onPointerDown={beginDrag}
        className="h-8 shrink-0 flex items-center justify-between px-4 border-b border-edge cursor-move select-none">
        <div className="font-semibold">Notes</div>
        <div className="flex items-center gap-2" onPointerDown={(e) => e.stopPropagation()}>
          <DictationButton onText={(t) => insert?.(t)} enabled={!!insert}
            disabledTitle="Select a note to dictate into" />
          <button onClick={handleClose} title="Close"
            className="px-3 h-6 inline-flex items-center bg-elevated rounded text-sm">Close</button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        <div className="w-64 shrink-0 border-r border-edge flex flex-col">
          <div className="p-2 border-b border-edge">
            <button onClick={newNote} className="w-full py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm">+ New note</button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            {isLoading && <div className="p-4 text-dim text-sm">loading…</div>}
            {!isLoading && notes.length === 0 && (
              <div className="p-4 text-dim text-sm">No notes yet. Hit <span className="text-fg">+ New note</span>.</div>
            )}
            {notes.map((n) => (
              <button key={n.id} onClick={() => setSelectedId(n.id)}
                className={`group w-full text-left px-3 py-2 border-b border-surface ${n.id === selectedId ? "bg-elevated" : "hover:bg-panel"}`}>
                <div className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 truncate text-sm">{noteTitle(n)}</span>
                  <span
                    role="button" tabIndex={0} title="Delete note"
                    onClick={(e) => { e.stopPropagation(); del(n); }}
                    className="shrink-0 opacity-0 group-hover:opacity-100 text-dim hover:text-red-400 leading-none px-1">✕</span>
                </div>
                <div className="truncate text-xs text-dim">{preview(n)}</div>
                <div className="text-[10px] text-dim">{timeAgo(n.updatedAt)}</div>
              </button>
            ))}
          </div>
        </div>

        {selected
          ? <NoteEditor key={selected.id} note={selected} onSave={save} onRegisterInsert={registerInsert} />
          : (
            <div className="flex-1 flex items-center justify-center text-dim text-sm">
              Select a note, or create a new one.
            </div>
          )}
      </div>

      <ResizeHandles onStart={beginResize} />
    </div>
  );
});
