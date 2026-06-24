import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { InstalledItem, InstallKind } from "../../api/types";
import { ALL, OTHER, orderCategories, type PickItem } from "./PickerStep";

// The per-workspace variant of a picker. "Installed here" (top) is everything ACTIVE for the agent in
// this folder, split into "In this workspace" (local — pinned to the folder's own files) and a
// collapsed "Active globally" (user-scope ~/.claude, active in every workspace). MCP is always local.
// "Available to install" (bottom) is catalog items not active yet. A global item's "Pin here" copies it
// into the folder so it's committed locally; it only moves up once the server re-read confirms disk.

const TIP_W = 340;

interface Anchor { x: number; y: number; w: number; h: number }
type Variant = "local" | "global" | "available";

/** Hover tooltip: the item's name on top, its description below. Portal'd to <body> (fixed,
 *  pointer-events-none) so the scroll container and the modal can't clip it; opens below the card,
 *  flipping above when there's no room. Mirrors the Board card tooltip. */
function ItemTooltip({ anchor, title, description }: { anchor: Anchor; title: string; description: string | null }) {
  const left = Math.max(8, Math.min(anchor.x, window.innerWidth - TIP_W - 8));
  const below = anchor.y + anchor.h + 6;
  const spaceBelow = window.innerHeight - below - 8;
  const openAbove = spaceBelow < 140;
  const pos = openAbove
    ? { left, bottom: window.innerHeight - anchor.y + 6, maxHeight: anchor.y - 16 }
    : { left, top: below, maxHeight: spaceBelow };
  return createPortal(
    <div style={{ position: "fixed", width: TIP_W, zIndex: 80, ...pos }}
      className="pointer-events-none overflow-hidden rounded-lg border border-edge-strong bg-panel shadow-2xl">
      <div className="px-3 py-2 border-b border-edge text-sm font-semibold text-bright whitespace-pre-wrap break-words">{title}</div>
      <div className="px-3 py-2 text-xs leading-relaxed text-fg whitespace-pre-wrap break-words">
        {description || <span className="text-dim">No description.</span>}
      </div>
    </div>,
    document.body,
  );
}

/** One catalog item. Hovering it (after a short dwell) pops the title+description tooltip. Local/global
 *  items show a green tick (global also a "Global" badge + a "Pin here" action); available items show an
 *  Install button. */
