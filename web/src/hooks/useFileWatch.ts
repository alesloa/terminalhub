import { useEffect, useRef } from "react";
import { getToken } from "../api/client";

export type FileWatchEvent = "changed" | "removed";

/**
 * Subscribe to live disk changes for a single HOST file over /ws/fs-watch. `onEvent` fires with
 * "changed" whenever the file's bytes change on disk (an agent writes to it, an external edit) and
 * "removed" when it's deleted. Pass `path = null` to watch nothing — Drive files have no filesystem
 * to watch, so the editor passes null for them. Reconnects with linear backoff if the socket drops.
 */
export function useFileWatch(path: string | null, onEvent: (event: FileWatchEvent) => void) {
  const cb = useRef(onEvent);
  cb.current = onEvent;

  useEffect(() => {
    if (!path) return;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;
    let closed = false;
    let attempt = 0;

    const connect = () => {
      if (closed) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const tok = getToken();
      ws = new WebSocket(
        `${proto}://${location.host}/ws/fs-watch?path=${encodeURIComponent(path)}${tok ? `&token=${encodeURIComponent(tok)}` : ""}`,
      );
      ws.onopen = () => {
        attempt = 0;
        ping = setInterval(() => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" })); }, 25_000);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "changed") cb.current("changed");
          else if (msg.type === "removed") cb.current("removed");
        } catch { /* ignore malformed frames */ }
      };
      ws.onclose = () => {
        if (ping) { clearInterval(ping); ping = null; }
        if (closed) return;
        attempt++;
        retry = setTimeout(connect, Math.min(1000 * attempt, 5000)); // linear backoff, capped at 5s
      };
    };
    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      if (ping) clearInterval(ping);
      ws?.close();
    };
  }, [path]);
}
