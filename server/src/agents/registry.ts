import { accessSync, constants } from "node:fs";
import { join, delimiter } from "node:path";

export interface BuiltinAgent {
  id: string;       // stable id; also the icon asset key on the web side (/agents/<id>.svg)
  name: string;     // display label
  bin: string;      // binary probed on $PATH
  command: string;  // launch command sent to the terminal
  blurb: string;    // one-line description
}

/** Known coding-agent CLIs we ship icons for and detect on $PATH. */
export const BUILTIN_AGENTS: BuiltinAgent[] = [
  { id: "claude",   name: "Claude Code", bin: "claude",       command: "claude",       blurb: "Anthropic Claude CLI" },
  { id: "codex",    name: "Codex",       bin: "codex",        command: "codex",        blurb: "OpenAI Codex CLI" },
  { id: "gemini",   name: "Gemini",      bin: "gemini",       command: "gemini",       blurb: "Google Gemini CLI" },
  { id: "opencode", name: "opencode",    bin: "opencode",     command: "opencode",     blurb: "opencode agent" },
  { id: "cursor",   name: "Cursor",      bin: "cursor-agent", command: "cursor-agent", blurb: "Cursor CLI agent" },
];

function executable(p: string): boolean {
  try { accessSync(p, constants.X_OK); return true; } catch { return false; }
}

/** True if `bin` resolves to an executable on PATH (or directly, if it contains a slash). */
export function isOnPath(bin: string, opts: { pathEnv?: string; exists?: (p: string) => boolean } = {}): boolean {
  const pathEnv = opts.pathEnv ?? process.env.PATH ?? "";
  const exists = opts.exists ?? executable;
  // On Windows the shell resolves bare names via PATHEXT (.exe, .cmd, .ps1 etc.). Probe the
  // common suffixes here so "claude" finds "claude.exe" and "codex" finds "codex.cmd".
  const names = process.platform === "win32" && !bin.includes(".")
    ? [bin, `${bin}.exe`, `${bin}.cmd`, `${bin}.ps1`]
    : [bin];
  if (bin.includes("/") || bin.includes("\\")) return names.some(n => exists(n));
  for (const dir of pathEnv.split(delimiter)) {
    if (dir && names.some(n => exists(join(dir, n)))) return true;
  }
  return false;
}

export interface DetectedAgent { id: string; name: string; command: string; blurb: string; installed: boolean; }

/** The built-in registry with an `installed` flag; `bin` is dropped (internal-only). */
export function detectBuiltins(opts: { pathEnv?: string; exists?: (p: string) => boolean } = {}): DetectedAgent[] {
  return BUILTIN_AGENTS.map(({ bin, ...rest }) => ({ ...rest, installed: isOnPath(bin, opts) }));
}
