import { promises as fs } from "node:fs";
import path from "node:path";

// Ready-made launch commands for the New-terminal picker's "add a command" form, so the common case
// is a pick rather than remembering what this project calls its dev script.
//
// The interesting half is read from the folder itself: a workspace's real package.json scripts, run
// through the package manager its own lockfile names. Nothing here is a guess about what the project
// contains — the fallbacks below are offered as a starting menu, and only for script names the
// folder does NOT already define.

export interface CommandPreset {
  /** What to show. Same as `command` for these — the command IS the label users recognise. */
  label: string;
  command: string;
  /** Where it came from, so the form can group "this project's scripts" apart from the generics. */
  source: "script" | "common";
  /** The package.json "description"-ish hint: the script body, clipped. Absent for generics. */
  detail?: string;
}

/** Script names worth offering even when the folder doesn't define them (or isn't a Node project). */
const COMMON_SCRIPTS = ["dev", "start", "build", "test"] as const;

const SCRIPT_BODY_CHARS = 80;

/** Which package manager this folder uses, by the lockfile it committed. npm when nothing says otherwise. */
export async function packageManagerFor(folder: string): Promise<"npm" | "pnpm" | "yarn" | "bun"> {
  const lockfiles = [
    ["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"], ["bun.lockb", "bun"], ["bun.lock", "bun"],
  ] as const;
  for (const [file, manager] of lockfiles) {
    if (await exists(path.join(folder, file))) return manager;
  }
  return "npm";
}

export async function commandPresets(folder: string): Promise<CommandPreset[]> {
  const manager = await packageManagerFor(folder);
  const scripts = await readScripts(folder);

  const presets: CommandPreset[] = Object.entries(scripts).map(([name, body]) => ({
    label: `${manager} run ${name}`,
    command: `${manager} run ${name}`,
    source: "script",
    detail: clip(body),
  }));

  const defined = new Set(Object.keys(scripts));
  for (const name of COMMON_SCRIPTS) {
    if (defined.has(name)) continue; // already offered above, with its real body attached
    presets.push({ label: `${manager} run ${name}`, command: `${manager} run ${name}`, source: "common" });
  }
  return presets;
}

// --- internals ---

async function exists(file: string): Promise<boolean> {
  try { await fs.stat(file); return true; } catch { return false; }
}

/** `scripts` from the folder's package.json — {} for a folder that has none, or an unreadable one. */
async function readScripts(folder: string): Promise<Record<string, string>> {
  let raw: string;
  try { raw = await fs.readFile(path.join(folder, "package.json"), "utf8"); } catch { return {}; }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return {}; } // a half-written package.json is not an error here
  if (!parsed || typeof parsed !== "object") return {};
  const scripts = (parsed as { scripts?: unknown }).scripts;
  if (!scripts || typeof scripts !== "object") return {};
  const out: Record<string, string> = {};
  for (const [name, body] of Object.entries(scripts as Record<string, unknown>)) {
    if (typeof body === "string" && name.trim()) out[name] = body;
  }
  return out;
}

function clip(s: string): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > SCRIPT_BODY_CHARS ? `${flat.slice(0, SCRIPT_BODY_CHARS)}…` : flat;
}
