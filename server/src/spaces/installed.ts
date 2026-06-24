import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { homeDir } from "../skills/paths.js";
import { seedWorkspace, type SeedResult } from "./seeder.js";
import { EMPTY_SPACE_CONFIG } from "./types.js";

// Ground truth for "what's active for the agent in THIS workspace", each item tagged by scope:
//   local  → pinned to this folder: <folder>/.claude/{skills,commands}, <folder>/.mcp.json, plus
//            local-scope MCP (~/.claude.json projects[folder], added via `claude mcp add` here).
//   global → user-scope, active in every project: ~/.claude/{skills,commands}.
// MCP is special: per product decision the user's MCP set is treated as part of each workspace, so
// user-scope top-level mcpServers are folded in as scope "local" too — MCP is ALWAYS shown local.
// A name present in both local and global collapses to one entry, local winning (it's pinned here).
// The installer shows local under "In this workspace" and global under a collapsed "Active globally".

export type InstallScope = "local" | "global";
/** One active item + where it lives ("local" = this folder, "global" = user-scope ~/.claude). */
export interface InstalledItem {
  name: string;
  scope: InstallScope;
}
export interface InstalledSet {
  skills: InstalledItem[];
  commands: InstalledItem[];
  mcpServers: InstalledItem[];
}

export type InstallKind = "skill" | "command" | "mcp";

/** Directory entries of one kind: skill folder names (`dir`) or command basenames (`md`). [] if absent. */
async function readDirNames(dir: string, kind: "dir" | "md"): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    if (kind === "dir") return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    return entries.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name.replace(/\.md$/, ""));
  } catch {
    return [];
  }
}

/** `mcpServers` keys of <folder>/.mcp.json (project scope). [] when absent/unparseable. */
async function projectFileMcp(folder: string): Promise<string[]> {
  try {
    const doc = JSON.parse(await fs.readFile(path.join(folder, ".mcp.json"), "utf8")) as { mcpServers?: Record<string, unknown> };
    return doc.mcpServers && typeof doc.mcpServers === "object" ? Object.keys(doc.mcpServers) : [];
  } catch {
    return [];
  }
}

/** MCP keys read from ~/.claude.json: the user-scope top-level `mcpServers` ∪ this folder's local-scope
 *  `projects[folder].mcpServers`. Both are treated as local (MCP is always shown local). [] on error. */
function claudeJsonMcp(folder: string): string[] {
  try {
    const doc = JSON.parse(readFileSync(path.join(homeDir(), ".claude.json"), "utf8")) as {
      mcpServers?: Record<string, unknown>;
      projects?: Record<string, { mcpServers?: Record<string, unknown> }>;
    };
    const top = doc.mcpServers && typeof doc.mcpServers === "object" ? Object.keys(doc.mcpServers) : [];
    const proj = doc.projects?.[folder]?.mcpServers;
    const local = proj && typeof proj === "object" ? Object.keys(proj) : [];
    return [...top, ...local];
  } catch {
    return [];
  }
}

/** Merge a local name list and a global name list into sorted, deduped scoped items; local wins ties. */
function mergeScoped(local: string[], global: string[]): InstalledItem[] {
  const scope = new Map<string, InstallScope>();
  for (const n of global) scope.set(n, "global");
  for (const n of local) scope.set(n, "local"); // local overrides global on conflict
  return [...scope.keys()].sort((a, b) => a.localeCompare(b)).map((name) => ({ name, scope: scope.get(name)! }));
}

/** Read what's active in a workspace folder (local + user-scope global), tagged by scope. Never throws. */
export async function readInstalled(folder: string): Promise<InstalledSet> {
  const home = homeDir();
  const [localSkills, globalSkills, localCmds, globalCmds, projMcp] = await Promise.all([
    readDirNames(path.join(folder, ".claude", "skills"), "dir"),
    readDirNames(path.join(home, ".claude", "skills"), "dir"),
    readDirNames(path.join(folder, ".claude", "commands"), "md"),
    readDirNames(path.join(home, ".claude", "commands"), "md"),
    projectFileMcp(folder),
  ]);
  return {
    skills: mergeScoped(localSkills, globalSkills),
    commands: mergeScoped(localCmds, globalCmds),
    // MCP is always local: project .mcp.json ∪ ~/.claude.json (user-scope + local-scope), all "local".
    mcpServers: mergeScoped([...projMcp, ...claudeJsonMcp(folder)], []),
  };
}

/** Install one global item into a workspace folder by running the seeder with a one-item config.
 *  Reuses the seeder's never-clobber + idempotent copy, so an already-present item is a no-op and a
 *  hand-added one is never overwritten. The caller re-reads `readInstalled` to confirm it landed. */
export async function installItem(folder: string, kind: InstallKind, name: string): Promise<SeedResult> {
  const config = { ...EMPTY_SPACE_CONFIG, skills: [] as string[], commands: [] as string[], mcpServers: [] as string[] };
  if (kind === "skill") config.skills = [name];
  else if (kind === "command") config.commands = [name];
  else config.mcpServers = [name];
  return seedWorkspace(folder, config);
}
