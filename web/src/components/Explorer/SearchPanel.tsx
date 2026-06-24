import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useRoom } from "../../store/room";
import type { SearchMatch } from "../../api/types";
import { SearchResults, matchKey } from "./SearchResults";

/** Debounce a value so the server isn't hit on every keystroke. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

const TOGGLES = [
  { key: "caseSensitive", label: "Aa", title: "Match case" },
  { key: "wholeWord", label: "ab", title: "Match whole word" },
  { key: "regexp", label: ".*", title: "Use regular expression" },
] as const;

/** A box/package glyph — the "build & dependency folders" exclude toggle. */
function BuildGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className="w-3.5 h-3.5" aria-hidden>
      <path d="M8 1.6l5.4 3v6.8L8 14.4 2.6 11.4V4.6L8 1.6z" />
      <path d="M2.6 4.6 8 7.6l5.4-3M8 7.6v6.8" />
    </svg>
  );
}

/** A gear glyph — the "system folders" exclude toggle (.git/.vscode/.idea). */
function SystemGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className="w-3.5 h-3.5" aria-hidden>
      <circle cx="8" cy="8" r="2.1" />
      <path d="M8 1.6v2M8 12.4v2M1.6 8h2M12.4 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M12.5 3.5l-1.4 1.4M4.9 11.1l-1.4 1.4" />
    </svg>
  );
}

// Default folder-exclusion toggles (both on by default). Blue = excluding that group; click to
// search inside them. An explicit "files to include" glob also opts a single folder back in.
const FOLDER_TOGGLES = [
  { key: "excludeBuild", title: "Exclude build & dependency folders (node_modules, dist, .next…)", Glyph: BuildGlyph },
  { key: "excludeSystem", title: "Exclude system folders (.git, .vscode, .idea…)", Glyph: SystemGlyph },
] as const;

/** VS Code-style find-in-files for the Explorer's current root. Searches file contents on the host
 *  (server walks the tree), lists hits grouped by file, and can replace a single match, a whole
 *  file, or everything. Input state lives in the room store so it survives switching the left tab. */
