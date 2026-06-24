import { isOnPath } from "../agents/registry.js";

// A language server we know how to detect on $PATH and spawn over stdio. We NEVER bundle a server
// binary (license + "your machine" stance) — the user installs it, we detect + spawn arm's-length.
export interface LanguageServerDef {
  id: string;            // stable id (also the registry key), e.g. "typescript-language-server"
  name: string;          // display label for the missing-server toast
  languageIds: string[]; // LSP language ids this server handles (see web languageIdFor())
  bin: string;           // binary probed on $PATH (internal-only; dropped from the API shape)
  args: string[];        // spawn args, e.g. ["--stdio"] (internal-only)
  installHint: string;   // how to install it, shown in the toast
}

/** Known language servers, keyed by the LSP language ids the editor reports. Registry-driven so
 *  adding a server is data, not code. Validate TypeScript/JavaScript first (most common here). */
export const BUILTIN_LANGUAGE_SERVERS: LanguageServerDef[] = [
  {
    id: "typescript-language-server",
    name: "TypeScript / JavaScript",
    languageIds: ["typescript", "javascript", "typescriptreact", "javascriptreact"],
    bin: "typescript-language-server",
    args: ["--stdio"],
    installHint: "npm i -g typescript-language-server typescript",
  },
  {
    id: "pyright",
    name: "Python (Pyright)",
    languageIds: ["python"],
    bin: "pyright-langserver",
    args: ["--stdio"],
    installHint: "npm i -g pyright",
  },
  {
    id: "gopls",
    name: "Go (gopls)",
    languageIds: ["go"],
    bin: "gopls",
    args: [],
    installHint: "go install golang.org/x/tools/gopls@latest",
  },
  {
    id: "rust-analyzer",
    name: "Rust (rust-analyzer)",
    languageIds: ["rust"],
    bin: "rust-analyzer",
    args: [],
    installHint: "rustup component add rust-analyzer",
  },
];

type DetectOpts = { pathEnv?: string; exists?: (p: string) => boolean };

/** Public, web-facing shape: the internal `bin`/`args` are stripped. Mirrored in web/src/api/types.ts. */
export interface DetectedLanguageServer {
  id: string;
  name: string;
  languageIds: string[];
  installHint: string;
  installed: boolean;
}

/** The full builtin roster with an `installed` flag; `bin`/`args` dropped (internal-only). */
export function detectLanguageServers(opts: DetectOpts = {}): DetectedLanguageServer[] {
  return BUILTIN_LANGUAGE_SERVERS.map(({ bin, args, ...rest }) => ({
    ...rest,
    installed: isOnPath(bin, opts),
  }));
}

/** Resolve the server that handles a given LSP language id, with its live `installed` flag.
 *  Keeps `bin`/`args` so the gateway can spawn it. Null when no known server handles the id. */
export function serverForLanguageId(
  languageId: string,
  opts: DetectOpts = {},
): (LanguageServerDef & { installed: boolean }) | null {
  const def = BUILTIN_LANGUAGE_SERVERS.find((s) => s.languageIds.includes(languageId));
  return def ? { ...def, installed: isOnPath(def.bin, opts) } : null;
}
