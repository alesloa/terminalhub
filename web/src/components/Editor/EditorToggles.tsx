import { useEffect, useRef, useState, type ReactNode } from "react";
import { useUi } from "../../store/ui";

/** A small pill toggle, shared by the editor tab bar and the diff toolbar (split↔unified). */
export function ToggleBtn({ active, onClick, title, boxed, children }:
  { active: boolean; onClick: () => void; title: string; boxed?: boolean; children: ReactNode }) {
  return (
    <button onClick={onClick} title={title}
      className={`px-2 py-0.5 text-[11px] ${boxed ? "rounded border border-edge" : ""}
        ${active ? "bg-elevated text-bright" : "text-muted hover:bg-surface"}`}>
      {children}
    </button>
  );
}

/**
 * The "⋯" view-options menu for the editor and diff: checkable toggles for the global
 * display prefs (minimap, word wrap, line numbers). Stays open while you flip toggles;
 * closes on an outside click or Escape.
 */
export function EditorToggles() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const minimap = useUi(s => s.minimap);
  const toggleMinimap = useUi(s => s.toggleMinimap);
  const wordWrap = useUi(s => s.wordWrap);
  const toggleWordWrap = useUi(s => s.toggleWordWrap);
  const lineNumbers = useUi(s => s.lineNumbers);
  const toggleLineNumbers = useUi(s => s.toggleLineNumbers);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const items = [
    { label: "Minimap", active: minimap, onClick: toggleMinimap },
    { label: "Word wrap", active: wordWrap, onClick: toggleWordWrap },
    { label: "Line numbers", active: lineNumbers, onClick: toggleLineNumbers },
  ];

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)} title="View options" aria-label="View options"
        className={`px-2 leading-none text-[15px] rounded ${open ? "bg-elevated text-bright" : "text-muted hover:bg-surface"}`}>⋯</button>
      {open && (
        <div className="absolute right-0 mt-1 w-44 bg-panel border border-edge rounded shadow-lg py-1 z-50 text-sm">
          {items.map(it => (
            <button key={it.label} onClick={it.onClick}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-fg hover:bg-elevated">
              <span className="w-4 text-center text-[11px] text-blue-400">{it.active ? "✓" : ""}</span>
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
