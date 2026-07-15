import { copyText } from "../../lib/clipboard";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { GitFileEntry, GitStatus, AiProvider, SubmoduleEntry } from "../../api/types";
import { useRoom } from "../../store/room";
import { useToasts } from "../../store/toasts";
import { useCommitDraft } from "../../store/commitDraft";
import { confirmModal } from "../../store/confirm";
import { useGit } from "./useGit";
import { base, dir, badge, Popover, MenuItem, MenuSep, FolderIcon } from "./parts";
import { AiProviderSettings } from "./AiProviderSettings";
import { FileContextMenu, type FileMenuEntry } from "./FileContextMenu";
import { gitignoreMenuItem, ignoreScopeLabel } from "../../lib/gitignore";
import { isLocalHost, revealLabel } from "../../lib/host";
import { startPathDrag } from "../../lib/dragImage";

/** Where a file row sits — drives Stage vs Unstage and the diff side. */
type RowKind = "staged" | "work" | "conflict";
interface FileMenuState { x: number; y: number; entry: GitFileEntry; kind: RowKind; untracked: boolean }

/**
 * The commit box (message + AI generate + a Commit split-button) over the staged/unstaged
 * file list. When nothing is staged the button auto-stages tracked changes ("Commit Tracked",
 * = stage `status.unstaged` then commit); when something is staged it commits exactly that.
 */