function ItemCard({ item, variant, busy, onAction }: {
  item: PickItem;
  variant: Variant;
  busy: boolean;
  onAction?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const [tip, setTip] = useState<Anchor | null>(null);

  const clear = () => { if (timer.current) { window.clearTimeout(timer.current); timer.current = null; } setTip(null); };
  const enter = () => {
    timer.current = window.setTimeout(() => {
      const r = ref.current?.getBoundingClientRect();
      if (r) setTip({ x: r.left, y: r.top, w: r.width, h: r.height });
    }, 300);
  };
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const installed = variant !== "available";
  return (
    <div ref={ref} onMouseEnter={enter} onMouseLeave={clear}
      className={`relative rounded-lg border p-3 select-none ${installed ? "border-green-500/40 bg-green-500/5" : "border-edge bg-[#1c1c1c]"}`}>
      <div className="flex items-center gap-2">
        {installed && <span className="shrink-0 codicon codicon-pass-filled text-green-400" aria-hidden />}
        <div className="min-w-0 flex-1">
          <span className="font-medium truncate block">{item.title}</span>
          {item.subtitle && <div className="text-xs text-dim truncate">{item.subtitle}</div>}
        </div>
        {variant === "global" && (
          <span title="Active in every workspace"
            className="shrink-0 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-white/10 text-dim">Global</span>
        )}
        {variant === "global" && onAction && (
          <button onClick={onAction} disabled={busy} title="Copy into this workspace's .claude folder so it's committed here"
            className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-[#1c1c1c] border border-edge hover:bg-white/10 disabled:opacity-50">
            <span className={`codicon ${busy ? "codicon-loading codicon-modifier-spin" : "codicon-pin"}`} aria-hidden />
            {busy ? "Pinning…" : "Pin here"}
          </button>
        )}
        {variant === "available" && (
          <button onClick={onAction} disabled={busy}
            className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50">
            <span className={`codicon ${busy ? "codicon-loading codicon-modifier-spin" : "codicon-add"}`} aria-hidden />
            {busy ? "Installing…" : "Install"}
          </button>
        )}
      </div>
      {tip && <ItemTooltip anchor={tip} title={item.title} description={item.description ?? null} />}
    </div>
  );
}

/** Two-section installer for one item kind (skills / commands / MCP). "Installed here" = active in this
 *  workspace (local pinned to the folder + global user-scope); "Available to install" = the rest. */
export function InstallerStep({ kind, catalog, installed, installing, onInstall, loading, searchPlaceholder, emptyHint }: {
  kind: InstallKind;
  catalog: PickItem[];
  installed: InstalledItem[];
  installing: Set<string>;
  onInstall: (name: string) => void;
  loading: boolean;
  searchPlaceholder: string;
  emptyHint: string;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>(ALL);
  const [globalOpen, setGlobalOpen] = useState(false); // "Active globally" collapsed by default
  const installedNames = useMemo(() => new Set(installed.map((i) => i.name)), [installed]);
  const byId = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog]);

  // An installed item maps to its catalog card when we have one, else a bare name card (a local-only
  // skill/server not in the global catalog still belongs in this workspace, so it's shown honestly).
  const card = (name: string): PickItem => byId.get(name) ?? { id: name, title: name };
  const localItems = useMemo(() => installed.filter((i) => i.scope === "local").map((i) => card(i.name)), [installed, byId]); // eslint-disable-line react-hooks/exhaustive-deps
  const globalItems = useMemo(() => installed.filter((i) => i.scope === "global").map((i) => card(i.name)), [installed, byId]); // eslint-disable-line react-hooks/exhaustive-deps
  const available = useMemo(() => catalog.filter((c) => !installedNames.has(c.id)), [catalog, installedNames]);

  // Category rail counts are over the installable (available) set only — the rail is for discovery.
  const cats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of available) counts.set(i.category ?? OTHER, (counts.get(i.category ?? OTHER) ?? 0) + 1);
    return orderCategories(new Set(counts.keys())).map((name) => ({ name, count: counts.get(name) ?? 0 }));
  }, [available]);

  const matchesSearch = (i: PickItem, t: string) =>
    !t || i.title.toLowerCase().includes(t) || (i.subtitle ?? "").toLowerCase().includes(t) || (i.description ?? "").toLowerCase().includes(t);

  const t = q.trim().toLowerCase();
  const shownLocal = useMemo(() => localItems.filter((i) => matchesSearch(i, t)), [localItems, t]);
  const shownGlobal = useMemo(() => globalItems.filter((i) => matchesSearch(i, t)), [globalItems, t]);
  const shownAvailable = useMemo(
    () => available.filter((i) => (cat === ALL || (i.category ?? OTHER) === cat) && matchesSearch(i, t)),
    [available, cat, t],
  );
  const busy = (name: string) => installing.has(`${kind}:${name}`);

  if (catalog.length === 0 && installed.length === 0) {
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
        <span className="text-xs text-dim shrink-0">{installed.length} installed</span>
      </div>
      <div className="flex gap-3 min-h-0 flex-1">
        {/* left rail filters the AVAILABLE list only */}
        <div className="w-32 shrink-0 overflow-auto pr-1 flex flex-col gap-0.5">
          {railBtn(ALL, available.length)}
          {cats.map((c) => railBtn(c.name, c.count))}
        </div>
        <div className="flex-1 min-h-0 overflow-auto pr-1 flex flex-col gap-5">
          {/* Installed here = local + global */}
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted flex items-center gap-2">
              <span className="codicon codicon-check-all text-green-400" aria-hidden /> Installed here
              <span className="text-dim font-normal normal-case tracking-normal">· {installed.length}</span>
            </h3>
            {loading ? (
              <div className="text-sm text-dim py-2">Reading the workspace folder…</div>
            ) : (
              <>
                {/* In this workspace (local, pinned to the folder) */}
                <div className="text-[11px] font-semibold uppercase tracking-wide text-dim">In this workspace · {localItems.length}</div>
                {shownLocal.length === 0 ? (
                  <div className="text-sm text-dim pb-1">
                    {localItems.length === 0 ? "Nothing pinned to this folder yet." : `Nothing here matches "${q}".`}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 content-start">
                    {shownLocal.map((i) => <ItemCard key={i.id} item={i} variant="local" busy={false} />)}
                  </div>
                )}

                {/* Active globally (user-scope ~/.claude) — collapsed by default so it can't flood */}
                {globalItems.length > 0 && (
                  <div className="flex flex-col gap-2 mt-1">
                    <button onClick={() => setGlobalOpen((v) => !v)}
                      className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-dim hover:text-bright w-fit">
                      <span className={`codicon ${globalOpen ? "codicon-chevron-down" : "codicon-chevron-right"}`} aria-hidden />
                      Active globally · {globalItems.length}
                    </button>
                    {globalOpen && (
                      shownGlobal.length === 0 ? (
                        <div className="text-sm text-dim pb-1">{`Nothing global matches "${q}".`}</div>
                      ) : (
                        <div className="grid grid-cols-2 gap-2 content-start">
                          {shownGlobal.map((i) => (
                            <ItemCard key={i.id} item={i} variant="global" busy={busy(i.id)} onAction={() => onInstall(i.id)} />
                          ))}
                        </div>
                      )
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          {/* Available to install (catalog items not active yet) */}
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Available to install</h3>
            {shownAvailable.length === 0 ? (
              <div className="text-sm text-dim py-2">
                {available.length === 0 ? "Everything in your global Claude config is already active here." : q.trim() ? `Nothing available matches "${q}".` : "Nothing in this category."}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 content-start">
                {shownAvailable.map((i) => (
                  <ItemCard key={i.id} item={i} variant="available" busy={busy(i.id)} onAction={() => onInstall(i.id)} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
      <p className="shrink-0 text-[11px] text-dim">
        Pin / install writes to this workspace's folder now — relaunch its terminals for a running agent to pick it up.
      </p>
    </div>
  );
}