export function SearchPanel({ rootPath }: { rootPath: string }) {
  const search = useRoom((s) => s.search);
  const setSearch = useRoom((s) => s.setSearch);
  const qc = useQueryClient();

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // Debounce the params that trigger a server search (replace text is applied at click time, so it
  // isn't part of the key). Serialize so the effect compares by value, not object identity.
  const rawKey = JSON.stringify({
    root: rootPath, query: search.query,
    caseSensitive: search.caseSensitive, wholeWord: search.wholeWord, regexp: search.regexp,
    include: search.include.trim(), exclude: search.exclude.trim(),
    excludeBuild: search.excludeBuild, excludeSystem: search.excludeSystem,
  });
  const debouncedKey = useDebounced(rawKey, 250);
  const params = useMemo(() => JSON.parse(debouncedKey) as {
    root: string; query: string; caseSensitive: boolean; wholeWord: boolean; regexp: boolean;
    include: string; exclude: string; excludeBuild: boolean; excludeSystem: boolean;
  }, [debouncedKey]);
  const enabled = params.query.trim().length > 0;

  // A fresh search clears prior dismissals.
  useEffect(() => { setDismissed(new Set()); }, [debouncedKey]);

  const q = useQuery({
    queryKey: ["search", debouncedKey],
    queryFn: () => api.search(params),
    enabled,
    placeholderData: keepPreviousData,
  });
  const data = enabled ? q.data : undefined;

  // Visible = server results minus anything the user dismissed (dismissing a file drops all its
  // matches). Replace-all and the counts both operate on this, so dismissed hits are never touched.
  const visible = useMemo(() => {
    if (!data?.results) return [];
    return data.results
      .map((f) => ({ ...f, matches: f.matches.filter((m) => !dismissed.has(matchKey(f.path, m))) }))
      .filter((f) => f.matches.length > 0);
  }, [data, dismissed]);
  const totalVisible = visible.reduce((n, f) => n + f.matches.length, 0);

  const replaceMut = useMutation({
    mutationFn: (targets: { path: string; matches?: { line: number; col: number }[] }[]) =>
      api.searchReplace({
        query: params.query, replace: search.replace,
        caseSensitive: params.caseSensitive, wholeWord: params.wholeWord, regexp: params.regexp,
        targets,
      }),
    onSuccess: () => { setDismissed(new Set()); qc.invalidateQueries({ queryKey: ["search"] }); },
  });

  const replaceFile = (path: string) => replaceMut.mutate([{ path }]);
  const replaceMatch = (path: string, m: SearchMatch) => replaceMut.mutate([{ path, matches: [{ line: m.line, col: m.col }] }]);
  const replaceAll = () => { if (visible.length) replaceMut.mutate(visible.map((f) => ({ path: f.path }))); };

  const dismissMatch = (path: string, m: SearchMatch) =>
    setDismissed((prev) => new Set(prev).add(matchKey(path, m)));
  const dismissFile = (path: string) =>
    setDismissed((prev) => {
      const next = new Set(prev);
      data?.results.find((f) => f.path === path)?.matches.forEach((m) => next.add(matchKey(path, m)));
      return next;
    });

  const toggleFile = (path: string) =>
    setCollapsed((prev) => { const n = new Set(prev); n.has(path) ? n.delete(path) : n.add(path); return n; });
  const allCollapsed = visible.length > 0 && visible.every((f) => collapsed.has(f.path));
  const toggleCollapseAll = () => setCollapsed(allCollapsed ? new Set() : new Set(visible.map((f) => f.path)));
  const clear = () => { setSearch({ query: "", replace: "" }); setDismissed(new Set()); setCollapsed(new Set()); };

  const invalidRegex = !!data?.error;
  const noResults = enabled && !q.isLoading && !invalidRegex && totalVisible === 0;

  const inputCls = "w-full bg-canvas border rounded pl-2 pr-1 py-1 text-sm text-fg outline-none placeholder:text-dim";

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 px-2 pt-2 pb-1 flex flex-col gap-1">
        {/* Search + Replace, with the expand chevron spanning both like VS Code. */}
        <div className="flex items-start gap-1">
          <button title={search.showReplace ? "Collapse" : "Toggle Replace"}
            onClick={() => setSearch({ showReplace: !search.showReplace })}
            className="mt-1.5 px-0.5 rounded text-muted hover:bg-elevated hover:text-fg">
            <svg viewBox="0 0 16 16" fill="currentColor" className={`w-3 h-3 transition-transform ${search.showReplace ? "rotate-90" : ""}`}>
              <path d="M6 4l4 4-4 4z" />
            </svg>
          </button>
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <div className="relative">
              <input autoFocus value={search.query} spellCheck={false} placeholder="Search"
                onChange={(e) => setSearch({ query: e.target.value })}
                className={`${inputCls} pr-[5.5rem] ${invalidRegex ? "border-red-500/70" : "border-edge focus:border-blue-500"}`} />
              <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
                {TOGGLES.map((t) => (
                  <button key={t.key} title={t.title}
                    onClick={() => setSearch({ [t.key]: !search[t.key] } as any)}
                    className={`px-1 py-0.5 rounded text-xs font-mono leading-none ${
                      search[t.key] ? "bg-blue-600 text-white" : "text-muted hover:bg-elevated hover:text-fg"
                    }`}>{t.label}</button>
                ))}
              </div>
            </div>

            {search.showReplace && (
              <div className="relative">
                <input value={search.replace} spellCheck={false} placeholder="Replace"
                  onChange={(e) => setSearch({ replace: e.target.value })}
                  className={`${inputCls} pr-12 border-edge focus:border-blue-500`} />
                <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
                  <button title="Replace All" disabled={!visible.length || replaceMut.isPending} onClick={replaceAll}
                    className="px-1 py-0.5 rounded text-muted hover:bg-elevated hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent">
                    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.25">
                      <path d="M5 3v4.5M3 6l2 2 2-2M11 3v4.5M9 6l2 2 2-2" /><path d="M3.5 12.5h9" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Folder-exclusion toggles — blue when that group is being skipped (the default). */}
          <div className="mt-1 flex items-center gap-0.5">
            {FOLDER_TOGGLES.map((t) => (
              <button key={t.key} title={t.title}
                onClick={() => setSearch({ [t.key]: !search[t.key] } as any)}
                className={`p-1 rounded leading-none ${
                  search[t.key] ? "bg-blue-600 text-white" : "text-muted hover:bg-elevated hover:text-fg"
                }`}><t.Glyph /></button>
            ))}
          </div>

          <button title="Toggle search details (files to include/exclude)"
            onClick={() => setSearch({ showFilters: !search.showFilters })}
            className={`mt-1 px-1 rounded text-sm leading-none ${search.showFilters ? "text-fg bg-elevated" : "text-muted hover:bg-elevated hover:text-fg"}`}>⋯</button>
        </div>

        {search.showFilters && (
          <div className="flex flex-col gap-1 pl-5">
            <label className="text-[10px] uppercase tracking-wide text-dim">files to include</label>
            <input value={search.include} spellCheck={false} placeholder="e.g. *.ts, src/**"
              onChange={(e) => setSearch({ include: e.target.value })}
              className={`${inputCls} border-edge focus:border-blue-500`} />
            <label className="text-[10px] uppercase tracking-wide text-dim">files to exclude</label>
            <input value={search.exclude} spellCheck={false} placeholder="e.g. *.test.ts, **/dist/**"
              onChange={(e) => setSearch({ exclude: e.target.value })}
              className={`${inputCls} border-edge focus:border-blue-500`} />
          </div>
        )}

        {/* Summary + toolbar */}
        {enabled && (
          <div className="flex items-center gap-2 px-1 pt-0.5 text-xs text-dim">
            <span className="truncate">
              {invalidRegex ? <span className="text-red-400">Invalid regular expression</span>
                : q.isLoading ? "Searching…"
                : noResults ? "No results"
                : `${totalVisible} result${totalVisible === 1 ? "" : "s"} in ${visible.length} file${visible.length === 1 ? "" : "s"}${data?.truncated ? " (truncated)" : ""}`}
            </span>
            <span className="ml-auto flex items-center gap-1 shrink-0">
              {visible.length > 0 && (
                <button title={allCollapsed ? "Expand all" : "Collapse all"} onClick={toggleCollapseAll}
                  className="w-5 h-5 grid place-items-center rounded hover:bg-elevated hover:text-fg">{allCollapsed ? "⊞" : "⊟"}</button>
              )}
              <button title="Clear search" onClick={clear}
                className="w-5 h-5 grid place-items-center rounded hover:bg-elevated hover:text-fg">⌫</button>
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto pb-2">
        {visible.length > 0 && (
          <SearchResults
            results={visible} rootPath={rootPath} canReplace={search.showReplace}
            collapsed={collapsed} onToggle={toggleFile}
            onReplaceFile={replaceFile} onReplaceMatch={replaceMatch}
            onDismissFile={dismissFile} onDismissMatch={dismissMatch} />
        )}
        {!enabled && (
          <div className="px-3 py-2 text-xs text-dim">Type to search file contents in this folder.</div>
        )}
      </div>
    </div>
  );
}