export function ChangesSection({ rootPath, onOpenSubmodule }: { rootPath: string; onOpenSubmodule?: (absPath: string) => void }) {
  const { run, pending } = useGit();
  const qc = useQueryClient();
  const openDiff = useRoom(s => s.openDiff);
  const openFile = useRoom(s => s.openFile);
  const revealInExplorer = useRoom(s => s.revealInExplorer);
  const setScmTab = useRoom(s => s.setScmTab);
  const push = useToasts(s => s.push);
  const [fileMenu, setFileMenu] = useState<FileMenuState | null>(null);
  const [bgMenu, setBgMenu] = useState<{ x: number; y: number } | null>(null); // right-click the empty area below the list
  // Multi-select: a set of selected row paths + the anchor for Shift-range. Cmd/Ctrl-click toggles
  // a row, Shift-click selects a range, a plain click collapses to one row (and opens its diff).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchorRef = useRef<string | null>(null);
  // The commit message, ✨ generation status, and last generate error live in a per-repo store (keyed
  // by rootPath) — NOT local state — so switching the side bar to the File Explorer and back doesn't
  // tear down an in-flight generation or wipe the draft. See store/commitDraft.ts.
  const msg = useCommitDraft(s => s.drafts[rootPath]?.msg ?? "");
  const generating = useCommitDraft(s => s.drafts[rootPath]?.generating ?? false);
  const genError = useCommitDraft(s => s.drafts[rootPath]?.genError ?? null);
  const setMsg = useCommitDraft(s => s.setMsg);
  const clearError = useCommitDraft(s => s.clearError);
  const resetDraft = useCommitDraft(s => s.reset);
  const runGenerate = useCommitDraft(s => s.generate);

  // The commit box is an UNCONTROLLED textarea (defaultValue + ref), not `value={msg}`. A controlled
  // value is reasserted from React state on every keystroke, which wipes the browser's own undo/redo
  // stack — so Cmd/Ctrl+Z, Ctrl+Y / Cmd+Shift+Z, Cmd/Ctrl+A etc. did nothing. Uncontrolled hands the
  // field's edit history back to the browser, so all the native text shortcuts just work. onChange
  // still mirrors each keystroke into the store (the Commit button + `canCommit` read `msg`).
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Push an EXTERNAL msg change into the box: AI ✨ generate, post-commit reset, or switching repos
  // (rootPath changes → a different draft). During plain typing the box already holds `msg` (onChange
  // synced it), so `ta.value === msg` and this is a no-op — which is exactly what preserves the undo
  // history. Only an outside value diverges, and writing it via the DOM (which resets undo) is fine there.
  useEffect(() => {
    const ta = taRef.current;
    if (ta && ta.value !== msg) ta.value = msg;
  }, [msg]);

  const [expanded, setExpanded] = useState(false);
  const [commitMenu, setCommitMenu] = useState(false);
  const [moreMenu, setMoreMenu] = useState(false);
  const [aiMenu, setAiMenu] = useState(false);
  const [aiSettings, setAiSettings] = useState(false);

  const { data: status, isError: statusStale } = useQuery({
    queryKey: ["git", "status", rootPath],
    queryFn: () => api.git.status(rootPath),
    refetchInterval: 2500,
    // Keep polling even when terminalhub isn't the focused/visible window — React Query pauses
    // refetchInterval for hidden tabs by default, which is why changes made while you're on
    // another Space/app only showed up after a manual tab-switch (a focus/remount refetch).
    refetchIntervalInBackground: true,
  });
  const { data: aiCfg } = useQuery({ queryKey: ["ai", "providers"], queryFn: () => api.ai.providers() });
  // Stash availability for the background menu's "Pop Latest Stash". Invalidated by useGit's ["git"]
  // prefix after any stash mutation, and re-fetched when the menu opens.
  const { data: stash } = useQuery({ queryKey: ["git", "stash", rootPath], queryFn: () => api.git.stashList(rootPath), staleTime: 5000 });
  if (!status) return <div className="px-3 py-4 text-xs text-dim shrink-0">loading…</div>;

  // The active provider: chosen default if enabled, else the first enabled one.
  const enabledProviders = (aiCfg?.providers ?? []).filter(p => p.enabled);
  const activeId = enabledProviders.find(p => p.id === aiCfg?.defaultProviderId)?.id ?? enabledProviders[0]?.id ?? null;
  const activeLabel = enabledProviders.find(p => p.id === activeId)?.label;
  // Switch the active provider by re-saving with a new default. Keys + commit prompt are
  // preserved server-side (apiKey/commitPrompt omitted = keep existing).
  const switchProvider = (id: string) => {
    const providers = (aiCfg?.providers ?? []).map(({ apiKeySet, apiKeyFromEnv, ...rest }) => rest as AiProvider);
    api.ai.saveProviders(providers, id)
      .then(() => qc.invalidateQueries({ queryKey: ["ai"] }))
      .catch((e: Error) => push(e.message));
  };

  const trackedPaths = status.unstaged.map(e => e.path);
  const hasStaged = status.staged.length > 0;
  // One flat, path-stable list. A partially-staged file (in both staged and unstaged)
  // collapses to a single row with an indeterminate checkbox; toggling never reorders.
  const rows = buildRows(status);
  const paths = rows.map(r => r.path); // render order, for Shift-range selection
  const changeCount = rows.length;
  const hasUnstaged = rows.some(r => !r.staged);
  const canCommit = msg.trim().length > 0 && (hasStaged || trackedPaths.length > 0) && !pending;
  const commitLabel = hasStaged ? "Commit" : "Commit Tracked";

  const doCommit = async () => {
    if (!hasStaged) await api.git.stage(rootPath, trackedPaths);
    await api.git.commit(rootPath, msg.trim());
  };
  const commit = () => run(doCommit, { onSuccess: () => resetDraft(rootPath) });
  const commitPush = () => run(
    async () => { await doCommit(); await api.git.push(rootPath, !status.upstream); },
    { onSuccess: () => resetDraft(rootPath) },
  );
  const commitPushPr = () => run(
    async () => { await doCommit(); await api.git.push(rootPath, !status.upstream); },
    { onSuccess: () => { resetDraft(rootPath); push("Committed and pushed. Open a PR from the PRs tab (gh pr create coming soon)."); } },
  );

  // The fetch itself runs in the store action (so it survives this panel unmounting); here we only
  // react to the outcome while still mounted — nudge them to set up a provider if there isn't one.
  const generate = async () => {
    const r = await runGenerate(rootPath);
    if (!r.ok && /no ai provider configured/i.test(r.error)) setAiSettings(true);
  };

  const openFor = (e: GitFileEntry, side: "staged" | "work", untracked: boolean) =>
    openDiff({ file: e.path, name: base(e.path), root: rootPath, staged: side === "staged", untracked });

  // The right-click menu for a file row. Stage/Unstage flips by group; Discard is off for
  // untracked (git has nothing to revert); Reveal-in-Finder only when the host is local.
  const menuItems = (m: FileMenuState): FileMenuEntry[] => {
    const abs = `${rootPath}/${m.entry.path}`;
    const name = base(m.entry.path);
    const staged = m.kind === "staged";
    return [
      staged
        ? { label: "Unstage File", onClick: () => run(() => api.git.unstage(rootPath, [m.entry.path])) }
        : { label: "Stage File", onClick: () => run(() => api.git.stage(rootPath, [m.entry.path])) },
      { label: "Discard Changes", disabled: m.untracked,
        onClick: async () => { if (await confirmModal({ title: "Discard changes", body: `Discard changes to ${name}? This cannot be undone.`, confirmLabel: "Discard" })) run(() => api.git.discard(rootPath, [m.entry.path])); } },
      { label: "Stash File…", onClick: () => {
        const msg = prompt(`Stash message for ${name} (optional)`);
        if (msg === null) return; // cancelled
        run(() => api.git.stashFile(rootPath, m.entry.path, msg.trim() || undefined));
      } },
      gitignoreMenuItem((scope) => run(
        () => api.git.ignore(rootPath, m.entry.path, scope, false),
        { onSuccess: (d) => { const r = d as { line: string; added: boolean };
          push(r.added ? `Added ${r.line} to ${ignoreScopeLabel(scope)}` : `${r.line} already in ${ignoreScopeLabel(scope)}`); } },
      )),
      "sep",
      { label: "Open Diff", onClick: () => openFor(m.entry, staged ? "staged" : "work", m.untracked) },
      { label: "Open File", onClick: () => openFile({ path: abs, name }) },
      { label: "Reveal in Explorer", onClick: () => revealInExplorer(abs) },
      ...(isLocalHost
        ? [
            { label: revealLabel, onClick: () => api.revealPath(abs).catch((e: Error) => push(e.message)) },
            { label: "Open in Default App", onClick: () => api.openPath(abs).catch((e: Error) => push(e.message)) },
          ] as FileMenuEntry[]
        : []),
      { label: "Copy Path", onClick: () => copyText(abs) },
      { label: "Copy Relative Path", onClick: () => copyText(m.entry.path) },
      "sep",
      // Delete the file from disk (fs unlink, not git): works for an untracked/new file where Discard
      // can't help. run() refreshes the git status so the row vanishes. confirmModal defaults to a red
      // danger button — this is irreversible.
      { label: "Delete File", danger: true,
        onClick: async () => { if (await confirmModal({ title: "Delete file", body: `Permanently delete ${name} from disk? This cannot be undone.`, confirmLabel: "Delete" })) run(() => api.fsDelete(abs)); } },
    ];
  };

  // The right-click menu for a multi-selection. Every action runs across ALL selected rows at once
  // (Stage/Unstage scope to the relevant group; Discard skips untracked/conflicts; one bulk stash).
  const multiMenuItems = (sel: ScmRow[]): FileMenuEntry[] => {
    const n = sel.length;
    const all = sel.map(r => r.path);
    const toStage = sel.filter(r => !r.staged || r.partial).map(r => r.path);
    const toUnstage = sel.filter(r => r.staged || r.partial).map(r => r.path);
    const toDiscard = sel.filter(r => !r.untracked && !r.conflict).map(r => r.path);
    const abs = all.map(p => `${rootPath}/${p}`);
    const done = () => setSelected(new Set());
    const word = (k: number) => (k === 1 ? "File" : "Files");
    return [
      { label: `${n} files selected`, disabled: true },
      "sep",
      { label: `Stage ${toStage.length} ${word(toStage.length)}`, disabled: toStage.length === 0,
        onClick: () => run(() => api.git.stage(rootPath, toStage), { onSuccess: done }) },
      { label: `Unstage ${toUnstage.length} ${word(toUnstage.length)}`, disabled: toUnstage.length === 0,
        onClick: () => run(() => api.git.unstage(rootPath, toUnstage), { onSuccess: done }) },
      { label: `Discard Changes (${toDiscard.length})`, disabled: toDiscard.length === 0,
        onClick: async () => { if (await confirmModal({ title: "Discard changes", body: `Discard changes to ${toDiscard.length} file${toDiscard.length === 1 ? "" : "s"}? This cannot be undone.`, confirmLabel: "Discard" })) run(() => api.git.discard(rootPath, toDiscard), { onSuccess: done }); } },
      { label: `Stash ${n} Files…`, onClick: () => {
        const m = prompt(`Stash message for ${n} files (optional)`);
        if (m === null) return; // cancelled
        run(() => api.git.stashFile(rootPath, all, m.trim() || undefined), { onSuccess: done });
      } },
      gitignoreMenuItem((scope) => run(
        async () => { for (const p of all) await api.git.ignore(rootPath, p, scope, false); },
        { onSuccess: () => { push(`Added ${n} path${n === 1 ? "" : "s"} to ${ignoreScopeLabel(scope)}`); done(); } },
      )),
      "sep",
      { label: "Copy Paths", onClick: () => copyText(abs.join("\n")) },
      { label: "Copy Relative Paths", onClick: () => copyText(all.join("\n")) },
      "sep",
      { label: `Delete ${n} ${word(n)}`, danger: true,
        onClick: async () => { if (await confirmModal({ title: "Delete files", body: `Permanently delete ${n} file${n === 1 ? "" : "s"} from disk? This cannot be undone.`, confirmLabel: "Delete" })) run(async () => { for (const p of abs) await api.fsDelete(p); }, { onSuccess: done }); } },
    ];
  };

  // The right-click menu for the empty area below the list — repo-wide bulk actions (a la VS Code /
  // Fork's SCM background menu). Items disable themselves when they'd be a no-op.
  const bgMenuItems = (): FileMenuEntry[] => {
    const tracked = rows.filter(r => !r.untracked && !r.conflict).map(r => r.path);
    const untracked = status.untracked;
    const hasStash = (stash?.stashes.length ?? 0) > 0;
    return [
      { label: "Stage All Changes", disabled: !hasUnstaged, onClick: () => run(() => api.git.stageAll(rootPath), { optimistic: () => optimisticStageAll(qc, rootPath) }) },
      { label: "Unstage All", disabled: !hasStaged, onClick: () => run(() => api.git.unstageAll(rootPath), { optimistic: () => optimisticUnstageAll(qc, rootPath) }) },
      "sep",
      { label: "Stash All Changes", disabled: changeCount === 0, onClick: () => run(() => api.git.stashSave(rootPath, "", true)) },
      { label: "Pop Latest Stash", disabled: !hasStash, onClick: () => run(() => api.git.stashPop(rootPath, "stash@{0}")) },
      { label: "View Stashes", onClick: () => setScmTab("stash") },
      "sep",
      { label: "Discard All Tracked Changes", disabled: tracked.length === 0, onClick: async () => {
        if (await confirmModal({ title: "Discard all changes", body: `Discard changes to ${tracked.length} tracked file${tracked.length === 1 ? "" : "s"}? This cannot be undone.`, confirmLabel: "Discard All" }))
          run(() => api.git.discard(rootPath, tracked));
      } },
      { label: "Trash Untracked Files", disabled: untracked.length === 0, onClick: async () => {
        if (await confirmModal({ title: "Trash untracked files", body: `Permanently delete ${untracked.length} untracked file${untracked.length === 1 ? "" : "s"}? This cannot be undone.`, confirmLabel: "Trash" }))
          run(() => api.git.clean(rootPath));
      } },
    ];
  };

  // A row click: Cmd/Ctrl toggles, Shift extends from the anchor, plain click selects one + opens
  // its diff (today's behaviour). select-none on the row keeps Shift from text-selecting filenames.
  const handleClick = (e: ReactMouseEvent, path: string, i: number, onOpen: () => void) => {
    if (e.metaKey || e.ctrlKey) {
      setSelected(prev => { const next = new Set(prev); next.has(path) ? next.delete(path) : next.add(path); return next; });
      anchorRef.current = path;
      return;
    }
    if (e.shiftKey) {
      const anchor = anchorRef.current && paths.includes(anchorRef.current) ? anchorRef.current : path;
      const a = paths.indexOf(anchor);
      const [lo, hi] = a <= i ? [a, i] : [i, a];
      setSelected(new Set(paths.slice(lo, hi + 1)));
      return;
    }
    setSelected(new Set([path]));
    anchorRef.current = path;
    onOpen();
  };

  // Right-click keeps an existing multi-selection if the clicked row is part of it; otherwise it
  // collapses to that one row first, so the menu always matches what's highlighted.
  const handleContext = (x: number, y: number, r: ScmRow, kind: RowKind) => {
    const inMulti = rows.filter(row => selected.has(row.path)).length > 1 && selected.has(r.path);
    if (!inMulti) { setSelected(new Set([r.path])); anchorRef.current = r.path; }
    setFileMenu({ x, y, entry: r.entry, kind, untracked: r.untracked });
  };

  return (
    <div className="flex-1 min-h-0 px-2 pt-2 pb-1 flex flex-col overflow-hidden">
      {/* commit message box — drag the bottom-right grip (resize-y) or toggle expand */}
      <div className="relative shrink-0">
        <textarea ref={taRef} defaultValue={msg} onChange={e => { setMsg(rootPath, e.target.value); if (genError) clearError(rootPath); }} rows={expanded ? 10 : 5}
          placeholder="Enter commit message"
          className="w-full px-2 py-1.5 pr-7 text-sm bg-panel border border-edge rounded outline-none focus:border-blue-500 resize-y min-h-[2.5rem]" />
        <button title={expanded ? "Collapse" : "Expand"} onClick={() => setExpanded(v => !v)}
          className="absolute top-1.5 right-1.5 text-dim hover:text-fg text-xs leading-none">{expanded ? "⤡" : "⤢"}</button>
      </div>

      {/* generation error (timeout, no provider, non-zero CLI) — sits in the commit box so a failed
          ✨ run is visible here, not just a fleeting toast. Cleared on retry or when you start typing. */}
      {genError && (
        <div className="mt-1 flex items-start gap-1.5 text-[11px] text-red-400 shrink-0" role="alert">
          <span className="leading-none">⚠</span>
          <span className="min-w-0 break-words">{genError}</span>
        </div>
      )}

      {/* generate (✨ + provider chevron) + commit split button */}
      <div className="flex items-stretch gap-1 mt-1 shrink-0">
        <div className="flex">
          <button title={hasStaged ? "Generate a commit message from the staged diff" : "Stage changes first to generate a message"}
            disabled={!hasStaged || generating} onClick={generate}
            className={`h-7 px-2 rounded-l text-sm border border-edge-strong ${hasStaged && !generating ? "bg-elevated hover:bg-edge text-fg" : "bg-panel text-dim cursor-not-allowed"}`}>
            {generating
              ? <span className="tr-dot-wave" role="status" aria-label="Generating commit message"><i /><i /><i /></span>
              : "✨"}
          </button>
          <div className="relative">
            <button onClick={() => setAiMenu(v => !v)}
              title={activeLabel ? `AI: ${activeLabel} — switch or edit settings` : "Choose an AI provider"}
              className="h-7 w-7 flex items-center justify-center rounded-r border border-l-0 border-edge-strong bg-elevated hover:bg-edge text-fg text-base leading-none">
              <span className="-translate-y-1">⌄</span></button>
            <Popover open={aiMenu} onClose={() => setAiMenu(false)} className="left-0 top-8 w-56">
              {enabledProviders.map(p => (
                <MenuItem key={p.id} onClick={() => { setAiMenu(false); switchProvider(p.id); }}>
                  <span className="flex items-center gap-2">
                    <span className="w-3 text-blue-400">{p.id === activeId ? "✓" : ""}</span>
                    <span className="truncate">{p.label}</span>
                  </span>
                </MenuItem>
              ))}
              {enabledProviders.length === 0 && <div className="px-3 py-1.5 text-xs text-dim">No providers yet</div>}
              <MenuSep />
              <MenuItem onClick={() => { setAiMenu(false); setAiSettings(true); }}>Edit settings…</MenuItem>
            </Popover>
          </div>
        </div>
        <div className="flex-1 flex">
          <button disabled={!canCommit} onClick={commit}
            className={`flex-1 min-w-0 h-7 rounded-l text-xs whitespace-nowrap truncate px-1 ${canCommit ? "bg-blue-600 hover:bg-blue-500 text-white" : "bg-elevated text-dim cursor-not-allowed"}`}>
            ✓ {commitLabel}
          </button>
          <div className="relative">
            <button disabled={!canCommit} title="Commit options" onClick={() => setCommitMenu(v => !v)}
              className={`h-7 px-1.5 rounded-r border-l text-base flex items-center justify-center leading-none ${canCommit ? "bg-blue-600 hover:bg-blue-500 text-white border-blue-700" : "bg-elevated text-dim cursor-not-allowed border-edge-strong"}`}><span className="-translate-y-1">⌄</span></button>
            <Popover open={commitMenu} onClose={() => setCommitMenu(false)} className="right-0 top-8 w-52">
              <MenuItem onClick={() => { setCommitMenu(false); commit(); }}>{commitLabel}</MenuItem>
              <MenuItem onClick={() => { setCommitMenu(false); commitPush(); }}>{commitLabel} & Push</MenuItem>
              <MenuItem onClick={() => { setCommitMenu(false); commitPushPr(); }}>{commitLabel}, Push & PR</MenuItem>
            </Popover>
          </div>
        </div>
      </div>

      {/* changes count + stage-all + overflow */}
      <div className="flex items-center justify-between mt-2 mb-0.5 px-1 text-[11px] tracking-wide text-muted shrink-0">
        <span className="flex items-center gap-1.5">
          {changeCount > 0 ? `${changeCount} Change${changeCount > 1 ? "s" : ""}` : "No Changes"}
          {statusStale && <span className="text-red-400" title="Couldn't refresh from git — this list may be out of date. Retrying…">⚠ stale</span>}
        </span>
        <div className="flex items-center gap-3">
          {hasUnstaged ? (
            <button title="Stage all changes" onClick={() => run(() => api.git.stageAll(rootPath), { optimistic: () => optimisticStageAll(qc, rootPath) })} className="hover:text-bright">Stage All</button>
          ) : hasStaged ? (
            <button title="Unstage all changes" onClick={() => run(() => api.git.unstageAll(rootPath), { optimistic: () => optimisticUnstageAll(qc, rootPath) })} className="hover:text-bright">Unstage All</button>
          ) : null}
          <div className="relative">
            <button title="More actions" onClick={() => setMoreMenu(v => !v)} className="hover:text-bright leading-none">⋯</button>
            <Popover open={moreMenu} onClose={() => setMoreMenu(false)} className="right-0 top-5 w-56">
              <MenuItem onClick={() => { setMoreMenu(false); run(() => api.git.stashSave(rootPath, "", true)); }}>Stash changes (incl. untracked)</MenuItem>
              <MenuItem onClick={() => { setMoreMenu(false); run(() => api.git.stashPop(rootPath, "stash@{0}")); }}>Pop latest stash</MenuItem>
              <MenuSep />
              <MenuItem onClick={() => { setMoreMenu(false); setAiSettings(true); }}>Configure AI providers…</MenuItem>
            </Popover>
          </div>
        </div>
      </div>

      {/* one flat list — tick the right-edge checkbox to stage; untick to unstage. A click on the
          empty area below the rows (the container itself, not a row) clears the selection; a
          right-click there opens the repo-wide background menu (rows handle their own menu). */}
      <div className="flex-1 min-h-0 overflow-auto -mx-2 pt-0.5"
        onClick={e => { if (e.target === e.currentTarget) setSelected(new Set()); }}
        onContextMenu={e => {
          if (e.target !== e.currentTarget) return; // a row's own handler covers row right-clicks
          e.preventDefault();
          qc.invalidateQueries({ queryKey: ["git", "stash", rootPath] });
          setBgMenu({ x: e.clientX, y: e.clientY });
        }}>
        {rows.map((r, i) => {
          const kind: RowKind = r.conflict ? "conflict" : r.staged && !r.partial ? "staged" : "work";
          // Dragging a row that's part of a multi-selection drags every selected path.
          const dragPaths = selected.has(r.path) && selected.size > 1
            ? rows.filter(row => selected.has(row.path)).map(row => `${rootPath}/${row.path}`)
            : [`${rootPath}/${r.path}`];
          return (
            <Row key={r.path} row={r} dragPaths={dragPaths} selected={selected.has(r.path)}
              onClick={e => handleClick(e, r.path, i, () => openFor(r.entry, kind === "staged" ? "staged" : "work", r.untracked))}
              onContext={(x, y) => handleContext(x, y, r, kind)}
              onToggle={() => run(() => r.staged && !r.partial
                ? api.git.unstage(rootPath, [r.path])
                : api.git.stage(rootPath, [r.path]))}
              onDiscard={r.untracked || r.conflict ? undefined : async () => {
                if (await confirmModal({ title: "Discard changes", body: `Discard changes to ${base(r.path)}? This cannot be undone.`, confirmLabel: "Discard" })) run(() => api.git.discard(rootPath, [r.path]));
              }} />
          );
        })}
        {changeCount === 0 && status.submodules.length === 0 && <div className="px-3 py-4 text-xs text-dim">No changes.</div>}
      </div>

      {/* Submodules with inner dirt — can't be staged from this repo (their files live in their own
          repo), so they're surfaced here instead of as stuck change rows. Click to drill into the
          submodule's own source control and commit there (VS Code-style). */}
      {status.submodules.length > 0 && (
        <div className="shrink-0 border-t border-edge mt-1 pt-1 -mx-2">
          <div className="px-3 text-[11px] tracking-wide text-muted mb-0.5">Submodules</div>
          {status.submodules.map(m => (
            <button key={m.path} title={`Open ${m.path} — stage and commit its changes in its own repo`}
              onClick={() => onOpenSubmodule?.(`${rootPath}/${m.path}`)}
              className="w-full flex items-center gap-2 pl-3 pr-2.5 py-0.5 text-left cursor-pointer hover:bg-surface">
              <span className="shrink-0 text-dim"><FolderIcon /></span>
              <span className="min-w-0 shrink truncate text-fg">{base(m.path)}</span>
              <span className="min-w-0 shrink-[3] truncate text-dim text-xs">{dir(m.path)}</span>
              <span className="shrink-0 ml-auto text-[10px] text-muted">{submoduleHint(m)} ›</span>
            </button>
          ))}
        </div>
      )}

      {aiSettings && <AiProviderSettings onClose={() => setAiSettings(false)} />}
      {fileMenu && (() => {
        const selRows = rows.filter(r => selected.has(r.path));
        const items = selRows.length > 1 && selected.has(fileMenu.entry.path)
          ? multiMenuItems(selRows)
          : menuItems(fileMenu);
        return <FileContextMenu x={fileMenu.x} y={fileMenu.y} items={items} dismiss={() => setFileMenu(null)} />;
      })()}
      {bgMenu && (
        <FileContextMenu x={bgMenu.x} y={bgMenu.y} items={bgMenuItems()} dismiss={() => setBgMenu(null)} />
      )}
    </div>
  );
}

