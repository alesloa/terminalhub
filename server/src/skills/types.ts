/** Where a skill lives. Workspace = <folder>/.claude/skills; global = ~/.claude/skills. */
export type Scope = "workspace" | "global";

/** How a skill got here, for provenance + update checks. */
export type SourceType = "git" | "github" | "gitlab" | "direct-url" | "local" | "registry";

/**
 * Terminal Hub's provenance row for one installed skill, keyed by the skill folder's absolute
 * path. Disk is the source of truth for what's installed; this enriches a skill with where
 * it came from and its last-known hashes so updates can be detected. Hand-made skills have
 * no row.
 */
export interface SkillInstall {
  installPath: string;          // absolute path to the skill folder (active or disabled)
  name: string;                 // folder name
  scope: Scope;
  sourceType: SourceType | null;
  sourceUrl: string | null;     // clone URL / origin
  skillPath: string | null;     // subpath of the skill within the source repo
  repoHeadHash: string | null;  // remote HEAD sha last seen (ls-remote pre-filter)
  folderHash: string | null;    // SHA-256 of the installed folder (exact-change check)
  installedAt: number;
  updatedAt: number;
}

/** A skill as the panel sees it: what's on disk, enriched with provenance + update state. */
export interface InstalledSkill {
  installPath: string;
  name: string;                    // folder name = install identity
  displayName: string;             // frontmatter name (falls back to folder name)
  description: string | null;
  scope: Scope;
  enabled: boolean;                // true = in skills/, false = parked in skills-disabled/
  sourceType: SourceType | null;
  sourceUrl: string | null;
  updateAvailable: boolean | null; // null = unknown (not checked / no provenance)
}

/** Result of an update check for one installed skill. */
export interface UpdateStatus {
  installPath: string;
  updateAvailable: boolean | null;
}

/**
 * A configured catalog source (git/owner-repo/local path). Terminal Hub scans each for SKILL.md
 * folders to build a browsable local index, mirroring the VS Code extension's catalogSources.
 */
export interface CatalogSource {
  source: string;                 // the raw source spec, also the primary key
  addedAt: number;
  lastIndexedAt: number | null;
  skillCount: number;
  error: string | null;           // last index error, if the source failed to scan
  official: boolean;              // user-set: skills from this source carry the ✓ Official badge
}

/** One skill discovered in a catalog source's local index. */
export interface CatalogEntry {
  source: string;
  name: string;
  description: string | null;
  relPath: string | null;         // folder of the skill within the source
  official: boolean;              // source owner is a known vendor org (see trust.ts) — not stored, computed on read
}
