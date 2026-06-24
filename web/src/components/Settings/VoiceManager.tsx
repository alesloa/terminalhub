import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { KeptVoice } from "../../api/types";
import { useUi } from "../../store/ui";
import { useVoices, speak } from "../../lib/speech";
import { baseLang, langLabel } from "../../lib/langName";

// macOS ships many voices in two tiers: a compact default and a higher-quality download whose name
// carries "(Enhanced)" or "(Premium)". That suffix is the only signal the Web Speech API exposes, so
// we key the quality filter off it. Source is split by `localService`: on-device (Apple) vs online
// (Chrome's network voices — the "Google …" ones).
const isEnhanced = (name: string) => /\((?:enhanced|premium)\)/i.test(name);
// HD tier = Apple's Enhanced/Premium downloads OR Google's online voices (the network ones are the
// other high-quality option). The Quality → Enhanced filter and the HD badge both key off this.
const isHd = (v: SpeechSynthesisVoice) => isEnhanced(v.name) || !v.localService;

type Quality = "all" | "enhanced" | "standard";
type Source = "all" | "device" | "online";
type Lite = { name: string; lang: string };

const uniqByName = (vs: Lite[]): Lite[] => {
  const m = new Map<string, Lite>();
  for (const v of vs) if (!m.has(v.name)) m.set(v.name, v);
  return [...m.values()];
};

/**
 * Curate the AGENT VOICE POOL — the voices a coding agent can pick from so it can sound different per
 * message (and you can tell which agent is talking). The browser enumerates the OS's installed voices
 * (so the list mirrors the computer running THIS browser, not the server), and the kept set is
 * mirrored to the server (PUT /api/voices) so it survives reloads AND can be read by an agent
 * (GET /api/voices) that wants to pick a voice to "be".
 *
 * Two-pane shuttle: the LEFT pane is every installed voice you haven't added yet (searchable +
 * filterable by source/quality/language, since devices ship 100+); the RIGHT pane is the pool. Select
 * voices and move them across with the center buttons (or double-click a row, or ✕ a pooled one). A
 * voice in the pool never shows on the left; remove it and it returns there.
 *
 * Storage convention: the kept list IS the pool. An empty pool means agents omit a voice, so their
 * messages fall back to your notification voice (see the top of Settings → Voice & Speech).
 */
