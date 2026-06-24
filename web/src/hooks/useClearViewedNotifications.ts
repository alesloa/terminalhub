import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { AppNotification } from "../api/types";
import { useToasts } from "../store/toasts";
import { isTabActive } from "../lib/tabActive";
import { useUi } from "../store/ui";

/**
 * Call once at the app root. When you're actually in a terminal (its xterm pane holds focus — the green
 * bar — in this browser AND the tab is on-screen and focused), clear anything queued about it: cancel a
 * still-pending toast so it never archives, and remove entries that already reached the notification
 * center. So clicking into — or coming back to — a terminal you were alerted about resolves it
 * automatically, not only by clicking/✕.
 *
 * Re-runs when the focused pane changes and on `focus`/`visibilitychange`: returning from another macOS
 * Space, another app, or a background tab clears whatever piled up for the terminal you're focused in.
 * Guarded on what's actually waiting (a toast for it, or a cached center entry) so a plain switch with
 * nothing pending = no request. Mirrors the pane-focus rule the notification fire/suppress paths use.
 */
export function useClearViewedNotifications(): void {
  const terminalId = useUi((s) => s.focusedTerminalId);
  const qc = useQueryClient();

  useEffect(() => {
    const clearViewed = () => {
      if (!terminalId || !isTabActive()) return; // only when you're truly in it
      // A toast for this terminal is still on screen → you're seeing it now: cancel its server-side
      // pending timer so it won't land in the center after the grace window lapses.
      for (const t of useToasts.getState().toasts) {
        if (t.terminalId === terminalId && t.notifId) api.notifications.dismissPending(t.notifId).catch(() => {});
      }
      // Anything that already persisted to the center for it → remove it (server broadcasts the sync).
      const data = qc.getQueryData<{ notifications: AppNotification[] }>(["notifications"]);
      if (data?.notifications.some((n) => n.terminalId === terminalId)) {
        api.notifications.clearTerminal(terminalId).catch(() => {});
      }
    };

    clearViewed(); // focused pane changed (or mounted) while in it → clear now

    // Regaining focus/visibility means you're back in whatever pane holds focus — treat it as a view.
    window.addEventListener("focus", clearViewed);
    document.addEventListener("visibilitychange", clearViewed);
    return () => {
      window.removeEventListener("focus", clearViewed);
      document.removeEventListener("visibilitychange", clearViewed);
    };
  }, [terminalId, qc]);
}
