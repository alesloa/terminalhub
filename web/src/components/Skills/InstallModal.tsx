import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useEscape } from "../../hooks/useEscape";
import type { SkillCandidate, SkillScope, SkillScanResult } from "../../api/types";

/**
 * Two-phase install: paste a repo URL / owner-repo / local path → scan lists the skills inside →
 * tick the ones to install → Install copies them into the chosen scope. Opened blank from the
 * panel, or pre-seeded with a source (and an auto-scan) from a registry search result.
 */
export function InstallModal({ workspace, defaultScope, initialSource, preselect, onClose, onInstalled }: {
  workspace: string;
  defaultScope: SkillScope;
  initialSource?: string;
  preselect?: string[];
  onClose: () => void;
  onInstalled: () => void;
}) {
  useEscape(onClose);
  const [source, setSource] = useState(initialSource ?? "");
  const [scope, setScope] = useState<SkillScope>(defaultScope);
  const [scan, setScan] = useState<SkillScanResult | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set(preselect ?? []));

  const scanM = useMutation({
    mutationFn: (src: string) => api.skills.scan(src),
    onSuccess: (r) => {
      setScan(r);
      // default to everything (or the preselected names if they're present)
      const names = r.candidates.map((c) => c.name);
      setPicked(new Set(preselect?.length ? preselect.filter((n) => names.includes(n)) : names));
    },
  });
  const installM = useMutation({
    mutationFn: (r: SkillScanResult) =>
      api.skills.install(r.tmpId, [...picked], scope, scope === "workspace" ? workspace : undefined),
    onSuccess: () => { onInstalled(); onClose(); },
  });

  // Auto-scan when seeded from a registry result.
  useEffect(() => { if (initialSource) scanM.mutate(initialSource); /* eslint-disable-line */ }, []);

  const toggle = (name: string) =>
    setPicked((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; });

  const error = (scanM.error as Error | null)?.message || (installM.error as Error | null)?.message;

  return createPortal(
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80]" onMouseDown={onClose}>
      <div className="bg-panel w-[480px] max-w-[92vw] max-h-[82vh] rounded-lg border border-edge flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-edge flex items-center justify-between">
          <span className="text-sm text-bright">Install skills</span>
          <button onClick={onClose} className="text-dim hover:text-fg text-sm">✕</button>
        </div>

        <div className="p-4 flex flex-col gap-3 min-h-0">
          <div className="flex gap-2">
            <input value={source} onChange={(e) => setSource(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === "Enter" && source.trim()) scanM.mutate(source.trim()); }}
              placeholder="owner/repo, https://… , or a local path"
              className="flex-1 px-2 py-1.5 rounded bg-canvas border border-edge text-xs text-fg outline-none focus:border-accent/60" />
            <button onClick={() => scanM.mutate(source.trim())} disabled={!source.trim() || scanM.isPending}
              className="px-3 py-1.5 rounded bg-elevated text-xs text-fg hover:bg-edge disabled:opacity-40">
              {scanM.isPending ? "Scanning…" : "Scan"}
            </button>
          </div>

          {/* scope */}
          <div className="flex items-center gap-2 text-[11px] text-dim">
            <span>Install to</span>
            {(["workspace", "global"] as const).map((sc) => (
              <button key={sc} onClick={() => setScope(sc)}
                className={`px-2 py-0.5 rounded capitalize ${scope === sc ? "bg-elevated text-fg" : "text-dim hover:text-fg"}`}>
                {sc}
              </button>
            ))}
          </div>

          {error && <div className="text-[11px] text-red-400 break-words">{error}</div>}

          {scan && (
            <div className="flex-1 min-h-0 overflow-auto border border-edge rounded">
              {scan.candidates.length === 0 && <div className="px-3 py-3 text-[11px] text-dim">No skills found at that source.</div>}
              {scan.candidates.map((c: SkillCandidate) => (
                <label key={c.relPath} className="flex items-start gap-2 px-3 py-2 border-b border-surface last:border-0 cursor-pointer hover:bg-panel">
                  <input type="checkbox" checked={picked.has(c.name)} onChange={() => toggle(c.name)} className="mt-0.5 accent-blue-600" />
                  <span className="min-w-0">
                    <span className="block text-[12px] text-fg truncate">{c.name}</span>
                    <span className="block text-[11px] text-dim truncate">{c.description}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-edge flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 bg-elevated rounded text-xs text-fg">Cancel</button>
          <button onClick={() => scan && installM.mutate(scan)} disabled={!scan || picked.size === 0 || installM.isPending}
            className="px-3 py-1.5 bg-blue-600 rounded text-xs text-white hover:bg-blue-500 disabled:opacity-40">
            {installM.isPending ? "Installing…" : `Install${picked.size ? ` (${picked.size})` : ""}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
