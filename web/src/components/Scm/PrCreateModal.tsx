import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { AiProvider } from "../../api/types";
import { useToasts } from "../../store/toasts";
import { useGit } from "./useGit";
import { BranchFilterList } from "./BranchFilterList";
import { AiProviderSettings } from "./AiProviderSettings";
import { Popover, MenuItem, MenuSep } from "./parts";

/**
 * Centered "Create Pull Request" dialog (replaces the old ＋ popover). Mirrors GitHub's compose
 * view: a head→base branch row, a `via <provider> ▾` picker — the SAME provider list the commit-
 * message generator uses, so switching the active model or "Add Models…" both behave identically —
 * a title, and a description with a ✦ Generate button that writes the title + body from the branch's
 * commits + changed files via the editable PR prompt. Opened from the PRs tab ＋ and the GitHeader
 * menu's "Create Pull Request". Self-contained: does its own queries + create mutation so both
 * triggers share one flow. `gh`'s own errors ("must first push", "no commits between …") surface as
 * a toast via useGit.
 */
export function PrCreateModal({ rootPath, onClose }: { rootPath: string; onClose: () => void }) {
  const qc = useQueryClient();
  const push = useToasts(s => s.push);
  const { run, pending } = useGit();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [base, setBase] = useState<string | null>(null);
  const [draft, setDraft] = useState(false);
  const [baseOpen, setBaseOpen] = useState(false);
  const [providerMenu, setProviderMenu] = useState(false);
  const [aiSettings, setAiSettings] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, []);

  const { data: status } = useQuery({ queryKey: ["git", "status", rootPath], queryFn: () => api.git.status(rootPath), staleTime: 2000 });
  const { data: branchData } = useQuery({ queryKey: ["git", "branches", rootPath], queryFn: () => api.git.branches(rootPath), staleTime: 8000 });
  const { data: aiCfg } = useQuery({ queryKey: ["ai", "providers"], queryFn: () => api.ai.providers() });
  const { data: def } = useQuery({ queryKey: ["git", "default-branch", rootPath], queryFn: () => api.git.defaultBranch(rootPath), staleTime: 60_000 });

  const head = status?.branch ?? (status?.detached ? "detached HEAD" : "—");
  const branches = branchData?.branches ?? [];
  // Preselect the repo's default branch as the base once it loads (the user can still change it).
  useEffect(() => { if (base === null && def?.branch) setBase(def.branch); }, [def, base]);

  // The active provider: the chosen default if enabled, else the first enabled one — same logic the
  // commit-message generator uses, so the picker stays in sync with it.
  const enabledProviders = (aiCfg?.providers ?? []).filter(p => p.enabled);
  const activeId = enabledProviders.find(p => p.id === aiCfg?.defaultProviderId)?.id ?? enabledProviders[0]?.id ?? null;
  const activeLabel = enabledProviders.find(p => p.id === activeId)?.label;
  const switchProvider = (id: string) => {
    const providers = (aiCfg?.providers ?? []).map(({ apiKeySet, apiKeyFromEnv, ...rest }) => rest as AiProvider);
    api.ai.saveProviders(providers, id)
      .then(() => qc.invalidateQueries({ queryKey: ["ai"] }))
      .catch((e: Error) => push(e.message));
  };

  const generate = async () => {
    setGenerating(true); setGenError(null);
    try {
      const r = await api.ai.prDescription(rootPath, base ?? undefined);
      setTitle(r.title); setBody(r.body);
    } catch (e) {
      const msg = (e as Error).message;
      setGenError(msg);
      if (/no ai provider configured/i.test(msg)) setAiSettings(true);
    } finally {
      setGenerating(false);
    }
  };

  const create = () => {
    const t = title.trim();
    if (!t) { titleRef.current?.focus(); return; }
    run(() => api.git.github.prCreate(rootPath, { title: t, body: body.trim() || undefined, base: base ?? undefined, draft }), {
      onSuccess: (d) => { qc.invalidateQueries({ queryKey: ["git", "github"] }); push(`Opened ${(d as { url: string }).url || "pull request"}`); onClose(); },
    });
  };

  return (
    <div className="fixed inset-0 z-[55] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }}
        className="w-[560px] max-w-full max-h-[88vh] flex flex-col bg-canvas border border-edge rounded-lg shadow-xl">
        <div className="flex items-center justify-between px-4 h-11 shrink-0 border-b border-edge">
          <span className="text-sm text-fg">Create Pull Request</span>
          <button onClick={onClose} className="text-dim hover:text-fg">✕</button>
        </div>

        <div className="px-4 py-3 flex flex-col gap-3 overflow-auto">
          {/* head → base on the left; the AI provider picker on the right */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 text-sm">
              <span className="px-1.5 py-0.5 rounded bg-elevated border border-edge text-fg truncate max-w-[12rem]" title={head}>⎇ {head}</span>
              <span className="text-dim">→</span>
              <div className="relative">
                <button onClick={() => setBaseOpen(v => !v)} title="Base branch to merge into"
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-elevated border border-edge hover:bg-edge text-fg">
                  <span className="truncate max-w-[12rem]">{base ?? "default branch"}</span>
                  <span className="text-dim text-[10px] -translate-y-px">▾</span>
                </button>
                {baseOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setBaseOpen(false)} />
                    <div className="absolute z-50 left-0 top-8 w-64 bg-panel border border-edge rounded shadow-lg">
                      <BranchFilterList branches={branches} allowCreate={false} placeholder="Filter base branch…"
                        emptyLabel="No branches." onEscape={() => setBaseOpen(false)}
                        onPick={name => { setBase(name); setBaseOpen(false); }} />
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="relative shrink-0">
              <button onClick={() => setProviderMenu(v => !v)} title={activeLabel ? `AI: ${activeLabel} — switch model or add one` : "Choose an AI provider"}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-elevated text-dim hover:text-fg text-xs">
                <span>via {activeLabel ?? "AI"}</span>
                <span className="text-[10px] -translate-y-px">▾</span>
              </button>
              <Popover open={providerMenu} onClose={() => setProviderMenu(false)} className="right-0 top-7 w-56">
                {enabledProviders.map(p => (
                  <MenuItem key={p.id} onClick={() => { setProviderMenu(false); switchProvider(p.id); }}>
                    <span className="flex items-center gap-2">
                      <span className="w-3 text-blue-400">{p.id === activeId ? "✓" : ""}</span>
                      <span className="truncate">{p.label}</span>
                    </span>
                  </MenuItem>
                ))}
                {enabledProviders.length === 0 && <div className="px-3 py-1.5 text-xs text-dim">No providers yet</div>}
                <MenuSep />
                <MenuItem onClick={() => { setProviderMenu(false); setAiSettings(true); }}>Add Models…</MenuItem>
              </Popover>
            </div>
          </div>

          {/* title */}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] tracking-wide text-muted">Title</span>
            <input ref={titleRef} value={title} onChange={e => setTitle(e.target.value)} placeholder="Pull request title" spellCheck={false}
              className="w-full px-2 py-1.5 text-sm bg-panel border border-edge rounded outline-none focus:border-blue-500" />
          </label>

          {/* description + generate */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] tracking-wide text-muted">Description</span>
              <button onClick={generate} disabled={generating}
                title="Generate the title + description from this branch's commits and changed files"
                className={`flex items-center gap-1 px-2 h-6 rounded text-xs border border-edge-strong ${generating ? "bg-panel text-dim cursor-wait" : "bg-elevated hover:bg-edge text-fg"}`}>
                {generating
                  ? <span className="tr-dot-wave" role="status" aria-label="Generating PR description"><i /><i /><i /></span>
                  : <span>✦ Generate</span>}
              </button>
            </div>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={9} spellCheck={false}
              placeholder="Describe your changes, or press Generate"
              className="w-full px-2 py-1.5 text-sm bg-panel border border-edge rounded outline-none focus:border-blue-500 resize-y min-h-[6rem]" />
            {genError && (
              <div className="flex items-start gap-1.5 text-[11px] text-red-400" role="alert">
                <span className="leading-none">⚠</span><span className="min-w-0 break-words">{genError}</span>
              </div>
            )}
          </div>
        </div>

        {/* footer */}
        <div className="shrink-0 border-t border-edge px-4 py-3 flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-fg cursor-pointer select-none" title="Open as a draft pull request">
            <input type="checkbox" checked={draft} onChange={e => setDraft(e.target.checked)} className="accent-blue-500" /> Draft
          </label>
          <button onClick={() => setAiSettings(true)} className="ml-auto px-2 py-1.5 text-xs text-dim hover:text-fg">Edit Prompt…</button>
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded bg-elevated hover:bg-edge text-fg">Cancel</button>
          <button onClick={create} disabled={!title.trim() || pending}
            className={`px-3 py-1.5 text-sm rounded ${title.trim() && !pending ? "bg-blue-600 hover:bg-blue-500 text-white" : "bg-elevated text-dim cursor-not-allowed"}`}>
            Create PR
          </button>
        </div>

        {/* Mounted INSIDE the stop-propagation card so the settings backdrop click closes settings
            only — it never bubbles up to this modal's own backdrop onClose. */}
        {aiSettings && <AiProviderSettings onClose={() => setAiSettings(false)} />}
      </div>
    </div>
  );
}
