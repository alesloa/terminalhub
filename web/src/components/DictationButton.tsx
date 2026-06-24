import { useDictation } from "../hooks/useDictation";
import { useDictationHotkey } from "../hooks/useDictationHotkey";
import { useUi } from "../store/ui";
import { formatHotkey } from "../lib/hotkey";

/**
 * Mic button: records from the microphone and feeds the transcribed text to `onText`. When
 * `enabled` is false it's greyed out and shows `disabledTitle` (e.g. nothing focused to type into).
 * The recording/transcription behavior (engine, click-vs-hold) lives in useDictation.
 *
 * `hotkeyEnabled` arms the global keyboard shortcut for this instance — set it true only for the
 * focused room's mic so several open rooms don't all toggle at once.
 */
export function DictationButton({ onText, enabled, disabledTitle, hotkeyEnabled = false }: {
  onText: (text: string) => void; enabled: boolean; disabledTitle: string; hotkeyEnabled?: boolean;
}) {
  const { recording, busy, micMode, onClick, onHoldStart, onHoldEnd, toggle, holdStart, holdEnd } = useDictation(onText, enabled);
  const hotkey = useUi((s) => s.dictationHotkey);
  const hotkeyMode = useUi((s) => s.dictationHotkeyMode);
  useDictationHotkey({
    enabled: hotkeyEnabled && enabled,
    mode: hotkeyMode,
    onToggle: toggle,
    onHoldStart: holdStart,
    onHoldEnd: holdEnd,
  });

  const shortcut = hotkeyEnabled && hotkey.code ? ` (${formatHotkey(hotkey)})` : ""; // hide when unbound
  const title = !enabled
    ? disabledTitle
    : recording
    ? (micMode === "hold" ? "Release to transcribe" : "Stop and transcribe") + shortcut
    : (micMode === "hold" ? "Hold to dictate (speech to text)" : "Dictate (speech to text)") + shortcut;

  return (
    <button
      onClick={onClick}
      onPointerDown={onHoldStart}
      onPointerUp={onHoldEnd}
      onPointerCancel={onHoldEnd}
      disabled={!enabled}
      title={title}
      className={`w-7 h-6 flex items-center justify-center rounded leading-none disabled:opacity-40 ${
        recording ? "bg-red-600 text-white tr-blink" : busy ? "bg-elevated text-blue-300" : "peacock-btn text-fg"
      }`}>
      {busy ? <span className="w-3.5 h-3.5 rounded-full border-2 border-blue-300/40 border-t-blue-300 animate-spin" /> : <MicIcon />}
    </button>
  );
}

function MicIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="21" />
      <line x1="8" y1="21" x2="16" y2="21" />
    </svg>
  );
}
