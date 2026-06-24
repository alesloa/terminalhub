// Auto-title for a terminal running a Claude session. The session transcript — not the on-screen
// pane — is the source, so the name survives a long/wrapped first prompt the in-pane capture can't
// read. Pure helpers; the detection + transcript read live in routes/claude.ts.

const TITLE_WORDS = 6; // cap a prompt-derived tab name to its first N words

/** First N words (whitespace-collapsed) of a prompt — the way the session browser previews a session
 *  by its opening words rather than the whole message. */
export function firstWords(text: string, max = TITLE_WORDS): string {
  return text.trim().split(/\s+/).filter(Boolean).slice(0, max).join(" ");
}

/** The tab name for a Claude-session terminal: a custom session name verbatim, else the first few
 *  words of the first prompt ("fix the login bug for the") — no agent prefix; the user adds their
 *  own if they want one. Returns null when there's nothing to name it from yet (no prompt sent /
 *  transcript not written). */
export function claudeTerminalTitle(firstPrompt?: string | null, customName?: string | null): string | null {
  const custom = customName?.trim();
  const name = custom || (firstPrompt ? firstWords(firstPrompt) : "");
  return name || null;
}
