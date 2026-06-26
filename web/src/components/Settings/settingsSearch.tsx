import { useMemo, useRef, useState } from "react";

// Settings are getting big, so a search box lets you jump straight to a setting by name. This is the
// canonical index: each entry maps a human label (+ synonyms) to the tab it lives on and the
// `data-setting-id` anchor the modal scrolls to and flashes. Entries whose anchor isn't rendered
// (settings that live inside child components like Copilot/Google Drive) still switch to the right
// tab — the scroll just no-ops. KEEP IN SYNC with the rows in SettingsModal + TerminalAppearance.

export type TabId = "appearance" | "editor" | "terminal" | "voice" | "copilot" | "connections" | "access";

export const TAB_LABELS: Record<TabId, string> = {
  appearance: "Appearance",
  editor: "Editor",
  terminal: "Terminal",
  voice: "Voice & Speech",
  copilot: "Copilot",
  connections: "Connections",
  access: "Remote Access",
};

export interface SettingEntry { label: string; tab: TabId; id: string; keywords?: string }

export const SETTINGS_INDEX: SettingEntry[] = [
  // Appearance
  { label: "Theme", tab: "appearance", id: "theme", keywords: "color scheme dark light palette" },
  { label: "Canvas background", tab: "appearance", id: "canvas-background", keywords: "wallpaper backdrop" },
  { label: "Activity Bar Position", tab: "appearance", id: "activity-bar-position", keywords: "sidebar explorer view switcher" },
  { label: "Spaces switcher", tab: "appearance", id: "spaces-switcher", keywords: "virtual spaces bar home" },
  { label: "System stats", tab: "appearance", id: "system-stats", keywords: "cpu ram network bottom bar" },
  { label: "Active windows", tab: "appearance", id: "active-windows", keywords: "taskbar open rooms pills" },
  { label: "Stage Manager", tab: "appearance", id: "stage-enable", keywords: "dock previews enable" },
  { label: "Stage Manager dock position", tab: "appearance", id: "stage-position", keywords: "edge left right bottom" },
  { label: "Stage Manager dock size", tab: "appearance", id: "stage-size", keywords: "scale" },
  { label: "Stage Manager default mode", tab: "appearance", id: "stage-mode", keywords: "spotlight all-open" },
  // Editor
  { label: "Auto Save", tab: "editor", id: "auto-save", keywords: "files save" },
  { label: "Auto-save delay", tab: "editor", id: "auto-save-delay", keywords: "seconds" },
  { label: "Word Wrap", tab: "editor", id: "word-wrap", keywords: "lines wrap" },
  { label: "Minimap", tab: "editor", id: "minimap", keywords: "code overview" },
  { label: "Line Numbers", tab: "editor", id: "line-numbers", keywords: "gutter" },
  { label: "Split Diff View", tab: "editor", id: "split-diff", keywords: "side by side inline" },
  { label: "Better Comments", tab: "editor", id: "better-comments", keywords: "tagged colors todo" },
  // Terminal
  { label: "Focus bar color", tab: "terminal", id: "focus-bar-color", keywords: "glow input bar green" },
  { label: "Status bar text color", tab: "terminal", id: "status-bar-color", keywords: "tmux status" },
  { label: "Terminal font family", tab: "terminal", id: "term-font-family", keywords: "typeface monospace nerd font meslo jetbrains fira cascadia" },
  { label: "Terminal font size", tab: "terminal", id: "term-font-size", keywords: "text size zoom" },
  { label: "Terminal font weight", tab: "terminal", id: "term-font-weight", keywords: "bold light medium thickness" },
  { label: "Terminal line height", tab: "terminal", id: "term-line-height", keywords: "row spacing leading" },
  { label: "Terminal letter spacing", tab: "terminal", id: "term-letter-spacing", keywords: "tracking character gap" },
  { label: "Terminal padding", tab: "terminal", id: "term-padding", keywords: "margin space grid inset" },
  { label: "Terminal scrollback", tab: "terminal", id: "term-scrollback", keywords: "history buffer lines" },
  { label: "Terminal ligatures", tab: "terminal", id: "term-ligatures", keywords: "fira code fuse glyphs arrows" },
  { label: "Terminal text brightness", tab: "terminal", id: "term-text-brightness", keywords: "dim foreground contrast" },
  { label: "Terminal background", tab: "terminal", id: "term-background", keywords: "lift black gray" },
  // Voice & Speech
  { label: "Quiet window", tab: "voice", id: "quiet-window", keywords: "silence seconds finished attention bell notify" },
  { label: "Toast position", tab: "voice", id: "toast-position", keywords: "notification popup placement" },
  { label: "Voice announcements", tab: "voice", id: "voice-announcements", keywords: "speak aloud tts" },
  { label: "Notification voice", tab: "voice", id: "notification-voice", keywords: "system voice" },
  { label: "Voice speed", tab: "voice", id: "voice-speed", keywords: "rate" },
  { label: "Voice volume", tab: "voice", id: "voice-volume", keywords: "loudness" },
  { label: "Speak agent messages", tab: "voice", id: "speak-agent", keywords: "read aloud" },
  { label: "Chime before speaking", tab: "voice", id: "chime", keywords: "beep sound" },
  { label: "Mic button mode", tab: "voice", id: "stt-mic-mode", keywords: "toggle hold dictation" },
  { label: "Mic button position", tab: "voice", id: "mic-position", keywords: "top bottom" },
  { label: "Mic shortcut mode", tab: "voice", id: "mic-shortcut-mode", keywords: "toggle hold" },
  { label: "Mic shortcut", tab: "voice", id: "mic-shortcut", keywords: "hotkey dictation key" },
  { label: "Mic activation sound", tab: "voice", id: "mic-sound", keywords: "blip" },
  { label: "Speech-to-text engine", tab: "voice", id: "stt-engine", keywords: "whisper openai local transcribe" },
  { label: "OpenAI API key", tab: "voice", id: "openai-key", keywords: "transcription secret" },
  { label: "OpenAI model", tab: "voice", id: "openai-model", keywords: "transcribe whisper" },
  { label: "Pushover", tab: "voice", id: "pushover", keywords: "phone push reminders" },
  // Copilot / Connections / Access
  { label: "Copilot", tab: "copilot", id: "copilot", keywords: "skills mcp tools engine" },
  { label: "Google Drive", tab: "connections", id: "google-drive", keywords: "account connection" },
  { label: "Access token", tab: "access", id: "access-token", keywords: "remote tunnel cloudflare auth" },
];

