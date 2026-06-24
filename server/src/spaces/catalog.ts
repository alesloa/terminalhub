import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { homeDir, skillsDir } from "../skills/paths.js";
import { parseFrontmatter } from "../skills/frontmatter.js";
import { classify } from "./classify.js";
import { BUNDLED_COMMANDS } from "./bundledCommands.js";
import type { SpaceCatalog, SkillCard, CommandCard, McpCard } from "./types.js";

// The wizard's pickable lists come from the user's GLOBAL Claude config — their real skills
// (~/.claude/skills), slash commands (~/.claude/commands), and MCP servers (~/.claude.json). Nothing
// is invented for skills/MCP: an empty source yields an empty list. Commands additionally include a
// curated bundled starter pack (see bundledCommands.ts) so there's always something to install; a
// user's own global command of the same name overrides its bundled twin.

/** A raw MCP server definition as it sits in ~/.claude.json. Shape is passed through to .mcp.json. */
export interface McpServerDef {
  type?: "stdio" | "sse" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

/** Absolute path of a global skill folder (source for the seeder's copy). */
export function globalSkillDir(name: string): string {
  return path.join(skillsDir("global"), name);
}

/** Directory holding the user's global slash commands. */
export function globalCommandsDir(): string {
  return path.join(homeDir(), ".claude", "commands");
}

/** Absolute path of a global slash-command file (source for the seeder's copy). */
export function globalCommandFile(name: string): string {
  return path.join(globalCommandsDir(), `${name}.md`);
}

/** The user's global MCP servers, verbatim, keyed by name. {} when ~/.claude.json is absent/bad. */
export function readGlobalMcpServers(): Record<string, McpServerDef> {
  try {
    const raw = readFileSync(path.join(homeDir(), ".claude.json"), "utf8");
    const parsed = JSON.parse(raw) as { mcpServers?: Record<string, McpServerDef> };
    return parsed && typeof parsed === "object" && parsed.mcpServers && typeof parsed.mcpServers === "object"
      ? parsed.mcpServers : {};
  } catch {
    return {};
  }
}

/** Pull a `description:` out of a SKILL.md/command frontmatter, folding YAML block scalars
 *  (`description: >` / `description: |`, whose text sits on the following indented lines) into one
 *  readable line. `parseFrontmatter` only reads inline scalars — most real skills use block scalars,
 *  so a card would otherwise show a bare ">"/"|". */
function frontmatterDescription(content: string): string | null {
  const m = content.replace(/^﻿/, "").match(/^\s*---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^\s/.test(lines[i])) continue; // child of a nested key — skip while scanning top-level keys
    const idx = lines[i].indexOf(":");
    if (idx === -1 || lines[i].slice(0, idx).trim() !== "description") continue;
    let val = lines[i].slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (val !== "" && !/^[|>][+-]?\d*$/.test(val)) return val; // inline scalar
    const block: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === "") { block.push(""); continue; }
      if (!/^\s/.test(lines[j])) break; // dedent ends the block scalar
      block.push(lines[j].trim());
    }
    return block.join(" ").replace(/\s+/g, " ").trim() || null;
  }
  return null;
}

/** A top-level `category:` scalar from frontmatter, if the file declares one — the user's explicit
 *  override of the keyword classifier. Null when absent. */
function frontmatterCategory(content: string): string | null {
  const m = content.replace(/^﻿/, "").match(/^\s*---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  for (const line of m[1].split(/\r?\n/)) {
    if (/^\s/.test(line)) continue; // nested key — not a top-level `category:`
    const idx = line.indexOf(":");
    if (idx === -1 || line.slice(0, idx).trim() !== "category") continue;
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    return val.trim() || null;
  }
  return null;
}

function mcpTransport(def: McpServerDef): McpCard["transport"] {
  if (def.type) return def.type;
  return def.url ? "http" : "stdio";
}

function mcpSummary(def: McpServerDef): string {
  if (def.command) return [def.command, ...(def.args ?? [])].join(" ");
  if (def.url) return def.url;
  return "";
}

async function readSkillCards(): Promise<SkillCard[]> {
  const dir = skillsDir("global");
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
  const out: SkillCard[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    let content: string;
    try { content = await fs.readFile(path.join(dir, e.name, "SKILL.md"), "utf8"); } catch { continue; }
    const fm = parseFrontmatter(content);
    const description = frontmatterDescription(content);
    out.push({
      name: e.name,
      displayName: fm.name ?? e.name,
      description,
      category: classify(e.name, description, frontmatterCategory(content)),
    });
  }
  return out.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** First human-readable line of a command file: its frontmatter description, else the first
 *  non-empty body line that isn't a heading. */
function commandDescription(content: string): string | null {
  const fm = frontmatterDescription(content);
  if (fm) return fm;
  const body = content.replace(/^\s*---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (t && !t.startsWith("#")) return t;
  }
  return null;
}

async function readCommandCards(): Promise<CommandCard[]> {
  const dir = globalCommandsDir();
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
  const out: CommandCard[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".md")) continue;
    let content: string;
    try { content = await fs.readFile(path.join(dir, e.name), "utf8"); } catch { continue; }
    const name = e.name.replace(/\.md$/, "");
    const description = commandDescription(content);
    out.push({ name, description, category: classify(name, description, frontmatterCategory(content)) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function readMcpCards(): McpCard[] {
  return Object.entries(readGlobalMcpServers())
    .map(([name, def]) => {
      const description = mcpSummary(def) || null;
      return { name, description, transport: mcpTransport(def), category: classify(name, description) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Every directory name under ~/.claude/skills — a skill provides `/name`, so these names are already
 *  taken globally and a bundled command of the same name would be a redundant duplicate. */
async function globalSkillNames(): Promise<string[]> {
  try {
    const entries = await fs.readdir(skillsDir("global"), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** Bundled starter commands minus any whose name is already a global command OR a global skill (both
 *  surface as `/name`, so offering a bundled twin would just duplicate something already installed). */
function bundledCommandCards(reserved: Set<string>): CommandCard[] {
  return BUNDLED_COMMANDS.filter((b) => !reserved.has(b.name)).map((b) => ({ name: b.name, description: b.description, category: b.category }));
}

/** Everything the wizard offers to add: the user's global config + the bundled command starter pack. */
export async function listSpaceCatalog(): Promise<SpaceCatalog> {
  const [skills, userCommands, skillNames] = await Promise.all([readSkillCards(), readCommandCards(), globalSkillNames()]);
  const reserved = new Set([...userCommands.map((c) => c.name), ...skillNames]);
  const commands = [...userCommands, ...bundledCommandCards(reserved)].sort((a, b) => a.name.localeCompare(b.name));
  return { skills, commands, mcpServers: readMcpCards() };
}