// Optimistic status transforms so the stage checkboxes flip the INSTANT you click Stage All /
// Unstage All, instead of sitting frozen while a slow, per-repo-serialized `git status -uall`
// round-trips. `cancelQueries` kills any in-flight status poll so a pre-op read can't land late and
// overwrite us; useGit's shared invalidate reconciles to real git within ~1s, and rolls this back (+
// toasts) if the op fails. This is the true result of the operation, not fabricated state — the
// server's next status replaces it wholesale.
const STATUS_KEY = (rootPath: string) => ["git", "status", rootPath] as const;

/** Snapshot + cancel in-flight polls; returns a rollback that restores the snapshot. */
function beginOptimistic(qc: QueryClient, rootPath: string): { prev: GitStatus | undefined; rollback: () => void } {
  const key = STATUS_KEY(rootPath);
  void qc.cancelQueries({ queryKey: key });
  const prev = qc.getQueryData<GitStatus>(key);
  return { prev, rollback: () => { if (prev) qc.setQueryData<GitStatus>(key, prev); } };
}

/** Stage All (`git add -A`): everything moves into `staged`; worktree/untracked/conflicts clear. */
function optimisticStageAll(qc: QueryClient, rootPath: string): () => void {
  const { prev, rollback } = beginOptimistic(qc, rootPath);
  if (!prev) return rollback;
  // Best-effort index char (real value lands on refetch): keep a staged entry as-is; for an unstaged
  // edit reuse its worktree letter; a brand-new (untracked) file stages as Added.
  const asStaged = (e: GitFileEntry): GitFileEntry => ({ ...e, index: e.worktree !== "." && e.worktree !== "?" ? e.worktree : "A", worktree: "." });
  const staged: GitFileEntry[] = [
    ...prev.staged,
    ...prev.unstaged.filter(u => !prev.staged.some(s => s.path === u.path)).map(asStaged),
    ...prev.conflicted.map(asStaged),
    ...prev.untracked.map(p => ({ path: p, index: "A", worktree: "." })),
  ];
  qc.setQueryData<GitStatus>(STATUS_KEY(rootPath), { ...prev, staged, unstaged: [], untracked: [], conflicted: [] });
  return rollback;
}

