import codiconCsv from "@vscode/codicons/dist/codicon.csv?raw";

export interface Codicon {
  name: string;       // codicon class suffix → render with <span className={`codicon codicon-${name}`} />
  aliases: string[];  // other short-names that map to the same glyph, kept so search matches them too
}

// Parse the package's CSV (columns: short_name,character,unicode) into one entry per distinct glyph.
// Many short-names share a glyph (add / plus / gist-new all map to EA60); we dedupe by unicode so the
// picker grid shows each glyph once — like VS Code — and fold the rest into `aliases` for search.
export const CODICONS: Codicon[] = (() => {
  const byCode = new Map<string, Codicon>();
  for (const line of codiconCsv.split("\n").slice(1)) { // slice off the header row
    const [name, , unicode] = line.split(",").map((s) => s.trim());
    if (!name || !unicode) continue;
    const existing = byCode.get(unicode);
    if (existing) existing.aliases.push(name);
    else byCode.set(unicode, { name, aliases: [] });
  }
  return [...byCode.values()];
})();

/** Filter the catalog by a substring of the icon's name or any of its aliases. Empty → everything. */
export function searchCodicons(query: string): Codicon[] {
  const q = query.trim().toLowerCase();
  if (!q) return CODICONS;
  return CODICONS.filter((c) => c.name.includes(q) || c.aliases.some((a) => a.includes(q)));
}
