import { promises as fs } from "node:fs";
import path from "node:path";
import type { SpaceConfig } from "./types.js";
import { applyManagedBlock } from "./managedBlock.js";
import { globalSkillDir, globalCommandFile, readGlobalMcpServers, type McpServerDef } from "./catalog.js";
import { bundledCommandByName } from "./bundledCommands.js";

// Seeds a workspace folder from its space's wizard config. Runs on workspace create AND on every
// terminal launch, so EVERYTHING here is idempotent and never-clobber: it only adds files that are
// missing and only ever rewrites the delimited managed block inside CLAUDE.md/AGENTS.md. A user's
// own files — a hand-authored skill, a hand-added MCP server, a real .env — are never overwritten.

/** What a seed run actually changed, so callers can tell the user what landed (+ "relaunch to apply"). */
export interface SeedResult {
  skills: string[];      // skills newly copied in
  commands: string[];    // commands newly copied in
  mcpServers: string[];  // MCP servers newly written into .mcp.json
  envWritten: boolean;   // a fresh .env was created
  rulesFiles: string[];  // CLAUDE.md/AGENTS.md files whose managed block was written
}

/** Variable NAMES (never values) declared in a raw .env blob — `FOO=…` / `export FOO=…`. */
export function envVarNames(env: string): string[] {
  const out: string[] = [];
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m) out.push(m[1]);
  }
  return out;
}

const pathExists = (p: string) => fs.access(p).then(() => true, () => false);

/** Append `.env` to a folder's .gitignore unless it's already ignored. Idempotent. */
async function ensureEnvIgnored(folder: string): Promise<void> {
  const gi = path.join(folder, ".gitignore");
  let current = "";
  try { current = await fs.readFile(gi, "utf8"); } catch { /* none yet */ }
  if (current.split(/\r?\n/).some((l) => l.trim() === ".env")) return;
  const next = current && !current.endsWith("\n") ? current + "\n.env\n" : current + ".env\n";
  await fs.writeFile(gi, next);
}

async function seedSkills(folder: string, names: string[]): Promise<string[]> {
  const done: string[] = [];
  for (const name of names) {
    const src = globalSkillDir(name);
    const dest = path.join(folder, ".claude", "skills", name);
    if (!(await pathExists(src)) || (await pathExists(dest))) continue; // missing source / never clobber
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.cp(src, dest, { recursive: true, filter: (p) => !p.split(path.sep).includes(".git") });
    done.push(name);
  }
  return done;
}

async function seedCommands(folder: string, names: string[]): Promise<string[]> {
  const done: string[] = [];
  for (const name of names) {
    const dest = path.join(folder, ".claude", "commands", `${name}.md`);
    if (await pathExists(dest)) continue; // never clobber an existing local command
    const src = globalCommandFile(name);
    if (await pathExists(src)) {
      // The user's own global command wins over any bundled twin.
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(src, dest);
      done.push(name);
      continue;
    }
    const bundled = bundledCommandByName(name); // fall back to the shipped starter pack
    if (bundled) {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, bundled.content);
      done.push(name);
    }
  }
  return done;
}

async function seedMcpServers(folder: string, names: string[]): Promise<string[]> {
  if (!names.length) return [];
  const available = readGlobalMcpServers();
  const wanted = names.filter((n) => available[n]);
  if (!wanted.length) return [];

  const dest = path.join(folder, ".mcp.json");
  let doc: { mcpServers?: Record<string, McpServerDef> } = {};
  try { doc = JSON.parse(await fs.readFile(dest, "utf8")); } catch { /* new or unparseable → start fresh */ }
  if (!doc.mcpServers || typeof doc.mcpServers !== "object") doc.mcpServers = {};

  const added: string[] = [];
  for (const name of wanted) {
    if (name in doc.mcpServers) continue; // never clobber a hand-added / already-present server
    doc.mcpServers[name] = available[name];
    added.push(name);
  }
  if (added.length) await fs.writeFile(dest, JSON.stringify(doc, null, 2) + "\n");
  return added;
}

async function seedEnv(folder: string, env: string): Promise<boolean> {
  const dest = path.join(folder, ".env");
  await ensureEnvIgnored(folder);
  if (await pathExists(dest)) return false; // never clobber a hand-authored .env
  await fs.writeFile(dest, env.endsWith("\n") ? env : env + "\n");
  return true;
}

/** Managed-block body = the user's rules content + a names-only note about the seeded .env. */
function rulesContent(config: SpaceConfig): string {
  const parts = [config.claudeMd.content.trim()].filter(Boolean);
  const names = envVarNames(config.env);
  if (names.length) parts.push(`Environment variables available in \`.env\`: ${names.map((n) => `\`${n}\``).join(", ")}.`);
  return parts.join("\n\n");
}

function rulesTargets(config: SpaceConfig): string[] {
  if (config.seedTarget === "both") return ["AGENTS.md", "CLAUDE.md"];
  return [config.seedTarget];
}

async function seedRules(folder: string, config: SpaceConfig): Promise<string[]> {
  const content = rulesContent(config);
  const written: string[] = [];
  for (const file of rulesTargets(config)) {
    const dest = path.join(folder, file);
    let existing: string | null = null;
    try { existing = await fs.readFile(dest, "utf8"); } catch { /* new file */ }
    const next = applyManagedBlock(existing, content, config.claudeMd.mode);
    if (next === (existing ?? "")) continue; // nothing to do (e.g. empty content, no prior block)
    if (next === "" && existing == null) continue;
    await fs.writeFile(dest, next);
    written.push(file);
  }
  return written;
}

/** Seed (or re-seed) a workspace folder from its space's config. Best-effort + idempotent. */
export async function seedWorkspace(folder: string, config: SpaceConfig): Promise<SeedResult> {
  const skills = await seedSkills(folder, config.skills);
  const commands = await seedCommands(folder, config.commands);
  const mcpServers = await seedMcpServers(folder, config.mcpServers);
  const envWritten = config.env.trim() ? await seedEnv(folder, config.env) : false;
  const rulesFiles = await seedRules(folder, config);
  return { skills, commands, mcpServers, envWritten, rulesFiles };
}