/** Unstage All (`git reset HEAD`): staged empties; a previously-Added file becomes untracked again,
 *  everything else drops back to the worktree. Untracked files were never staged, so they're kept. */
function optimisticUnstageAll(qc: QueryClient, rootPath: string): () => void {
  const { prev, rollback } = beginOptimistic(qc, rootPath);
  if (!prev) return rollback;
  const unstaged: GitFileEntry[] = [...prev.unstaged];
  const untracked: string[] = [...prev.untracked];
  for (const s of prev.staged) {
    if (s.index === "A") { if (!untracked.includes(s.path)) untracked.push(s.path); }
    else if (!unstaged.some(u => u.path === s.path))
      unstaged.push({ ...s, worktree: s.index !== "." && s.index !== "?" ? s.index : "M", index: "." });
  }
  qc.setQueryData<GitStatus>(STATUS_KEY(rootPath), { ...prev, staged: [], unstaged, untracked });
  return rollback;
}

/** One-word state for a dirty submodule row (what you'd go in and commit). */
function submoduleHint(m: SubmoduleEntry): string {
  if (m.commitChanged) return "commit changed";
  if (m.hasUntracked && m.hasModifications) return "modified · untracked";
  if (m.hasUntracked) return "untracked content";
  return "modified content";
}

/** One row in the flat change list, with its derived staged/partial/checkbox state. */
type ScmRow = {
  path: string; orig?: string; statusChar: string;
  staged: boolean; partial: boolean; untracked: boolean; conflict: boolean; entry: GitFileEntry;
};

