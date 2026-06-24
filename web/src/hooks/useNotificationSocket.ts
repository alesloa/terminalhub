import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, getToken } from "../api/client";
import { useToasts } from "../store/toasts";
import { useUi } from "../store/ui";
import { useGoToTerminal } from "./useGoToTerminal";
import { isTabActive } from "../lib/tabActive";
import { speak, beep, speechSupported } from "../lib/speech";

/**
 * The dashboard's single notification renderer. Every notification (a coding agent's /api/notify, a
 * fired reminder, and an agent that rang the bell — all fired server-side now) arrives over
 * /ws/notifications and is shown here as a clickable toast, chimed/spoken when enabled, and surfaced
 * as an OS notification when the tab is hidden. The matching control frames keep every open browser
 * in sync: `removed` drops the toast + refreshes the center; `changed` just refreshes the center.
 *
 * Only a *visible* tab speaks/beeps, so several open dashboards don't all talk over each other.
 * Reconnects with linear backoff if the socket drops (mirrors useClaudeActivity).
 */
export function useNotificationSocket(): void {
  const push = useToasts((s) => s.push);
  const qc = useQueryClient();
  // Kept in a ref so the OS-notification click can deep-link without re-opening the socket each render.
  const goTo = useGoToTerminal();
  const goToRef = useRef(goTo);
  goToRef.current = goTo;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let attempt = 0;
    const refreshCenter = () => qc.invalidateQueries({ queryKey: ["notifications"] });

    const connect = () => {
      if (closed) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const tok = getToken();
      ws = new WebSocket(`${proto}://${location.host}/ws/notifications${tok ? `?token=${encodeURIComponent(tok)}` : ""}`);
      ws.onopen = () => { attempt = 0; };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);

          // Sync frames: another browser (or the attention watcher) dismissed/cleared something.
          if (msg.type === "removed") { useToasts.getState().dismissByNotif(msg.id); refreshCenter(); return; }
          if (msg.type === "changed") { refreshCenter(); return; }
          if (msg.type !== "notification") return;

          const isAttention = msg.source === "attention";
          const tabActive = isTabActive();
          // "Actually in this terminal" = its pane holds xterm focus (the green bar) in THIS browser AND
          // this tab is on-screen/focused. Anything else — another room/space/tab/app, minimized, or you
          // just clicked off the pane — counts as away, so a finishing agent still alerts you. This is
          // the SAME pane-focus rule the bell uses on the sending side (useTerminalSocket), so the fire
          // and suppress decisions can't disagree.
          const activelyViewing = !!msg.terminalId && useUi.getState().focusedTerminalId === msg.terminalId && tabActive;

          // An agent finished a terminal you're actively watching = seen → don't toast, and resolve the
          // pending entry so it never reaches the center. Other sources still toast while you're in there.
          if (isAttention && activelyViewing) { api.notifications.dismissPending(msg.id).catch(() => {}); return; }

          // A reminder is persisted the instant it fires (a scheduled event is always recorded), so
          // refresh the center now. Agent notifications stay pending — they only hit the center if you
          // ignore them, and the server sends a "changed" frame then.
          if (msg.source === "reminder") refreshCenter();

          // Show the toast. Attention carries no toast level → amber accent (its long-standing look).
          // notifId is attached only for agent notifications, so dismissing/clicking the toast deletes
          // that row (handled) — a reminder stays durable history regardless of its transient toast.
          push(msg.text, {
            title: msg.title,
            level: isAttention ? undefined : msg.level,
            notifId: msg.source === "reminder" ? undefined : msg.id,
            workspaceId: msg.workspaceId,
            terminalId: msg.terminalId,
            imageUrl: msg.imageUrl,
          });

          // Read settings at fire time (not via subscription) so changes don't re-open the socket.
          const ui = useUi.getState();
          const visible = typeof document === "undefined" || document.visibilityState === "visible";

          // OS notification whenever you're away from this tab — hidden, minimized, on another macOS
          // Space, or behind another app (visible but unfocused) — so you catch a finished agent
          // off-screen. Clicking it focuses the window and jumps to the terminal that fired it.
          if (typeof Notification !== "undefined" && Notification.permission === "granted" && !tabActive) {
            const osn = new Notification(msg.title || "Terminal Hub", { body: msg.text });
            osn.onclick = () => { window.focus(); goToRef.current(msg.workspaceId, msg.terminalId); osn.close(); };
          }

          if (isAttention) {
            // Attention announcements use the "voice alerts" setting (and never read out a terminal
            // you're actively watching — but do speak when you're away on another space or app).
            if (ui.voiceAlerts && !activelyViewing && speechSupported()) {
              speak(`${msg.title || "A terminal"} needs attention`, ui.voiceName || undefined, ui.voiceRate, ui.voiceVolume);
            }
          } else if (msg.speak && ui.speakAgentMessages && visible) {
            if (ui.beepBeforeSpeak) beep();
            if (speechSupported()) {
              // The agent's chosen voice if it picked one from the pool; otherwise your notification voice.
              const say = () => speak(msg.text, msg.voice || ui.voiceName || undefined, ui.voiceRate, ui.voiceVolume);
              if (ui.beepBeforeSpeak) setTimeout(say, 280); // let the chime finish first
              else say();
            }
          }
        } catch { /* ignore malformed frames */ }
      };
      ws.onclose = () => {
        if (closed) return;
        attempt++;
        retry = setTimeout(connect, Math.min(1000 * attempt, 5000)); // linear backoff, capped at 5s
      };
    };
    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, [push, qc]);
}
