import type { SpaceConfig } from "./types.js";

// A workspace's own wizard config layers ADDITIVELY on top of its space's config: the effective
// config seeded into the folder is the merge of the two. Merging into one config (rather than
// seeding twice) avoids the managed-block fight — both would write the SAME delimited block in
// CLAUDE.md/AGENTS.md, so the second seed would clobber the first. One merged block sidesteps that.

const union = (a: string[], b: string[]): string[] => {
  const out = [...a];
  for (const x of b) if (!out.includes(x)) out.push(x);
  return out;
};

const joinNonEmpty = (parts: string[], sep: string): string => parts.filter((p) => p.trim() !== "").join(sep);

const expand = (t: SpaceConfig["seedTarget"]): Set<string> =>
  t === "both" ? new Set(["CLAUDE.md", "AGENTS.md"]) : new Set([t]);

/** Combine the two seed targets into the widest cover (CLAUDE.md ∪ AGENTS.md → "both"). */
function mergeSeedTarget(a: SpaceConfig["seedTarget"], b: SpaceConfig["seedTarget"]): SpaceConfig["seedTarget"] {
  const s = new Set([...expand(a), ...expand(b)]);
  if (s.size > 1) return "both";
  return s.has("CLAUDE.md") ? "CLAUDE.md" : "AGENTS.md";
}

/** Effective config = base (space) with `over` (workspace) layered additively on top. Pick-lists
 *  union, env + rules content concatenate (base first), seed target widens. Never throws. */
export function mergeSpaceConfig(base: SpaceConfig, over: SpaceConfig): SpaceConfig {
  return {
    skills: union(base.skills, over.skills),
    commands: union(base.commands, over.commands),
    mcpServers: union(base.mcpServers, over.mcpServers),
    env: joinNonEmpty([base.env, over.env], "\n"),
    claudeMd: {
      // The base (space) mode governs the combined block; fall back to the overlay's mode when the
      // space contributes no rules text of its own.
      mode: base.claudeMd.content.trim() !== "" ? base.claudeMd.mode : over.claudeMd.mode,
      content: joinNonEmpty([base.claudeMd.content, over.claudeMd.content], "\n\n"),
    },
    seedTarget: mergeSeedTarget(base.seedTarget, over.seedTarget),
    presetId: over.presetId ?? base.presetId,
    version: 1,
  };
}