/**
 * Collapse staged / unstaged / untracked / conflicted into ONE path-stable, sorted list.
 * A file that is staged AND has further worktree edits appears once, marked `partial` so the
 * checkbox renders indeterminate. Conflicts sort to the top; everything else by path — so
 * staging a file (which only flips `staged`) never moves the row.
 */
function buildRows(status: { staged: GitFileEntry[]; unstaged: GitFileEntry[]; untracked: string[]; conflicted: GitFileEntry[] }): ScmRow[] {
  const byPath = new Map<string, ScmRow>();
  for (const e of status.staged)
    byPath.set(e.path, { path: e.path, orig: e.orig, statusChar: e.index, staged: true, partial: false, untracked: false, conflict: false, entry: e });
  for (const e of status.unstaged) {
    const prev = byPath.get(e.path);
    if (prev) { prev.partial = true; prev.statusChar = e.worktree; } // staged, then edited again
    else byPath.set(e.path, { path: e.path, orig: e.orig, statusChar: e.worktree, staged: false, partial: false, untracked: false, conflict: false, entry: e });
  }
  for (const p of status.untracked)
    if (!byPath.has(p)) byPath.set(p, { path: p, statusChar: "?", staged: false, partial: false, untracked: true, conflict: false, entry: { path: p, index: ".", worktree: "?" } });
  const conflicts: ScmRow[] = status.conflicted.map(e => ({ path: e.path, orig: e.orig, statusChar: "U", staged: false, partial: false, untracked: false, conflict: true, entry: e }));
  const byName = (a: ScmRow, b: ScmRow) => a.path.localeCompare(b.path);
  return [...conflicts.sort(byName), ...[...byPath.values()].sort(byName)];
}

