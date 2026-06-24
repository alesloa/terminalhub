// Heuristic topic classifier for catalog cards. The wizard's left rail groups skills / commands /
// MCP servers by topic so a long flat list is browsable. The bucket is a best-effort GUESS from the
// item's name + description — the user's global Claude config carries almost no category metadata —
// so an item's own frontmatter `category` overrides the guess. v1 buckets, user-correctable.

/** Match precedence: first regex to hit `name + description` wins. Order is deliberate (Design
 *  before Media before Writing, etc.) so a "design" hit beats an incidental keyword later in the blurb. */
const RULES: Array<[string, RegExp]> = [
  ["Design", /design|frontend|\bui\b|\bux\b|figma|pencil|stitch|hyperframe|\bgsap\b|animation|\bbrand|colou?r|visual|theme|layout/],
  ["Media", /\bimage|photo|video|remotion|audio|course|render|\bgif\b|screenshot/],
  ["Writing", /writ|humaniz|prose|email|slack|\bnotes?\b|meeting|\bprd\b|markdown|\bdocs?\b|documentation|caveman|blog|content/],
  ["Git", /\bgit\b|commit|\bpr\b|pull[ -]?request|\bbranch|\bmerge\b|handoff|workflow|release/],
  ["AI", /\bagents?\b|\bllm\b|council|prompt|\bclaude|\bmodels?\b|graphify/],
  ["Code", /\bcode|codebase|\bapi\b|reverse[ -]engineer|debug|refactor|\btests?\b|implement|\bgraph\b|domain|\bskills?\b|registry|\bcli\b|engineer/],
];

/** Display order of the known buckets in the wizard's left rail. Frontmatter-derived custom buckets
 *  sort after these (alphabetically) and "Other" is always last — see PickerStep's rail builder. */
export const CATEGORY_ORDER = ["Design", "Writing", "Git", "Code", "AI", "Media"];

/** Best-effort topic bucket for a catalog card. A non-empty frontmatter category wins (title-cased);
 *  otherwise the first keyword rule to match name+description; otherwise "Other". */
export function classify(name: string, description?: string | null, frontmatter?: string | null): string {
  const fm = (frontmatter ?? "").trim();
  if (fm) return fm.charAt(0).toUpperCase() + fm.slice(1);
  const hay = `${name} ${description ?? ""}`.toLowerCase();
  for (const [cat, re] of RULES) if (re.test(hay)) return cat;
  return "Other";
}
