import { normalizeSource } from "./git.js";

/**
 * GitHub orgs that publish first-party agent skills. A catalog skill whose source owner is in this
 * set is shown as "✓ Official"; everything else is Community/unofficial. There is no "official" field
 * inside a SKILL.md — officialness is a property of *where* the skill comes from, so we decide it
 * from the source's owner. Seeded from the vendor sources the VS Code agent-skills extension curates
 * by default (anthropics / github / openai / pytorch / microsoftdocs) plus obvious first-party
 * vendors. Lowercase; extend freely.
 */
const OFFICIAL_OWNERS = new Set([
  "anthropics",
  "openai",
  "github",
  "pytorch",
  "microsoft",
  "microsoftdocs",
  "vercel",
  "vercel-labs",
  "google",
  "googleapis",
  "google-gemini",
  "cloudflare",
  "modelcontextprotocol",
  "huggingface",
]);

/** The lowercased GitHub owner of a source, or null for a local path / non-GitHub / unparseable. */
function githubOwner(source: string): string | null {
  const ns = normalizeSource(source);
  if (ns.isLocal) return null;
  const m = ns.cloneUrl.match(/github\.com[/:]([^/]+)\//);
  return m ? m[1].toLowerCase() : null;
}

/** True when a catalog source comes from a known first-party vendor org → shown as ✓ Official. */
export function isOfficialSource(source: string): boolean {
  const owner = githubOwner(source);
  return owner !== null && OFFICIAL_OWNERS.has(owner);
}
