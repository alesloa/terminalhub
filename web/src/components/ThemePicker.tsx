import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useUi } from "../store/ui";
import { THEMES, getTheme } from "../theme/themes";
import type { Theme } from "../theme/tokens";

// Display order: the Dark group first, then Light, each preserving roster order. Arrow-key
// navigation walks this flat list (the Dark/Light headers are labels only, never focus stops).
const ORDER: Theme[] = [...THEMES.filter((t) => t.type === "dark"), ...THEMES.filter((t) => t.type === "light")];
const indexOf = (id: string) => { const i = ORDER.findIndex((t) => t.id === id); return i < 0 ? 0 : i; };

/**
 * Theme dropdown with **live preview while you scroll**. Opening remembers the persisted theme;
 * Arrow ↑/↓ (or mouse hover) moves the highlight and immediately calls setTheme() so the whole
 * app — chrome and terminals — recolors in real time, WITHOUT committing. Enter or click commits
 * (persists to settings); Escape or click-away reverts to the theme that was active on open.
 *
 * Reused by the TopBar (button trigger) and the Settings modal (`inline` renders the list open,
 * with no trigger button).
 */
export function ThemePicker({ align = "right", inline = false }: { align?: "left" | "right"; inline?: boolean }) {
  const themeId = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const qc = useQueryClient();
  const persist = useMutation({
    mutationFn: (id: string) => api.updateSettings({ theme: id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });

  const [open, setOpen] = useState(inline);
  // Theme active when the menu opened — what Escape / click-away reverts to. Also the row that
  // shows the ✓ (the committed choice), so you can tell it apart from the one you're previewing.
  const committedRef = useRef(themeId);
  const [highlight, setHighlight] = useState(() => indexOf(themeId));
  const highlightRef = useRef(highlight); // mirror so the keydown handler reads it without re-binding
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const setHi = (i: number) => { highlightRef.current = i; setHighlight(i); };
  const preview = (i: number) => { setHi(i); setTheme(ORDER[i].id); };          // live, no persist
  const commit = (i: number) => { setTheme(ORDER[i].id); persist.mutate(ORDER[i].id); committedRef.current = ORDER[i].id; if (!inline) setOpen(false); };
  const cancel = () => { setTheme(committedRef.current); setOpen(false); };

  const openMenu = () => { committedRef.current = themeId; setHi(indexOf(themeId)); setOpen(true); };

  // Keep the highlighted row in view as it moves.
  useEffect(() => { if (open) itemRefs.current[highlight]?.scrollIntoView({ block: "nearest" }); }, [highlight, open]);

  // ↑/↓ move + live-preview, Enter commits, Esc reverts (dropdown only). preventDefault on the
  // arrows so the page never scrolls and focus stays put — the core of the keyboard UX. Structural
  // event type so the same fn serves the window listener (dropdown) and onKeyDown (inline list).
  const onKeyNav = (e: { key: string; preventDefault: () => void }) => {
    if (e.key === "ArrowDown") { e.preventDefault(); preview(Math.min(ORDER.length - 1, highlightRef.current + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); preview(Math.max(0, highlightRef.current - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); commit(highlightRef.current); }
    else if (e.key === "Escape" && !inline) { e.preventDefault(); cancel(); }
  };

  // Dropdown mode: capture keys globally + revert on outside-click. Inline (Settings) mode instead
  // binds keys to the focused list container (below), so arrow keys in other Settings fields aren't
  // hijacked and the modal owns Escape/close.
  useEffect(() => {
    if (inline || !open) return;
    const onKey = (e: KeyboardEvent) => onKeyNav(e);
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) cancel(); };
    window.addEventListener("keydown", onKey);
    const raf = requestAnimationFrame(() => window.addEventListener("mousedown", onDown));
    return () => { window.removeEventListener("keydown", onKey); cancelAnimationFrame(raf); window.removeEventListener("mousedown", onDown); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, inline]);

  const list = (
    <div className={inline
      ? "max-h-72 overflow-auto rounded-lg border border-edge bg-code py-1"
      : `absolute z-50 mt-1 ${align === "right" ? "right-0" : "left-0"} w-60 max-h-80 overflow-auto rounded-lg border border-edge bg-panel shadow-2xl py-1`}>
      {ORDER.map((t, i) => {
        const darkHeader = i === 0;
        const lightHeader = t.type === "light" && ORDER[i - 1]?.type === "dark";
        return (
          <Fragment key={t.id}>
            {darkHeader && <SectionLabel>Dark</SectionLabel>}
            {lightHeader && <SectionLabel>Light</SectionLabel>}
            <button
              ref={(el) => { itemRefs.current[i] = el; }}
              onMouseEnter={() => preview(i)}
              onClick={() => commit(i)}
              className={`w-full px-2.5 py-1.5 flex items-center gap-2.5 text-left text-sm ${i === highlight ? "bg-elevated text-bright" : "text-fg hover:bg-elevated"}`}>
              <Swatch theme={t} />
              <span className="flex-1 truncate">{t.name}</span>
              {t.id === committedRef.current && <Check />}
            </button>
          </Fragment>
        );
      })}
    </div>
  );

  if (inline) return (
    <div ref={rootRef} tabIndex={0} onKeyDown={onKeyNav} className="outline-none rounded-lg focus:ring-1 focus:ring-accent/60">
      {list}
    </div>
  );

  return (
    <div ref={rootRef} className="relative">
      <button onClick={() => (open ? cancel() : openMenu())} title="Theme"
        className="h-8 px-2 inline-flex items-center gap-1.5 rounded bg-elevated hover:bg-edge text-fg hover:text-bright text-sm">
        <PaletteIcon />
        <span className="max-w-28 truncate">{getTheme(themeId).name}</span>
        <Chevron />
      </button>
      {open && list}
    </div>
  );
}

/** A compact preview of a theme's actual colors (its own literal hex, not the active vars). */
function Swatch({ theme }: { theme: Theme }) {
  const chips = [theme.tokens.accent, theme.ansi.green, theme.ansi.yellow, theme.ansi.red, theme.ansi.blue];
  return (
    <span className="flex shrink-0 rounded-sm overflow-hidden ring-1 ring-black/40" style={{ background: theme.tokens.bg }}>
      {chips.map((c, i) => <span key={i} className="w-1.5 h-4" style={{ background: c }} />)}
    </span>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="px-2.5 pt-1.5 pb-1 text-[10px] uppercase tracking-wider text-dim">{children}</div>;
}

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-accent" aria-hidden="true">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function PaletteIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2.5a9.5 9.5 0 1 0 0 19c1.2 0 2-.9 2-2 0-.6-.25-1.1-.6-1.5-.35-.4-.6-.9-.6-1.5 0-1.1.9-2 2-2h1.7A4.3 4.3 0 0 0 21.5 9 9.5 9.5 0 0 0 12 2.5Z" />
      <circle cx="7.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="16.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