export function VoiceManager() {
  const qc = useQueryClient();
  const system = useVoices();
  const voiceRate = useUi((s) => s.voiceRate);
  const voiceVolume = useUi((s) => s.voiceVolume);
  const { data } = useQuery({ queryKey: ["voices"], queryFn: api.voices.list });
  const kept = data?.voices ?? [];
  const keptSet = useMemo(() => new Set(kept.map((v) => v.name)), [kept]);

  const save = useMutation({
    mutationFn: (voices: KeptVoice[]) => api.voices.save(voices),
    onMutate: (voices) => { qc.setQueryData(["voices"], { voices }); }, // optimistic — moves feel instant
    onSettled: () => { qc.invalidateQueries({ queryKey: ["voices"] }); },
  });
  const busy = save.isPending;
  const addToPool = (voices: Lite[]) =>
    save.mutate(uniqByName([...kept, ...voices]).map((v) => ({ name: v.name, lang: v.lang })));
  const removeFromPool = (names: Set<string>) => save.mutate(kept.filter((k) => !names.has(k.name)));

  // Per-pane selection (voice names). Click toggles; the center buttons move the selection across.
  const [selLeft, setSelLeft] = useState<Set<string>>(new Set());
  const [selRight, setSelRight] = useState<Set<string>>(new Set());
  const toggle = (set: Set<string>, setSet: (s: Set<string>) => void, name: string) => {
    const next = new Set(set);
    next.has(name) ? next.delete(name) : next.add(name);
    setSet(next);
  };

  // Left-pane filters (the pool is small, so only the available list needs them). All AND-ed; `sel`
  // is the set of selected base languages (empty = every language).
  const [query, setQuery] = useState("");
  // Chrome ignores autocomplete="off" and, once it has a credential saved for this origin, drops its
  // password dropdown onto any text field you FOCUS — the readOnly trick only blocks fill on load, not
  // that on-focus dropdown. The off-screen decoy username/password pair below absorbs Chrome's
  // credential binding so this real search box is left alone.
  const [searchArmed, setSearchArmed] = useState(true);
  const [quality, setQuality] = useState<Quality>("all");
  const [source, setSource] = useState<Source>("all");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toggleSel = (base: string) => toggle(sel, setSel, base);
  const filterActive = !!query.trim() || quality !== "all" || source !== "all" || sel.size > 0;
  const resetFilters = () => { setQuery(""); setQuality("all"); setSource("all"); setSel(new Set()); };

  // Available = every installed voice NOT already in the pool.
  const available = useMemo(() => system.filter((v) => !keptSet.has(v.name)), [system, keptSet]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => available.filter((v) => {
    if (q && !v.name.toLowerCase().includes(q)) return false;
    if (quality === "enhanced" && !isHd(v)) return false;
    if (quality === "standard" && isHd(v)) return false;
    if (source === "device" && !v.localService) return false;
    if (source === "online" && v.localService) return false;
    return true;
  }), [available, q, quality, source]);
  const shownAvail = sel.size ? filtered.filter((v) => sel.has(baseLang(v.lang))) : filtered;

  // Language pills — every available language; counts reflect the active search + quality + source.
  const langNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of available) { const b = baseLang(v.lang); if (!m.has(b)) m.set(b, langLabel(v.lang)); }
    return m;
  }, [available]);
  const pills = useMemo(() => {
    const count = new Map<string, number>();
    for (const v of filtered) { const b = baseLang(v.lang); count.set(b, (count.get(b) ?? 0) + 1); }
    return [...langNames].map(([base, name]) => ({ base, name, count: count.get(base) ?? 0 }))
      .sort((a, b) => (a.count === 0 ? 1 : 0) - (b.count === 0 ? 1 : 0) || a.name.localeCompare(b.name));
  }, [langNames, filtered]);

  // Available, grouped by base language for a scannable list.
  const availGroups = useMemo(() => {
    const m = new Map<string, SpeechSynthesisVoice[]>();
    for (const v of shownAvail) { const b = baseLang(v.lang); const arr = m.get(b); if (arr) arr.push(v); else m.set(b, [v]); }
    return [...m.entries()]
      .map(([base, vs]) => ({ base, name: langLabel(vs[0].lang), voices: vs.slice().sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [shownAvail]);

  // The pool, sorted by language then name. A kept voice not installed on THIS device still shows
  // (so you can remove it), just without a preview.
  const poolItems = useMemo(() =>
    kept.map((k) => ({ name: k.name, lang: k.lang, voice: system.find((v) => v.name === k.name) }))
      .sort((a, b) => langLabel(a.lang).localeCompare(langLabel(b.lang)) || a.name.localeCompare(b.name)),
    [kept, system]);

  const moveRight = () => {
    if (!selLeft.size) return;
    addToPool(available.filter((v) => selLeft.has(v.name)).map((v) => ({ name: v.name, lang: v.lang })));
    setSelLeft(new Set());
  };
  const moveLeft = () => {
    if (!selRight.size) return;
    removeFromPool(selRight);
    setSelRight(new Set());
  };
  const addAllShown = () => { if (shownAvail.length) { addToPool(shownAvail.map((v) => ({ name: v.name, lang: v.lang }))); setSelLeft(new Set()); } };
  const clearPool = () => { if (kept.length) { save.mutate([]); setSelRight(new Set()); } };

  return (
    <section className="space-y-3">
      <h2 className="text-xs uppercase tracking-wide text-dim">Agent voice pool</h2>
      <div className="text-xs text-dim">
        The voices an agent can choose from to sound different per message — it reads them via{" "}
        <code className="rounded bg-canvas px-1 py-0.5 font-mono text-[11px] text-fg">curl …/api/voices</code>.
        Pick voices installed on this computer (left) into the pool (right). An empty pool → agents speak in your notification voice.
      </div>

      <details className="group rounded border border-edge bg-canvas/50 px-3 py-2">
        <summary className="flex cursor-pointer select-none list-none items-center text-xs text-muted hover:text-fg">
          <span className="mr-1.5 inline-block transition-transform group-open:rotate-90">▸</span>
          Don't see a voice / want Enhanced (HD) voices?
        </summary>
        <div className="mt-2 space-y-2 text-xs leading-relaxed text-dim">
          <p>This list shows the voices installed on <em>the computer running this browser</em> — Terminal Hub can't add voices, only curate what's there. <strong>Enhanced</strong>/<strong>Premium</strong> voices (the <span className="rounded bg-accent/15 px-1 text-[9px] font-medium uppercase tracking-wide text-accent">HD</span> ones) are higher-quality downloads, per language. You likely only see Enhanced Spanish because that's all you've downloaded.</p>
          <p className="font-medium text-fg">Add more on macOS:</p>
          <ol className="list-decimal space-y-1 pl-4">
            <li>System Settings → <strong>Accessibility</strong> → <strong>Spoken Content</strong>.</li>
            <li>Click the <strong>System voice</strong> dropdown → <strong>Manage Voices…</strong></li>
            <li>Expand a language (e.g. <strong>English</strong>), tick the <strong>(Enhanced)</strong> voices, download.</li>
            <li>Back here, <strong>hard-refresh</strong> (⌘⇧R) — they'll appear under that language.</li>
          </ol>
          <p>Your region (e.g. Mexico / es-MX) doesn't limit which languages you can install — it only sets the default naming. Online voices (Source → Online) are Google's cloud voices and need internet.</p>
        </div>
      </details>

      {system.length === 0 ? (
        <div className="text-xs text-dim">No system voices found yet — they may still be loading.</div>
      ) : (
        <>
          {/* Search + filters for the AVAILABLE (left) pane. */}
          <div className="relative">
            {/* Off-screen decoys: Chrome binds its saved-credential autofill to the first
                username/password pair it finds, leaving the real search box below untouched. */}
            <input type="text" name="username" autoComplete="username" tabIndex={-1} aria-hidden="true"
              className="absolute h-px w-px opacity-0" style={{ left: "-9999px", top: 0 }} />
            <input type="password" name="password" autoComplete="current-password" tabIndex={-1} aria-hidden="true"
              className="absolute h-px w-px opacity-0" style={{ left: "-9999px", top: 0 }} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              readOnly={searchArmed}
              onFocus={() => setSearchArmed(false)}
              placeholder="Search available voices by name…"
              name="voice-filter"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-1p-ignore="true"
              data-lpignore="true"
              data-form-type="other"
              className="w-full rounded border border-edge-strong bg-canvas px-2 py-1 pr-7 text-bright outline-none focus:border-blue-500"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search"
                className="absolute inset-y-0 right-0 flex w-7 items-center justify-center text-dim hover:text-fg">×</button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-dim">
            <span className="flex items-center gap-1.5">
              <span className="uppercase tracking-wide">Source</span>
              <Segmented value={source} onChange={(v) => setSource(v as Source)}
                options={[["all", "All"], ["device", "On-device"], ["online", "Online"]]} />
            </span>
            <span className="flex items-center gap-1.5">
              <span className="uppercase tracking-wide">Quality</span>
              <Segmented value={quality} onChange={(v) => setQuality(v as Quality)}
                options={[["all", "All"], ["enhanced", "Enhanced"], ["standard", "Standard"]]} />
            </span>
            {filterActive && <button type="button" onClick={resetFilters} className="ml-auto text-dim hover:text-fg">Reset filters</button>}
          </div>

          {pills.length > 0 && (
            <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
              {pills.map((p) => {
                const on = sel.has(p.base);
                return (
                  <button key={p.base} type="button" onClick={() => toggleSel(p.base)} title={`Filter to ${p.name}`}
                    className={`rounded-full px-2.5 py-1 text-xs transition ${
                      on ? "bg-accent/20 text-bright ring-1 ring-accent"
                        : p.count === 0 ? "bg-surface/40 text-dim hover:bg-surface"
                        : "bg-surface text-fg hover:bg-elevated"}`}>
                    {p.name} <span className="tabular-nums opacity-60">{p.count}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* The two panes + the move buttons between them. */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            {/* AVAILABLE */}
            <div className="flex h-full flex-col">
              <div className="mb-1 flex items-center justify-between px-1 text-[10px] uppercase tracking-wide text-dim">
                <span>Available</span>
                <span className="tabular-nums">{shownAvail.length}{shownAvail.length !== available.length ? ` / ${available.length}` : ""}</span>
              </div>
              <div className="h-64 space-y-2 overflow-y-auto rounded border border-edge bg-canvas/40 p-2">
                {availGroups.length === 0 ? (
                  <div className="px-1.5 py-6 text-center text-xs text-dim">
                    {available.length === 0 ? "Every installed voice is in the pool." : "No voices match these filters."}
                  </div>
                ) : availGroups.map((g) => (
                  <div key={g.base} className="space-y-1">
                    <div className="px-1.5 text-[11px] font-medium uppercase tracking-wide text-fg">{g.name}</div>
                    {g.voices.map((v) => (
                      <ShuttleRow key={v.name} name={v.name} lang={v.lang} voice={v} rate={voiceRate} volume={voiceVolume}
                        selected={selLeft.has(v.name)}
                        onToggle={() => toggle(selLeft, setSelLeft, v.name)}
                        onMove={() => addToPool([{ name: v.name, lang: v.lang }])} />
                    ))}
                  </div>
                ))}
              </div>
              <button type="button" onClick={addAllShown} disabled={busy || !shownAvail.length}
                className="mt-1.5 rounded bg-surface px-2.5 py-1 text-xs text-fg hover:bg-elevated disabled:opacity-50">
                Add all shown →
              </button>
            </div>

            {/* MOVE */}
            <div className="flex flex-col items-center justify-center gap-2 px-1">
              <button type="button" onClick={moveRight} disabled={busy || !selLeft.size} title="Add selected to the pool" aria-label="Add selected to the pool"
                className="rounded border border-edge-strong bg-surface px-2.5 py-2 text-fg hover:bg-elevated disabled:opacity-40">→</button>
              <button type="button" onClick={moveLeft} disabled={busy || !selRight.size} title="Remove selected from the pool" aria-label="Remove selected from the pool"
                className="rounded border border-edge-strong bg-surface px-2.5 py-2 text-fg hover:bg-elevated disabled:opacity-40">←</button>
            </div>

            {/* POOL */}
            <div className="flex h-full flex-col">
              <div className="mb-1 flex items-center justify-between px-1 text-[10px] uppercase tracking-wide text-dim">
                <span>Agent pool</span>
                <span className="tabular-nums">{poolItems.length}</span>
              </div>
              <div
                tabIndex={poolItems.length ? 0 : -1}
                onKeyDown={(e) => { if ((e.key === "Delete" || e.key === "Backspace") && selRight.size) { e.preventDefault(); moveLeft(); } }}
                className="h-64 space-y-1 overflow-y-auto rounded border border-edge bg-canvas/40 p-2 outline-none focus:border-edge-strong">
                {poolItems.length === 0 ? (
                  <div className="px-1.5 py-6 text-center text-xs text-dim">No voices yet. Pick some on the left — until then agents speak in your notification voice.</div>
                ) : poolItems.map((p) => (
                  <ShuttleRow key={p.name} name={p.name} lang={p.lang} voice={p.voice} rate={voiceRate} volume={voiceVolume}
                    selected={selRight.has(p.name)}
                    onToggle={() => toggle(selRight, setSelRight, p.name)}
                    onMove={() => removeFromPool(new Set([p.name]))}
                    removable />
                ))}
              </div>
              <button type="button" onClick={clearPool} disabled={busy || !poolItems.length}
                className="mt-1.5 rounded bg-surface px-2.5 py-1 text-xs text-fg hover:bg-elevated disabled:opacity-50">
                Clear pool
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/** One voice row in either pane. The label area toggles selection (double-click moves it across);
 *  ▶ previews the voice; on the pool side a ✕ removes just that one. */
function ShuttleRow({ name, lang, voice, selected, onToggle, onMove, rate, volume, removable }: {
  name: string; lang: string; voice?: SpeechSynthesisVoice; selected: boolean;
  onToggle: () => void; onMove: () => void; rate: number; volume: number; removable?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 rounded px-1.5 py-1 pl-2 ${selected ? "bg-accent/20 ring-1 ring-accent" : "hover:bg-surface/60"}`}>
      <button type="button" onClick={onToggle} onDoubleClick={onMove}
        className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className="truncate text-fg">{name}{voice?.default ? " · default" : ""}</span>
        {voice && isHd(voice) && (
          <span className="shrink-0 rounded bg-accent/15 px-1 text-[9px] font-medium uppercase tracking-wide text-accent">HD</span>
        )}
        {voice && !voice.localService && (
          <span className="shrink-0 rounded bg-surface px-1 text-[9px] font-medium uppercase tracking-wide text-dim">online</span>
        )}
        <span className="shrink-0 text-[10px] tabular-nums text-dim">{lang}</span>
      </button>
      <button
        type="button"
        disabled={!voice}
        onClick={() => voice && speak(`This is ${name}.`, name, rate, volume)}
        title={voice ? `Listen to ${name}` : "Not installed on this device"}
        aria-label={voice ? `Listen to ${name}` : "Not installed on this device"}
        className="shrink-0 rounded bg-surface px-2 py-0.5 text-xs text-fg hover:bg-elevated disabled:opacity-30">▶</button>
      {removable && (
        <button type="button" onClick={onMove} title={`Remove ${name} from the pool`} aria-label={`Remove ${name} from the pool`}
          className="shrink-0 rounded px-1.5 text-dim hover:text-fg">×</button>
      )}
    </div>
  );
}

/** A compact segmented toggle: [value,label] options, active one highlighted. */
function Segmented({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="flex rounded border border-edge-strong bg-canvas p-0.5">
      {options.map(([val, label]) => (
        <button key={val} type="button" onClick={() => onChange(val)}
          className={`rounded px-2 py-1 text-xs ${value === val ? "bg-edge-strong text-bright" : "text-dim hover:text-fg"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}
