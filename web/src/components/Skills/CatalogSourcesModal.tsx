import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useEscape } from "../../hooks/useEscape";

/**
 * Manage the catalog sources Terminal Hub scans for SKILL.md folders. Add/remove sources and
 * reindex. Removing a source only drops its index entries — installed skills are untouched.
 */
export function CatalogSourcesModal({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const qc = useQueryClient();
  const [source, setSource] = useState("");

  const cat = useQuery({ queryKey: ["skills", "catalog", ""], queryFn: () => api.skills.catalog() });
  const sources = cat.data?.sources ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: ["skills", "catalog"] });

  const add = useMutation({
    mutationFn: (s: string) => api.skills.addCatalogSource(s),
    onSuccess: () => { setSource(""); invalidate(); },
  });
  const remove = useMutation({
    mutationFn: (s: string) => api.skills.removeCatalogSource(s),
    onSettled: invalidate,
  });
  const setOfficial = useMutation({
    mutationFn: (v: { source: string; official: boolean }) => api.skills.setCatalogSourceOfficial(v.source, v.official),
    onSettled: invalidate,
  });
  const reindex = useMutation({
    mutationFn: () => api.skills.reindexCatalog(),
    onSettled: invalidate,
  });

  const submit = () => { if (source.trim() && !add.isPending) add.mutate(source.trim()); };

  return createPortal(
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80]" onMouseDown={onClose}>
      <div className="bg-panel w-[480px] max-w-[92vw] max-h-[82vh] rounded-lg border border-edge flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-edge flex items-center justify-between">
          <span className="text-sm text-bright">Catalog sources</span>
          <button onClick={onClose} className="text-dim hover:text-fg text-sm">✕</button>
        </div>

        <div className="p-4 flex flex-col gap-3 min-h-0">
          <div className="flex gap-2">
            <input value={source} onChange={(e) => setSource(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder="owner/repo, https://… , or a local path"
              className="flex-1 px-2 py-1.5 rounded bg-canvas border border-edge text-xs text-fg outline-none focus:border-accent/60" />
            <button onClick={submit} disabled={!source.trim() || add.isPending}
              className="px-3 py-1.5 rounded bg-blue-600 text-xs text-white hover:bg-blue-500 disabled:opacity-40">
              {add.isPending ? "Adding…" : "Add"}
            </button>
          </div>
          {add.isError && <div className="text-[11px] text-red-400 break-words">{(add.error as Error).message}</div>}

          <div className="flex-1 min-h-0 overflow-auto border border-edge rounded">
            {sources.length === 0 && <div className="px-3 py-3 text-[11px] text-dim">No sources configured.</div>}
            {sources.map((s) => (
              <div key={s.source} className="px-3 py-2 border-b border-surface last:border-0 flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] text-fg truncate">{s.source}</div>
                  {s.error
                    ? <div className="text-[11px] text-red-400 break-words">index error: {s.error}</div>
                    : <div className="text-[11px] text-dim">{s.skillCount} skill{s.skillCount === 1 ? "" : "s"}{s.lastIndexedAt ? "" : " · not indexed"}</div>}
                </div>
                <label title="Mark this source's skills as ✓ Official"
                  className="flex items-center gap-1 text-[11px] text-dim shrink-0 cursor-pointer select-none">
                  <input type="checkbox" checked={s.official} disabled={setOfficial.isPending}
                    onChange={(e) => setOfficial.mutate({ source: s.source, official: e.target.checked })}
                    className="accent-emerald-500" />
                  Official
                </label>
                <button onClick={() => remove.mutate(s.source)} disabled={remove.isPending} title="Remove source"
                  className="text-dim hover:text-red-400 text-xs shrink-0 disabled:opacity-40">Remove</button>
              </div>
            ))}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-edge flex justify-between items-center">
          <button onClick={() => reindex.mutate()} disabled={reindex.isPending || sources.length === 0}
            className="px-3 py-1.5 bg-elevated rounded text-xs text-fg hover:bg-edge disabled:opacity-40">
            {reindex.isPending ? "Reindexing…" : "Reindex all"}
          </button>
          <button onClick={onClose} className="px-3 py-1.5 bg-elevated rounded text-xs text-fg">Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
