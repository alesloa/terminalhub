// Settings tab + control icons — pure presentational SVGs, extracted from SettingsModal to keep that
// file under the size limit. No props except EyeIcon's show/hide state.

// Eye when hidden (click to reveal); eye with a slash when shown (click to hide).
export function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}

export function PaletteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2.5a9.5 9.5 0 1 0 0 19c1.2 0 2-.9 2-2 0-.6-.25-1.1-.6-1.5-.35-.4-.6-.9-.6-1.5 0-1.1.9-2 2-2h1.7A4.3 4.3 0 0 0 21.5 9 9.5 9.5 0 0 0 12 2.5Z" />
      <circle cx="7.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="16.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function CodeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m8 7-5 5 5 5" />
      <path d="m16 7 5 5-5 5" />
    </svg>
  );
}

// Terminal window with a prompt caret + cursor line — the Terminal tab.
export function TerminalIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3" />
      <path d="M13 15h4" />
    </svg>
  );
}

export function SpeakerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 6a9 9 0 0 1 0 12" />
    </svg>
  );
}

// Speech bubble with lines — the Agent Prompts tab.
export function ChatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.6-.8L3 21l1.8-5.4A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5Z" />
      <path d="M8.5 10.5h7" />
      <path d="M8.5 13.5h4" />
    </svg>
  );
}

// Four-point spark — the Copilot tab.
export function SparkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3z" />
    </svg>
  );
}

export function KeyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="7.5" cy="15.5" r="3.5" />
      <path d="m10 13 9-9" />
      <path d="m15.5 7.5 2.5 2.5" />
      <path d="m18 4 2.5 2.5" />
    </svg>
  );
}

// Two-pin plug — the Connections tab (external accounts like Google Drive).
export function PlugIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 2v5M15 2v5" />
      <path d="M7 7h10v3a5 5 0 0 1-10 0V7Z" />
      <path d="M12 15v7" />
    </svg>
  );
}