/** A status dot · filename · dir, with a Discard-on-hover glyph and a right-edge stage checkbox. */
function Row({ row, dragPaths, selected, onClick, onContext, onToggle, onDiscard }:
  { row: ScmRow; dragPaths: string[]; selected: boolean; onClick: (e: ReactMouseEvent) => void;
    onContext: (x: number, y: number) => void; onToggle: () => void; onDiscard?: () => void }) {
  const b = badge(row.statusChar);
  const title = !row.staged ? "Stage this file"
    : row.partial ? "Partially staged — click to stage the rest" : "Staged — click to unstage";
  return (
    <div onClick={onClick} title={row.path} draggable
      onContextMenu={e => { e.preventDefault(); onContext(e.clientX, e.clientY); }}
      onDragStart={e => startPathDrag(e, dragPaths)}
      className={`group/row flex items-center gap-2 pl-3 pr-2.5 py-0.5 cursor-pointer select-none ${selected ? "bg-blue-600/25" : "hover:bg-surface"}`}>
      <span className={`shrink-0 text-[9px] leading-none ${b.c}`}
        title={row.orig ? `${b.label} from ${row.orig}` : b.label}>●</span>
      <span className="min-w-0 shrink truncate text-fg">{base(row.path)}</span>
      <span className="min-w-0 shrink-[3] truncate text-dim text-xs">{dir(row.path)}</span>
      <span className="shrink-0 ml-auto flex items-center gap-2">
        {onDiscard && (
          <button title="Discard Changes" onClick={e => { e.stopPropagation(); onDiscard(); }}
            className="hidden group-hover/row:inline-flex text-muted hover:text-bright leading-none">⟲</button>
        )}
        <CheckBox checked={row.staged} indeterminate={row.partial} title={title} onToggle={onToggle} />
      </span>
    </div>
  );
}

/** Themed tri-state stage checkbox: empty box · blue ✓ (staged) · blue dash (partially staged). */
function CheckBox({ checked, indeterminate, title, onToggle }:
  { checked: boolean; indeterminate: boolean; title: string; onToggle: () => void }) {
  return (
    <button type="button" role="checkbox" aria-checked={indeterminate ? "mixed" : checked} title={title}
      onClick={e => { e.stopPropagation(); onToggle(); }}
      className="shrink-0 w-[15px] h-[15px] rounded-[3px] border border-edge-strong hover:border-muted flex items-center justify-center bg-transparent text-blue-400">
      {indeterminate
        ? <span className="block w-2 h-[2px] bg-current rounded-sm" />
        : checked
          ? <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.2l2.2 2.3L9.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          : null}
    </button>
  );
}
