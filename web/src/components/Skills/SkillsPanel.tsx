import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { ConfirmDialog } from "../ConfirmDialog";
import { SkillCard } from "./SkillCard";
import { SkillViewerModal } from "./SkillViewerModal";
import { InstallModal } from "./InstallModal";
import { CatalogTab } from "./CatalogTab";
import type { InstalledSkill, RegistrySkill, SkillScope } from "../../api/types";

type UiScope = SkillScope | "all";
type Tab = "installed" | "catalog" | "search";

/** Lowercased folder + display names of every installed skill (both scopes), for "installed"
 *  badges on catalog/search results. */
function installedNameSet(skills: InstalledSkill[]): Set<string> {
  return new Set(skills.flatMap((s) => [s.name.toLowerCase(), s.displayName.toLowerCase()]));
}

/** Skills manager: install agent skills from git/registry, view, enable/disable, update, delete. */
export function SkillsPanel({ rootPath }: { rootPath: string }) {
  const qc = useQueryClient();
  const [scope, setScope] = useState<UiScope>("workspace");
  const [tab, setTab] = useState<Tab>("installed");
  const [updates, setUpdates] = useState<Record<string, boolean | null>>({});
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<InstalledSkill | null>(null);
  const [confirmDel, setConfirmDel] = useState<InstalledSkill | null>(null);
  const [installer, setInstaller] = useState<{ initialSource?: string; preselect?: string[] } | null>(null);

  const wsQ = useQuery({ queryKey: ["skills", "list", "workspace", rootPath], queryFn: () => api.skills.list("workspace", rootPath) });
  const glQ = useQuery({ queryKey: ["skills", "list", "global"], queryFn: () => api.skills.list("global") });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["skills", "list", "workspace", rootPath] });
    qc.invalidateQueries({ queryKey: ["skills", "list", "global"] });
  };
  const workspaceFor = (s: InstalledSkill) => (s.scope === "workspace" ? rootPath : undefined);
  const mark = (path: string, on: boolean) =>
    setBusy((b) => { const n = new Set(b); on ? n.add(path) : n.delete(path); return n; });

  const installed: InstalledSkill[] =
    scope === "workspace" ? wsQ.data?.skills ?? []
    : scope === "global" ? glQ.data?.skills ?? []
    : [...(wsQ.data?.skills ?? []), ...(glQ.data?.skills ?? [])];

  const updFor = (s: InstalledSkill) => (s.installPath in updates ? updates[s.installPath] : s.updateAvailable);
  const updatableCount = installed.filter((s) => updFor(s) === true).length;
  // Across both scopes — so catalog/search results can flag what's already installed anywhere.
  const installedNames = installedNameSet([...(wsQ.data?.skills ?? []), ...(glQ.data?.skills ?? [])]);

  const toggleEnabled = useMutation({
    mutationFn: (s: InstalledSkill) => { mark(s.installPath, true); return api.skills.setEnabled(s.installPath, !s.enabled, workspaceFor(s)); },
    onSettled: (_d, _e, s) => { mark(s.installPath, false); refresh(); },
  });
  const remove = useMutation({
    mutationFn: (s: InstalledSkill) => { mark(s.installPath, true); return api.skills.remove(s.installPath, workspaceFor(s)); },
    onSettled: (_d, _e, s) => { mark(s.installPath, false); setConfirmDel(null); refresh(); },
  });
  const update = useMutation({
    mutationFn: (s: InstalledSkill) => { mark(s.installPath, true); return api.skills.update(s.installPath, workspaceFor(s)); },
    onSuccess: (_d, s) => setUpdates((u) => ({ ...u, [s.installPath]: false })),
    onSettled: (_d, _e, s) => { mark(s.installPath, false); refresh(); },
  });
  const updateAll = useMutation({
    mutationFn: async () => {
      for (const s of installed.filter((x) => updFor(x) === true)) {
        await api.skills.update(s.installPath, workspaceFor(s));
        setUpdates((u) => ({ ...u, [s.installPath]: false }));
      }
    },
    onSettled: refresh,
  });
  const check = useMutation({
    mutationFn: async () => {
      const scopes: SkillScope[] = scope === "all" ? ["workspace", "global"] : [scope];
      const next: Record<string, boolean | null> = {};
      for (const sc of scopes) {
        const { updates: u } = await api.skills.checkUpdates(sc, sc === "workspace" ? rootPath : undefined);
        for (const row of u) next[row.installPath] = row.updateAvailable;
      }
      return next;
    },
    onSuccess: (next) => setUpdates((u) => ({ ...u, ...next })),
  });

  const loading = wsQ.isLoading || glQ.isLoading;
  const defaultInstallScope: SkillScope = scope === "global" ? "global" : "workspace";

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* header */}
      <div className="px-3 pt-2 pb-1 flex items-center justify-between">
        <span className="text-[11px] tracking-wide text-muted">SKILLS</span>
        <div className="flex items-center gap-2">
          <button onClick={() => check.mutate()} disabled={check.isPending} title="Check for updates"
            className="text-dim hover:text-fg text-xs leading-none disabled:opacity-40">{check.isPending ? "…" : "⟳"}</button>
          <button onClick={() => setInstaller({})} title="Install skills"
            className="text-muted hover:text-bright text-sm leading-none">+</button>
        </div>
      </div>

      {/* tabs */}
      <div className="px-2 flex gap-1">
        {(["installed", "catalog", "search"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 px-2 py-1 rounded text-xs capitalize ${tab === t ? "bg-elevated text-bright" : "text-dim hover:text-fg"}`}>
            {t}
            {t === "installed" && <span className="text-dim"> {installed.length}</span>}
            {t === "installed" && updatableCount > 0 && (
              <span className="ml-1 px-1 rounded bg-amber-500/20 text-amber-300 text-[10px] leading-none">{updatableCount}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "catalog" && (
        <CatalogTab
          installedNames={installedNames}
          onInstall={(source, name) => setInstaller({ initialSource: source, preselect: [name] })}
        />
      )}

      {tab === "installed" && (
        <>
          {/* scope switch */}
          <div className="px-2 pt-2 flex gap-1">
            {(["workspace", "global", "all"] as const).map((sc) => (
              <button key={sc} onClick={() => setScope(sc)}
                className={`flex-1 px-2 py-1 rounded text-[11px] capitalize ${scope === sc ? "bg-panel text-fg" : "text-dim hover:text-fg"}`}>
                {sc}
              </button>
            ))}
          </div>

          {/* updates banner */}
          {updatableCount > 0 && (
            <div className="mx-2 mt-2 px-2 py-1.5 rounded bg-amber-500/10 border border-amber-500/30 flex items-center justify-between">
              <span className="text-[11px] text-amber-300">{updatableCount} update{updatableCount > 1 ? "s" : ""} available</span>
              <button onClick={() => updateAll.mutate()} disabled={updateAll.isPending}
                className="text-[11px] text-amber-200 hover:text-amber-100 underline disabled:opacity-40">
                {updateAll.isPending ? "Updating…" : "Update all"}
              </button>
            </div>
          )}

          {/* list */}
          <div className="flex-1 min-h-0 overflow-auto mt-2">
            {loading && <div className="px-3 py-2 text-xs text-dim">loading skills…</div>}
            {!loading && installed.length === 0 && (
              <div className="px-3 py-4 text-xs text-dim leading-relaxed">
                No skills installed in this scope.
                <div className="mt-1 text-dim">Click <span className="text-dim">+</span> to install from a git repo, or use the Search tab.</div>
              </div>
            )}
            {installed.map((s) => (
              <SkillCard
                key={s.installPath}
                skill={s}
                updateAvailable={updFor(s) === true}
                busy={busy.has(s.installPath)}
                onView={() => setViewing(s)}
                onToggleEnabled={() => toggleEnabled.mutate(s)}
                onUpdate={() => update.mutate(s)}
                onDelete={() => setConfirmDel(s)}
              />
            ))}
          </div>
        </>
      )}

      {tab === "search" && (
        <SearchTab
          defaultScope={defaultInstallScope}
          installedNames={installedNames}
          onInstall={(r) => setInstaller({ initialSource: r.source, preselect: [r.skillId] })}
        />
      )}

      {viewing && <SkillViewerModal skill={viewing} workspace={rootPath} onClose={() => setViewing(null)} />}
      {installer && (
        <InstallModal
          workspace={rootPath}
          defaultScope={defaultInstallScope}
          initialSource={installer.initialSource}
          preselect={installer.preselect}
          onClose={() => setInstaller(null)}
          onInstalled={refresh}
        />
      )}
      {confirmDel && (
        <ConfirmDialog
          title="Delete skill?"
          body={`Delete “${confirmDel.displayName}” from disk? This removes the skill folder and can't be undone.`}
          confirmLabel="Delete"
          onConfirm={() => remove.mutate(confirmDel)}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
  );
}

// The Skills Hub seeds its empty "hot list" by searching this broad term, then sorting by
// install count — same trick the VS Code extension uses to show popular skills with no query.
const HOT_LIST_QUERY = "agent";

/** Registry search against skills.sh. Opens pre-populated with a popular "hot list"; typing a
 *  query searches live. Per-row install; already-installed skills are flagged. */
function SearchTab({ defaultScope, installedNames, onInstall }: {
  defaultScope: SkillScope;
  installedNames: Set<string>;
  onInstall: (r: RegistrySkill) => void;
}) {
  const [query, setQuery] = useState("");
  const [lastQuery, setLastQuery] = useState(HOT_LIST_QUERY);
  const search = useMutation({ mutationFn: (q: string) => api.skills.search(q) });

  const run = (q: string) => { const used = q.trim() || HOT_LIST_QUERY; setLastQuery(used); search.mutate(used); };
  // Pre-populate with the hot list on first open.
  useEffect(() => { run(HOT_LIST_QUERY); /* eslint-disable-next-line */ }, []);

  const isHot = lastQuery === HOT_LIST_QUERY && !query.trim();
  const results = isHot
    ? [...(search.data?.results ?? [])].sort((a, b) => b.installs - a.installs)
    : search.data?.results ?? [];

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-2 py-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search skills.sh…" autoFocus
          onKeyDown={(e) => { if (e.key === "Enter") run(query); }}
          className="w-full px-2 py-1 rounded bg-canvas border border-edge text-xs text-fg outline-none focus:border-accent/60" />
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {isHot && results.length > 0 && (
          <div className="px-3 pb-1 text-[10px] uppercase tracking-wide text-dim">Popular on skills.sh</div>
        )}
        {search.isPending && <div className="px-3 py-2 text-xs text-dim">searching…</div>}
        {search.isError && <div className="px-3 py-2 text-xs text-red-400">{(search.error as Error).message}</div>}
        {search.isSuccess && results.length === 0 && <div className="px-3 py-2 text-xs text-dim">No results.</div>}
        {results.map((r) => {
          const installed = installedNames.has(r.name.toLowerCase()) || installedNames.has(r.skillId.toLowerCase());
          return (
            <div key={r.id} className="group px-3 py-2 border-b border-surface flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-fg truncate">{r.name}</div>
                <div className="text-[11px] text-dim truncate">{r.source} · {r.installs.toLocaleString()} installs</div>
              </div>
              {installed ? (
                <span className="px-2 py-1 text-[11px] text-emerald-400/80 shrink-0">Installed</span>
              ) : (
                <button onClick={() => onInstall(r)} title={`Install to ${defaultScope}`}
                  className="px-2 py-1 rounded bg-elevated text-[11px] text-fg hover:bg-edge shrink-0">Install</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
