// How each known coding-agent CLI is driven one-shot for text generation, and where its REAL model
// list comes from. The CLIs themselves can't enumerate models — verified against the installed
// tools' own `--help`: none of claude / codex / gemini / cursor-agent expose a list-models command —
// so a model dropdown for a CLI provider is fetched from the backing HTTP API (Anthropic / OpenAI /
// Google) when a key is available, and is otherwise typed by hand. Nothing here is a model *name*:
// only the invocation shape and the backing endpoint, every flag taken from each tool's `--help`.

export interface CliSpec {
  /** How the prompt reaches the CLI: piped on stdin, or appended as an argument. */
  promptVia: "stdin" | "arg";
  /** For prompt-via-arg CLIs, the flag the prompt value follows (gemini `-p "<prompt>"`); omit when
   *  the prompt is a bare positional (cursor-agent). Ignored for stdin CLIs. */
  promptFlag?: string;
  /** The flag that selects a model, e.g. `--model` (claude/cursor) or `-m` (codex/gemini). */
  modelFlag?: string;
  /** The HTTP API whose `/models` lists this CLI's real models (CLIs can't self-list). Omit when the
   *  vendor has no public model-list endpoint (cursor) — the UI then falls back to manual entry. */
  backing?: { kind: "anthropic" | "openai-compatible"; baseUrl: string; apiKeyEnv: string };
}

/** Keyed by the binary (argv[0]) so it resolves from a provider's stored `command`. */
export const CLI_SPECS: Record<string, CliSpec> = {
  claude: {
    promptVia: "stdin", modelFlag: "--model",
    backing: { kind: "anthropic", baseUrl: "https://api.anthropic.com", apiKeyEnv: "ANTHROPIC_API_KEY" },
  },
  codex: {
    promptVia: "stdin", modelFlag: "-m",
    backing: { kind: "openai-compatible", baseUrl: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY" },
  },
  gemini: {
    promptVia: "arg", promptFlag: "-p", modelFlag: "-m",
    backing: { kind: "openai-compatible", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiKeyEnv: "GEMINI_API_KEY" },
  },
  "cursor-agent": {
    promptVia: "arg", modelFlag: "--model", // prompt is a bare positional; Cursor has no public /models
  },
};

/** The base one-shot argv (non-interactive, prompt delivered per CLI_SPECS) for each detectable agent,
 *  keyed by BUILTIN_AGENTS id. Only confirmed invocations live here — every flag is from the tool's
 *  own `--help`, never guessed. Agents absent here are still launchable in a room, just not wired for
 *  one-shot generation. */
export const CLI_ONESHOT: Record<string, string[]> = {
  claude: ["claude", "-p"],
  codex: ["codex", "exec"],
  gemini: ["gemini", "-o", "text"],          // headless prompt appended via -p (CLI_SPECS.gemini)
  cursor: ["cursor-agent", "-p", "--output-format", "text"],
};

/**
 * Build the actual argv + stdin for a one-shot CLI run: inject the chosen model with the CLI's model
 * flag, then deliver the prompt the way the CLI expects (stdin for claude/codex, an argument for
 * gemini/cursor). An unknown binary (a custom command the user typed) defaults to stdin with no model
 * flag — exactly today's behaviour.
 */
export function cliArgv(command: string[], model: string | undefined, prompt: string): { argv: string[]; stdin: string } {
  const spec = CLI_SPECS[command[0]];
  const argv = [...command];
  if (model?.trim() && spec?.modelFlag) argv.push(spec.modelFlag, model.trim());
  if (spec?.promptVia === "arg") {
    if (spec.promptFlag) argv.push(spec.promptFlag);
    argv.push(prompt);
    return { argv, stdin: "" };
  }
  return { argv, stdin: prompt };
}
