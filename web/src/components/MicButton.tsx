import { useRoom } from "../store/room";
import { useUi } from "../store/ui";
import { DictationButton } from "./DictationButton";

/**
 * Dictation control for the room top bar. Records from the mic and injects the transcribed text
 * into the room's active terminal at the cursor (the user presses Enter). The mic engine and the
 * click-vs-hold behavior are configured in Settings → Speech-to-Text. Recording/transcription
 * lives in useDictation (shared with the Notes mic); this just wires the sink to the active
 * terminal's input sender.
 *
 * Only the focused room (top of the z-stack) arms the keyboard shortcut, so the combo always
 * dictates into the room you're actually looking at.
 */
export function MicButton() {
  const terminalSender = useRoom((s) => s.terminalSender);
  const workspaceId = useRoom((s) => s.workspaceId);
  const focused = useUi((s) => {
    if (s.openRooms.length === 0) return false;
    const top = s.openRooms.reduce((m, r) => Math.max(m, r.z), 0);
    return s.openRooms.some((r) => r.workspaceId === workspaceId && r.z === top);
  });
  return (
    <DictationButton
      onText={(text) => terminalSender?.(text)}
      enabled={!!terminalSender}
      disabledTitle="Focus a terminal to dictate into"
      hotkeyEnabled={focused}
    />
  );
}
