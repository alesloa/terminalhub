import { useEffect, useRef, useState } from "react";

/** In-pane find bar (right-click "Find…" / Cmd-F). Drives tmux copy-mode search over the FULL
 *  scrollback server-side — the match is highlighted in the live pane, not here. Enter jumps to the
 *  next match upward (older, closest above the prompt); Shift+Enter or the ↓ button steps back down
 *  toward the present; Esc closes and snaps the pane back to live. No match count — tmux's search
 *  doesn't report one; it just jumps the highlight. */
export function TerminalFindBar({ onSearch, onClose }: {
  onSearch: (query: string, direction: "up" | "down") => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const go = (direction: "up" | "down") => { const q = query.trim(); if (q) onSearch(q, direction); };

  return (
    // Stop pointer events reaching the pane (its onPointerDown focuses xterm, which would yank focus
    // out of this input). Top-center, faint chrome that matches the floating zoom/buffer controls.
    <div onPointerDown={(e) => e.stopPropagation()}
      className="absolute top-2 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 rounded-md border border-edge bg-panel shadow-lg px-1.5 py-1 text-sm">
      <input ref={inputRef} value={query} spellCheck={false} placeholder="Find in scrollback"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); go(e.shiftKey ? "down" : "up"); }
          else if (e.key === "Escape") { e.preventDefault(); onClose(); }
        }}
        className="w-48 bg-canvas border border-edge rounded px-2 py-0.5 outline-none focus:border-accent" />
      <button onClick={() => go("up")} title="Previous match (older)"
        className="px-1.5 h-6 inline-flex items-center rounded text-muted hover:text-bright hover:bg-elevated">↑</button>
      <button onClick={() => go("down")} title="Next match (newer)"
        className="px-1.5 h-6 inline-flex items-center rounded text-muted hover:text-bright hover:bg-elevated">↓</button>
      <button onClick={onClose} title="Close (Esc)"
        className="px-1.5 h-6 inline-flex items-center rounded text-dim hover:text-bright hover:bg-elevated">✕</button>
    </div>
  );
}
