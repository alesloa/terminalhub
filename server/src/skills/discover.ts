import { promises as fs } from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "./frontmatter.js";

export interface SkillCandidate {
  name: string;        // frontmatter name (sanitized to a folder name at install time)
  description: string;
  relPath: string;     // skill folder relative to the scanned root ("." when the root itself is a skill)
}

const IGNORE = new Set(["node_modules", ".git", "dist", "build", "__pycache__"]);
const MAX_DEPTH = 5;

/**
 * Walk a cloned repo (or a local folder) and return every skill in it: a directory that holds a
 * SKILL.md whose frontmatter has both `name` and `description`. A skill folder is a leaf — we
 * don't descend past one — so a skill's own resource subfolders can't masquerade as more skills.
 */
export async function discoverSkills(root: string): Promise<SkillCandidate[]> {
  const out: SkillCandidate[] = [];
  await visit(root, root, 0, out);
  return out;
}

async function visit(dir: string, root: string, depth: number, out: SkillCandidate[]): Promise<void> {
  const candidate = await readSkill(dir);
  if (candidate) {
    const rel = path.relative(root, dir).split(path.sep).join("/") || ".";
    out.push({ ...candidate, relPath: rel });
    return; // leaf: a skill folder is one unit
  }
  if (depth >= MAX_DEPTH) return;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (IGNORE.has(entry.name) || entry.name.startsWith(".")) continue;
    await visit(path.join(dir, entry.name), root, depth + 1, out);
  }
}

/** A directory is a skill iff it has a SKILL.md with name + description. */
async function readSkill(dir: string): Promise<{ name: string; description: string } | null> {
  let content: string;
  try {
    content = await fs.readFile(path.join(dir, "SKILL.md"), "utf8");
  } catch {
    return null;
  }
  const fm = parseFrontmatter(content);
  if (!fm.name || !fm.description) return null;
  return { name: fm.name, description: fm.description };
}
