import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { searchCodicons } from "../lib/codicons";

interface Props {
  current: string | null;                 // icon currently assigned to the terminal (highlighted)
  onPick: (name: string | null) => void;  // a codicon name, or null to reset to the default glyph
  onClose: () => void;
}

/** VS Code-style icon picker: a search box over a scrollable grid of every codicon. Portaled to
 *  <body> so position:fixed is viewport-relative (the Room has a transform that would otherwise
 *  become the containing block). Click a glyph to assign it; Esc or a backdrop click cancels. */
export function IconPicker({ current, onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchCodicons(query), [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80]" onMouseDown={onClose}>
      <div className="bg-panel border border-edge rounded-lg shadow-2xl w-[420px] p-3 flex flex-col gap-3"
        onMouseDown={(e) => e.stopPropagation()}>
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search icons" spellCheck={false} autoComplete="off"
          className="w-full px-3 py-2 bg-elevated border border-accent rounded text-sm outline-none" />

        <div className="grid grid-cols-10 gap-1 max-h-[320px] overflow-auto pr-1">
          {/* reset-to-default tile, kept first like VS Code's currently-selected slot */}
          <button title="Default (terminal glyph)" onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(null)}
            className={`aspect-square flex items-center justify-center rounded hover:bg-elevated text-muted
              ${current == null ? "bg-elevated ring-1 ring-accent text-bright" : ""}`}>
            <span className="codicon codicon-terminal text-base" aria-hidden />
          </button>
          {results.map((c) => (
            <button key={c.name} title={c.name} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(c.name)}
              className={`aspect-square flex items-center justify-center rounded hover:bg-elevated text-fg
                ${current === c.name ? "bg-elevated ring-1 ring-accent" : ""}`}>
              <span className={`codicon codicon-${c.name} text-base`} aria-hidden />
            </button>
          ))}
          {results.length === 0 && (
            <div className="col-span-10 py-6 text-center text-sm text-muted">No icons match "{query}"</div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
