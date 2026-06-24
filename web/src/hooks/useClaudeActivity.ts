import { useEffect, useState } from "react";
import { getToken } from "../api/client";
import type { SessionActivityState } from "../api/types";

/**
 * Subscribe to live per-session activity for a project over /ws/claude-activity. The server
 * pushes the full state map on connect and again whenever it changes. Returns the latest map;
 * a missing session id means "idle". Reconnects with backoff if the socket drops.
 */
export function useClaudeActivity(projectPath: string): Record<string, SessionActivityState> {
  const [states, setStates] = useState<Record<string, SessionActivityState>>({});

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let attempt = 0;

    const connect = () => {
      if (closed) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const tok = getToken();
      ws = new WebSocket(
        `${proto}://${location.host}/ws/claude-activity?path=${encodeURIComponent(projectPath)}${tok ? `&token=${encodeURIComponent(tok)}` : ""}`,
      );
      ws.onopen = () => { attempt = 0; };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "activity" && msg.states) setStates(msg.states);
        } catch {
          // ignore malformed frames
        }
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
  }, [projectPath]);

  return states;
}
