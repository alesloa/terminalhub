import type { EditorView } from "@codemirror/view";
import { LSPPlugin } from "@codemirror/lsp-client";
import type * as lsp from "vscode-languageserver-protocol";
import { fileUriToPath, basename } from "./uri";

export interface DefinitionTarget {
  path: string;  // absolute path of the defining file
  name: string;  // basename, for the tab title
  line: number;  // 1-based (CodeMirror lines are 1-based)
  col: number;   // 0-based character offset within the line
}

/** `textDocument/definition` may return a Location, Location[], or LocationLink[]. Take the first. */
function firstLocation(result: lsp.Definition | lsp.LocationLink[] | null): { uri: string; range: lsp.Range } | null {
  if (!result) return null;
  const one = Array.isArray(result) ? result[0] : result;
  if (!one) return null;
  if ("targetUri" in one) return { uri: one.targetUri, range: one.targetSelectionRange ?? one.targetRange };
  return { uri: one.uri, range: one.range };
}

/** Ask the language server where the symbol at document offset `pos` is defined. Returns the target
 *  file + position, or null when there's no plugin/connection or the server has no answer. */
export async function resolveDefinition(view: EditorView, pos: number): Promise<DefinitionTarget | null> {
  const plugin = LSPPlugin.get(view);
  if (!plugin) return null;
  const client = plugin.client;
  client.sync(); // flush un-synced local edits so the server's offsets line up with our document
  const params: lsp.DefinitionParams = {
    textDocument: { uri: plugin.uri },
    position: plugin.toPosition(pos), // CM offset → LSP {line, character} (0-based)
  };
  let result: lsp.Definition | lsp.LocationLink[] | null;
  try {
    result = await client.request<lsp.DefinitionParams, lsp.Definition | lsp.LocationLink[] | null>(
      "textDocument/definition",
      params,
    );
  } catch {
    return null; // request timed out or the server errored
  }
  const loc = firstLocation(result);
  if (!loc) return null;
  const path = fileUriToPath(loc.uri);
  return { path, name: basename(path), line: loc.range.start.line + 1, col: loc.range.start.character };
}