/** A search box that filters SETTINGS_INDEX and, on pick, calls onJump(tab, id). Arrow keys move the
 *  highlight, Enter picks it, Escape clears. Lives at the top of the Settings left nav. */
export function SettingsSearch({ onJump }: { onJump: (tab: TabId, id: string) => void }) {
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const terms = q.split(/\s+/);
    return SETTINGS_INDEX
      .filter((e) => {
        const hay = `${e.label} ${TAB_LABELS[e.tab]} ${e.keywords ?? ""}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      })
      .slice(0, 8);
  }, [query]);

  const pick = (entry: SettingEntry | undefined) => {
    if (!entry) return;
    onJump(entry.tab, entry.id);
    setQuery("");
    setHi(0);
    inputRef.current?.blur();
  };

  return (
    <div className="relative mb-1">
      <svg className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dim" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        value={query}
        placeholder="Search settings…"
        onChange={(e) => { setQuery(e.target.value); setHi(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); pick(results[hi]); }
          else if (e.key === "Escape") { e.preventDefault(); setQuery(""); }
        }}
        className="w-full rounded-md border border-edge-strong bg-canvas py-1.5 pl-7 pr-2 text-xs text-bright outline-none placeholder:text-dim focus:border-blue-500"
      />
      {results.length > 0 && (
        <ul className="absolute left-0 top-full z-30 mt-1 max-h-72 w-72 overflow-auto rounded-md border border-edge-strong bg-elevated py-1 shadow-2xl">
          {results.map((e, i) => (
            <li key={`${e.tab}:${e.id}`}>
              <button
                type="button"
                // mousedown (not click) so the pick fires before the input's blur tears the list down.
                onMouseDown={(ev) => { ev.preventDefault(); pick(e); }}
                onMouseEnter={() => setHi(i)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs ${i === hi ? "bg-surface text-bright" : "text-fg hover:bg-surface/60"}`}>
                <span className="truncate">{e.label}</span>
                <span className="shrink-0 rounded bg-canvas px-1.5 py-0.5 text-[10px] text-dim">{TAB_LABELS[e.tab]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim() && results.length === 0 && (
        <div className="absolute left-0 top-full z-30 mt-1 w-72 rounded-md border border-edge-strong bg-elevated px-3 py-2 text-xs text-dim shadow-2xl">
          No settings match “{query.trim()}”.
        </div>
      )}
    </div>
  );
}
