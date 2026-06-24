import type { Transport } from "@codemirror/lsp-client";
import { getToken } from "../../api/client";

export interface LspTransport extends Transport {
  close(): void;
}

// Server-side WS close codes that are PERMANENT — never reconnect against them.
const CLOSE_NO_SERVER = 4404; // no / uninstalled language server for this language
const CLOSE_UNAUTHORIZED = 1008;

/** A WebSocket Transport for `@codemirror/lsp-client`: raw JSON-RPC strings in/out over
 *  `/ws/lsp/:workspaceId/:languageId`. Buffers sends until the socket opens and reconnects with
 *  exponential backoff (so a tunnel blip recovers), except on the permanent close codes above. */
export function createLspTransport(workspaceId: string, languageId: string): LspTransport {
  const handlers = new Set<(value: string) => void>();
  const outbox: string[] = [];
  let ws: WebSocket | null = null;
  let stopped = false;
  let retry = 0;

  const url = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const tok = getToken();
    return `${proto}://${location.host}/ws/lsp/${encodeURIComponent(workspaceId)}/${encodeURIComponent(languageId)}`
      + (tok ? `?token=${encodeURIComponent(tok)}` : "");
  };

  const open = () => {
    if (stopped) return;
    const sock = new WebSocket(url());
    ws = sock;
    sock.onopen = () => { retry = 0; for (const m of outbox.splice(0)) sock.send(m); };
    sock.onmessage = (e) => {
      const data = typeof e.data === "string" ? e.data : "";
      if (data) for (const h of [...handlers]) h(data);
    };
    sock.onclose = (e) => {
      if (ws === sock) ws = null;
      if (stopped || e.code === CLOSE_NO_SERVER || e.code === CLOSE_UNAUTHORIZED) return;
      const delay = Math.min(500 * 2 ** retry++, 15000);
      setTimeout(open, delay);
    };
    sock.onerror = () => { try { sock.close(); } catch { /* onclose drives the retry */ } };
  };
  open();

  return {
    send(message: string) {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(message);
      else outbox.push(message); // flushed on next open
    },
    subscribe(handler) { handlers.add(handler); },
    unsubscribe(handler) { handlers.delete(handler); },
    close() {
      stopped = true;
      try { ws?.close(); } catch { /* already closed */ }
      ws = null;
      handlers.clear();
      outbox.length = 0;
    },
  };
}
