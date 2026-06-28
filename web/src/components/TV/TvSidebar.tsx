import { useState } from "react";
import type { TvFacets } from "../../api/types";
import type { TvFilters, TvMode } from "./store";
import { TvIcon, RadioIcon, YouTubeIcon, StarIcon } from "./icons";

interface Props {
  mode: TvMode;
  onMode: (m: TvMode) => void;
  tvCount: number;
  facets?: TvFacets;
  filters: TvFilters;
  onToggleArray: (key: "categories" | "countries" | "languages", value: string) => void;
  onToggleFavOnly: () => void;
  onToggleHd: () => void;
  favCount: number;
}

/** Left rail: SOURCES (mode switch, mirrors the title-bar tabs) + the TV facet filters (categories,
 *  countries, languages) + a Favorites toggle. Facet groups show the top entries with a "Show all". */
export function TvSidebar({ mode, onMode, tvCount, facets, filters, onToggleArray, onToggleFavOnly, onToggleHd, favCount }: Props) {
  return (
    <aside className="w-[212px] shrink-0 bg-panel border-r border-edge flex flex-col py-3 px-2.5 gap-1.5 overflow-auto">
      <GroupLabel>Sources</GroupLabel>
      <Nav icon={<TvIcon size={15} />} label="Live TV" count={tvCount.toLocaleString()} active={mode === "tv"} onClick={() => onMode("tv")} />
      <Nav icon={<RadioIcon size={15} />} label="Radio" active={mode === "radio"} onClick={() => onMode("radio")} />
      <Nav icon={<YouTubeIcon size={15} />} label="YouTube" active={mode === "youtube"} onClick={() => onMode("youtube")} />

      {mode === "tv" && facets && (
        <>
          {/* Channels store display NAMES for category + language (not iptv-org ids/codes), so the filter
              value is the NAME — countries DO match by code. Keep these keyed the way the data is shaped. */}
          <FacetGroup label="Categories" items={facets.categories.map((c) => ({ id: c.name, name: c.name, count: c.count }))}
            selected={filters.categories} onToggle={(v) => onToggleArray("categories", v)} />
          <FacetGroup label="Language" items={facets.languages.map((l) => ({ id: l.name, name: l.name, count: l.count }))}
            selected={filters.languages} onToggle={(v) => onToggleArray("languages", v)} />
          <FacetGroup label="Country" items={facets.countries.map((c) => ({ id: c.code, name: c.name, count: c.count, flag: c.flag }))}
            selected={filters.countries} onToggle={(v) => onToggleArray("countries", v)} />

          <GroupLabel>Quality</GroupLabel>
          <button onClick={onToggleHd}
            className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[12.5px] ${filters.hdOnly ? "text-bright" : "text-muted hover:bg-elevated hover:text-fg"}`}>
            <span className={`w-3.5 text-[11px] ${filters.hdOnly ? "text-accent" : "text-dim"}`}>{filters.hdOnly ? "✓" : ""}</span>
            HD only (720p+)
          </button>

          <GroupLabel>Favorites</GroupLabel>
          <button onClick={onToggleFavOnly}
            className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[12.5px] ${filters.favOnly ? "text-bright" : "text-muted hover:bg-elevated hover:text-fg"}`}>
            <StarIcon size={14} filled={filters.favOnly} className={filters.favOnly ? "text-accent" : ""} />
            My Channels
            <span className="ml-auto text-[10.5px] text-dim">{favCount}</span>
          </button>
        </>
      )}
    </aside>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[10.5px] font-bold tracking-wider text-dim px-2 pt-2.5 pb-1 uppercase">{children}</div>;
}

function Nav({ icon, label, count, active, onClick }: { icon: React.ReactNode; label: string; count?: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg font-medium text-left ${active ? "bg-elevated text-bright [&_.nico]:text-accent" : "text-muted hover:bg-elevated hover:text-fg"}`}>
      <span className="nico w-4 grid place-items-center text-muted">{icon}</span>
      <span className="flex-1">{label}</span>
      {count && <span className={`text-[11px] px-1.5 py-px rounded-full ${active ? "bg-surface text-muted" : "bg-elevated text-dim"}`}>{count}</span>}
    </button>
  );
}

interface FacetItem { id: string; name: string; count: number; flag?: string }

const CAP = 7;
function FacetGroup({ label, items, selected, onToggle }: { label: string; items: FacetItem[]; selected: string[]; onToggle: (v: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  // Always surface selected items even if they fall outside the top CAP.
  const head = items.slice(0, CAP);
  const shown = expanded ? items : [...head, ...items.filter((i) => selected.includes(i.id) && !head.includes(i))];
  return (
    <>
      <GroupLabel>{label}</GroupLabel>
      {shown.map((i) => {
        const sel = selected.includes(i.id);
        return (
          <button key={i.id} onClick={() => onToggle(i.id)}
            className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[12.5px] ${sel ? "text-bright" : "text-muted hover:bg-elevated hover:text-fg"}`}>
            {i.flag
              ? <span className="text-[14px] w-3.5">{i.flag}</span>
              : <span className={`w-3.5 text-[11px] ${sel ? "text-accent" : "text-dim"}`}>{sel ? "✓" : ""}</span>}
            <span className="truncate text-left flex-1">{i.name}</span>
            <span className="text-[10.5px] text-dim">{i.count.toLocaleString()}</span>
          </button>
        );
      })}
      {items.length > CAP && (
        <button onClick={() => setExpanded((e) => !e)} className="text-[11px] text-dim hover:text-fg px-2.5 py-1 text-left">
          {expanded ? "Show less" : `Show all ${items.length}`}
        </button>
      )}
    </>
  );
}
