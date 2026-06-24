import type { Extension } from "@codemirror/state";
import type { LSPClient } from "@codemirror/lsp-client";
import { lspNavigation, type NavigateFn } from "./pointer";

/** The full LSP payload for one editor (Milestone 1 = navigation): register the file with the server
 *  (the plugin handles didOpen / sync / position conversion) and wire the adaptive go-to-def input.
 *  Milestone 2 adds completion / hover / diagnostics here on the same client. */
export function lspEditorExtension(opts: {
  client: LSPClient;
  uri: string;
  languageId: string;
  onNavigate: NavigateFn;
  onNoDefinition?: () => void;
}): Extension {
  return [
    opts.client.plugin(opts.uri, opts.languageId),
    lspNavigation({ onNavigate: opts.onNavigate, onNoDefinition: opts.onNoDefinition }),
  ];
}
