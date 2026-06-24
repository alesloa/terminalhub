import { useEffect, useRef, useState } from "react";
import { copilotSocketUrl } from "../../api/client";
import type { CopilotFrame } from "../../api/types";

// Thin wrapper over the /ws/copilot stream. It owns the socket lifecycle and exposes send/confirm;
// the chat component handles incoming frames (via onFrame) and assembles the transcript itself. The
// onFrame callback is kept in a ref so re-renders don't churn the socket.
export function useCopilotSocket(onFrame: (f: CopilotFrame) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    let closed = false;
    const ws = new WebSocket(copilotSocketUrl());
    wsRef.current = ws;
    ws.onopen = () => { if (!closed) setConnected(true); };
    ws.onclose = () => { if (!closed) setConnected(false); };
    ws.onmessage = (e) => { try { onFrameRef.current(JSON.parse(e.data) as CopilotFrame); } catch { /* ignore non-JSON */ } };
    return () => { closed = true; try { ws.close(); } catch { /* already closing */ } };
  }, []);

  const sendRaw = (obj: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  };

  return {
    connected,
    send: (conversationId: string, text: string) => sendRaw({ type: "send", conversationId, text }),
    confirm: (callId: string, approved: boolean) => sendRaw({ type: "confirm", callId, approved }),
  };
}
