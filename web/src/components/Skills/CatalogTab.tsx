import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { CatalogSourcesModal } from "./CatalogSourcesModal";

/**
 * Catalog tab: a browsable local index of skills discovered across configured sources
 * (git repos / owner-repo / local paths). Filterable; per-row install; sources are managed
 * in a modal. Mirrors the VS Code extension's Catalog view.
 */
export function CatalogTab({ installedNames, onInstall }: {
  installedNames: Set<string>;
  onInstall: (source: string, name: string) => void;
}) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");
  const [manage, setManage] = useState(false);
  const [subTab, setSubTab] = useState<"official" | "unofficial">("official");

  const cat = useQuery({
    queryKey: ["skills", "catalog", filter],
    queryFn: () => api.skills.catalog(filter.trim() || undefined),
  });
  const reindex = useMutation({
    mutationFn: () => api.skills.reindexCatalog(),
    onSettled: () => qc.invalidateQueries({ queryKey: ["skills", "catalog"] }),
  });

  const entries = cat.data?.entries ?? [];
  const sources = cat.data?.sources ?? [];
  const hasSources = sources.length > 0;
  const errored = sources.filter((s) => s.error);
  const official = entries.filter((e) => e.official);
  const community = entries.filter((e) => !e.official);
  const shown = subTab === "official" ? official : community;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* filter + actions */}
      <div className="px-2 py-2 flex items-center gap-1">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter catalog…"
          className="flex-1 px-2 py-1 rounded bg-canvas border border-edge text-xs text-fg outline-none focus:border-accent/60" />
        <button onClick={() => reindex.mutate()} disabled={reindex.isPending || !hasSources} title="Reindex catalog sources"
          className="px-1.5 text-dim hover:text-fg text-xs leading-none disabled:opacity-40">{reindex.isPending ? "…" : "⟳"}</button>
        <button onClick={() => setManage(true)} title="Manage catalog sources"
          className="px-1.5 text-dim hover:text-fg text-sm leading-none">⚙</button>
      </div>

      {/* Official / Unofficial sub-tabs */}
      {!cat.isLoading && hasSources && entries.length > 0 && (
        <div className="px-2 pb-1 flex items-center gap-1 text-[11px]">
          {([["official", "Official", official.length], ["unofficial", "Unofficial", community.length]] as const).map(([key, label, n]) => (
            <button key={key} onClick={() => setSubTab(key)}
              className={`px-2 py-0.5 rounded ${subTab === key ? "bg-elevated text-bright" : "text-dim hover:text-fg"}`}>
              {key === "official" && <span className="text-emerald-400">✓ </span>}{label}
              <span className="ml-1 text-dim">{n}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        {cat.isLoading && <div className="px-3 py-2 text-xs text-dim">loading catalog…</div>}

        {!cat.isLoading && !hasSources && (
          <div className="px-3 py-4 text-xs text-dim leading-relaxed">
            No catalog sources yet.
            <div className="mt-1 text-dim">
              Add a git repo or local path of SKILL.md folders to build a browsable index.
            </div>
            <button onClick={() => setManage(true)}
              className="mt-2 px-2 py-1 rounded bg-blue-600 text-[11px] text-white hover:bg-blue-500">Add a source</button>
          </div>
        )}

        {!cat.isLoading && hasSources && entries.length === 0 && (
          <div className="px-3 py-4 text-xs text-dim leading-relaxed">
            {filter.trim() ? "No skills match that filter." : "Catalog index is empty."}
            {!filter.trim() && errored.length > 0 && (
              <div className="mt-2 space-y-1">
                {errored.map((s) => (
                  <div key={s.source} className="text-[11px] text-red-400 break-words">
                    <span className="text-dim">{s.source}</span> — {s.error}
                  </div>
                ))}
                <div className="text-dim">Fix or remove the source in ⚙, then reindex.</div>
              </div>
            )}
            {!filter.trim() && (
              <div className="mt-2 flex gap-2">
                <button onClick={() => reindex.mutate()} disabled={reindex.isPending}
                  className="px-2 py-1 rounded bg-blue-600 text-[11px] text-white hover:bg-blue-500 disabled:opacity-40">
                  {reindex.isPending ? "Reindexing…" : "Reindex catalog"}
                </button>
                <button onClick={() => setManage(true)}
                  className="px-2 py-1 rounded bg-elevated text-[11px] text-fg hover:bg-edge">Manage sources</button>
              </div>
            )}
          </div>
        )}

        {!cat.isLoading && entries.length > 0 && shown.length === 0 && (
          <div className="px-3 py-4 text-xs text-dim leading-relaxed">
            {subTab === "official"
              ? "No official skills. Mark a source ✓ Official in ⚙ and its skills land here."
              : "No unofficial skills."}
          </div>
        )}

        {shown.map((e) => {
          const installed = installedNames.has(e.name.toLowerCase());
          return (
            <div key={`${e.source}|${e.name}`} className="group px-3 py-2 border-b border-surface flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-fg truncate">{e.name}</div>
                {e.description && <div className="text-[11px] text-dim truncate">{e.description}</div>}
                {/* origin shown for official skills only — for community ones, who cares */}
                {e.official && <div className="text-[10px] text-dim truncate">from {e.source}</div>}
              </div>
              {installed ? (
                <span className="px-2 py-1 text-[11px] text-emerald-400/80 shrink-0">Installed</span>
              ) : (
                <button onClick={() => onInstall(e.source, e.name)} title="Install this skill"
                  className="px-2 py-1 rounded bg-elevated text-[11px] text-fg hover:bg-edge shrink-0">Install</button>
              )}
            </div>
          );
        })}
      </div>

      {manage && <CatalogSourcesModal onClose={() => setManage(false)} />}
    </div>
  );
}
