export interface Frontmatter {
  name: string | null;
  description: string | null;
}

/**
 * Pull `name` + `description` out of a SKILL.md's leading `---` fenced YAML block. Only the two
 * scalar fields a skill needs — not a full YAML parser, so no dependency (the VS Code extension
 * uses gray-matter for the same two fields). Handles a BOM, leading blank lines, CRLF, quoted
 * scalars, and colons inside values. Nested/multiline values (e.g. `metadata:`) are skipped.
 */
export function parseFrontmatter(content: string): Frontmatter {
  const block = content.replace(/^﻿/, "").match(/^\s*---\r?\n([\s\S]*?)\r?\n---/);
  if (!block) return { name: null, description: null };

  const out: Frontmatter = { name: null, description: null };
  for (const raw of block[1].split(/\r?\n/)) {
    if (/^\s/.test(raw)) continue; // indented → child of a nested key, not top-level
    const i = raw.indexOf(":");
    if (i === -1) continue;
    const key = raw.slice(0, i).trim();
    if (key !== "name" && key !== "description") continue;
    out[key] = unquote(raw.slice(i + 1).trim()) || null;
  }
  return out;
}

function unquote(v: string): string {
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}
