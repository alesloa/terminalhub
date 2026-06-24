import { LSPClient } from "@codemirror/lsp-client";
import { createLspTransport, type LspTransport } from "./transport";
import { pathToFileUri } from "./uri";

// One LSPClient per (workspace, languageId), shared across every editor of that language — so the
// server sees a single client session and the WS maps 1:1 to one child process. Refcounted by the
// editors using it; disposal is deferred so flipping between two files of the same language (or
// React StrictMode's mount/unmount/mount) doesn't tear down and respawn the language server.
interface Entry { client: LSPClient; transport: LspTransport; refs: number; disposeTimer?: number }

const DISPOSE_GRACE_MS = 30_000;
const cache = new Map<string, Entry>();
const keyOf = (workspaceId: string, languageId: string) => `${workspaceId}::${languageId}`;

export function acquireLspClient(workspaceId: string, languageId: string, rootPath: string): LSPClient {
  const key = keyOf(workspaceId, languageId);
  let entry = cache.get(key);
  if (!entry) {
    const transport = createLspTransport(workspaceId, languageId);
    const client = new LSPClient({ rootUri: pathToFileUri(rootPath) });
    client.connect(transport);
    entry = { client, transport, refs: 0 };
    cache.set(key, entry);
  }
  if (entry.disposeTimer) { clearTimeout(entry.disposeTimer); entry.disposeTimer = undefined; }
  entry.refs++;
  return entry.client;
}

export function releaseLspClient(workspaceId: string, languageId: string): void {
  const key = keyOf(workspaceId, languageId);
  const entry = cache.get(key);
  if (!entry) return;
  if (--entry.refs > 0) return;
  // No editors left for this language — let it idle, then tear down (server child dies with the WS).
  entry.disposeTimer = window.setTimeout(() => {
    cache.delete(key);
    try { entry.client.disconnect(); } catch { /* already gone */ }
    try { entry.transport.close(); } catch { /* already gone */ }
  }, DISPOSE_GRACE_MS);
}
