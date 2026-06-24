import os from "node:os";
import path from "node:path";
import type { Scope } from "./types.js";

/** Prefer $HOME so tests can point the whole module tree at a temp dir. */
export function homeDir(): string {
  return process.env.HOME || os.homedir();
}

/** Active skills dir: ~/.claude/skills (global) or <workspace>/.claude/skills. */
export function skillsDir(scope: Scope, workspaceFolder?: string): string {
  return path.join(scopeRoot(scope, workspaceFolder), "skills");
}

/** Disabled skills dir (Terminal Hub's inert holding pen). Claude only reads `skills/`. */
export function disabledDir(scope: Scope, workspaceFolder?: string): string {
  return path.join(scopeRoot(scope, workspaceFolder), "skills-disabled");
}

function scopeRoot(scope: Scope, workspaceFolder?: string): string {
  if (scope === "global") return path.join(homeDir(), ".claude");
  if (!workspaceFolder) throw new Error("workspace scope requires a workspace folder");
  return path.join(workspaceFolder, ".claude");
}

/** The roots a path is allowed to live under: global always, workspace when one is given. */
function allowedRoots(workspaceFolder?: string): string[] {
  const roots = [skillsDir("global"), disabledDir("global")];
  if (workspaceFolder) roots.push(skillsDir("workspace", workspaceFolder), disabledDir("workspace", workspaceFolder));
  return roots;
}

/** Thrown when a path escapes the skills roots — a typed error so routes map it to 400. */
export class UnsafePathError extends Error {
  constructor(p: string) {
    super(`unsafe skill path: ${p}`);
    this.name = "UnsafePathError";
  }
}

/**
 * Resolve a caller-supplied path and require it to sit strictly *below* one of the allowed
 * skill roots, so a request can never read, move, or delete outside the skills directories.
 * Returns the normalized absolute path; throws on anything outside (incl. traversal and the
 * root dir itself). Every fs op in this module routes through it.
 */
export function assertSafe(p: string, workspaceFolder?: string): string {
  const resolved = path.resolve(p);
  const ok = allowedRoots(workspaceFolder).some((root) => resolved.startsWith(root + path.sep));
  if (!ok) throw new UnsafePathError(p);
  return resolved;
}

/** Turn a skill's frontmatter name into a safe folder name: no spaces, no hidden/traversal. */
export function sanitizeFolderName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/^[.-]+/, "")     // no leading dot (hidden) or dash, kills ".." traversal
    .replace(/-+/g, "-");
  return cleaned || "skill";
}

/** Which scope an already-validated skill path belongs to. Defaults to global. */
export function scopeOf(installPath: string, workspaceFolder?: string): Scope {
  const resolved = path.resolve(installPath);
  if (workspaceFolder) {
    const wsRoots = [skillsDir("workspace", workspaceFolder), disabledDir("workspace", workspaceFolder)];
    if (wsRoots.some((root) => resolved.startsWith(root + path.sep))) return "workspace";
  }
  return "global";
}
