import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { LanguageServerInfo } from "../api/types";
import { useToasts } from "../store/toasts";
import { languageIdFor } from "../lib/codeMirror";

// Dedupe the "install <server>" toast: once per language server id, per browser session.
const toasted = new Set<string>();

/** The host's detected language servers (installed / missing). Cached app-wide. */
export function useLanguageServers() {
  return useQuery({ queryKey: ["lsp-servers"], queryFn: () => api.lspServers(), staleTime: 60_000 });
}

/** Resolve the language server for an open file. When the file's language has a known-but-uninstalled
 *  server, toast once telling the user how to install it. Returns the server only when it's actually
 *  installed (so the editor knows whether to wire LSP), else null. */
export function useFileLanguageServer(filename: string): LanguageServerInfo | null {
  const { data } = useLanguageServers();
  const push = useToasts((s) => s.push);

  const languageId = languageIdFor(filename);
  const server = languageId && data
    ? data.servers.find((s) => s.languageIds.includes(languageId)) ?? null
    : null;

  useEffect(() => {
    if (!server || server.installed || toasted.has(server.id)) return;
    toasted.add(server.id);
    push(
      `${server.name} language server not found. Install it for go-to-definition: ${server.installHint}`,
      { level: "error", title: server.name, sticky: true },
    );
  }, [server, push]);

  return server && server.installed ? server : null;
}
