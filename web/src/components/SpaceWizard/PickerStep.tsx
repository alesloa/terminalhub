import { useMemo, useState } from "react";

/** One selectable thing in a picker grid (a skill, command, or MCP server). */
export interface PickItem {
  id: string;                 // the value stored in config (skill folder / command / server name)
  title: string;              // headline shown on the card
  subtitle?: string | null;   // dim secondary line (folder name, transport, …)
  description?: string | null; // full blurb revealed by the `?` toggle
  category?: string;          // topic bucket for the left rail (server-classified)
}

// Display order of the known topic buckets in the rail; custom (frontmatter) buckets sort after
// these alphabetically and "Other" is always pinned last. Mirrors server CATEGORY_ORDER.
export const KNOWN_ORDER = ["Design", "Writing", "Git", "Code", "AI", "Media"];
export const ALL = "All";
export const OTHER = "Other";

/** A selectable card: name + short subtitle, a checkbox ring, and a `?` that expands the full
 *  description in place (the wizard pattern the user asked for). */
function PickCard({ item, selected, onToggle }: { item: PickItem; selected: boolean; onToggle: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`relative rounded-lg border p-3 cursor-pointer transition select-none
        ${selected ? "border-accent bg-accent/10" : "border-edge bg-[#1c1c1c] hover:border-accent/60"}`}
      onClick={onToggle}>
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 shrink-0 codicon ${selected ? "codicon-pass-filled text-accent" : "codicon-circle-large-outline text-muted"}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{item.title}</span>
            {item.description && (
              <button title="What is this?" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
                className={`shrink-0 grid place-items-center w-4 h-4 rounded-full border text-[10px] leading-none
                  ${open ? "border-accent text-accent" : "border-edge text-muted hover:text-bright"}`}>?</button>
            )}
          </div>
          {item.subtitle && <div className="text-xs text-dim truncate">{item.subtitle}</div>}
          {open && item.description && (
            <div className="mt-2 text-xs text-muted whitespace-pre-wrap border-t border-edge pt-2">{item.description}</div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Order the present categories for the rail: known buckets first (fixed order), then any custom
 *  frontmatter buckets alphabetically, then "Other" last. */
export function orderCategories(present: Set<string>): string[] {
  const known = KNOWN_ORDER.filter((c) => present.has(c));
  const custom = [...present].filter((c) => c !== OTHER && !KNOWN_ORDER.includes(c)).sort((a, b) => a.localeCompare(b));
  return [...known, ...custom, ...(present.has(OTHER) ? [OTHER] : [])];
}

/** A wizard step that picks many items from a catalog: a left topic rail (filter by category), a
 *  search box, a card grid, a live selected count, and an honest empty state (never a fake card)
 *  when the catalog is empty. */
export function PickerStep({ items, selected, onChange, emptyHint, searchPlaceholder }: {
  items: PickItem[];
  selected: string[];
  onChange: (next: string[]) => void;
  emptyHint: string;
  searchPlaceholder: string;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>(ALL);
  const sel = useMemo(() => new Set(selected), [selected]);

  // Per-category counts (over the whole catalog, independent of the search box) for the rail.
  const cats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of items) counts.set(i.category ?? OTHER, (counts.get(i.category ?? OTHER) ?? 0) + 1);
    return orderCategories(new Set(counts.keys())).map((name) => ({ name, count: counts.get(name) ?? 0 }));
  }, [items]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return items.filter((i) => {
      if (cat !== ALL && (i.category ?? OTHER) !== cat) return false;
      if (!t) return true;
      return i.title.toLowerCase().includes(t) ||
        (i.subtitle ?? "").toLowerCase().includes(t) ||
        (i.description ?? "").toLowerCase().includes(t);
    });
  }, [items, q, cat]);

  const toggle = (id: string) => onChange(sel.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  if (items.length === 0) {
    return (
      <div className="flex-1 grid place-items-center text-center text-sm text-dim px-6">
        <div>{emptyHint}</div>
      </div>
    );
  }

  const railBtn = (name: string, count: number) => (
    <button key={name} onClick={() => setCat(name)}
      className={`flex items-center justify-between gap-2 w-full px-2 py-1.5 rounded text-left text-sm transition
        ${cat === name ? "bg-accent/15 text-accent" : "text-muted hover:text-bright hover:bg-[#1c1c1c]"}`}>
      <span className="truncate">{name}</span>
      <span className={`shrink-0 text-[11px] tabular-nums ${cat === name ? "text-accent" : "text-dim"}`}>{count}</span>
    </button>
  );

  return (
    <div className="flex flex-col gap-3 min-h-0 flex-1">
      <div className="flex items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} spellCheck={false}
          className="flex-1 px-3 py-1.5 bg-[#1c1c1c] border border-edge rounded text-sm outline-none focus:border-accent" />
        <span className="text-xs text-dim shrink-0">{selected.length} selected</span>
        {selected.length > 0 && (
          <button onClick={() => onChange([])} className="text-xs text-muted hover:text-bright shrink-0">Clear</button>
        )}
      </div>
      <div className="flex gap-3 min-h-0 flex-1">
        {/* left topic rail — click a category to filter the grid */}
        <div className="w-32 shrink-0 overflow-auto pr-1 flex flex-col gap-0.5">
          {railBtn(ALL, items.length)}
          {cats.map((c) => railBtn(c.name, c.count))}
        </div>
        <div className="flex-1 min-h-0 overflow-auto grid grid-cols-2 gap-2 pr-1 content-start">
          {filtered.map((i) => <PickCard key={i.id} item={i} selected={sel.has(i.id)} onToggle={() => toggle(i.id)} />)}
          {filtered.length === 0 && (
            <div className="col-span-2 py-6 text-center text-sm text-dim">
              {q.trim() ? `Nothing matches "${q}".` : "Nothing in this category."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
