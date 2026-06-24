import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { GitBranch } from "../../api/types";
import { useInfiniteList } from "../../hooks/useInfiniteList";

/**
 * A search box + live-filtered branch list + an optional "Create branch '<query>'" row.
 * Calls `onPick(name, isNew)` when a row is chosen (click or Enter) — `isNew` is true for the
 * create row. Keyboard: ↑/↓ move the highlight, Enter picks the highlighted row, Esc → `onEscape`.
 *
 * The list lazy-loads on scroll (`useInfiniteList`), so this stays the *fast* way to find a branch
 * even when a repo has thousands — without mounting every row. Used by the worktree-add popover and
 * the PR base picker, where this search is the only branch filter (the tab's inline filter only
 * narrows the tab's own list, not these sub-pickers).
 */
export function BranchFilterList({
  branches, onPick, onEscape, allowCreate = true, currentName, pending,
  placeholder = "Switch or create branch…", emptyLabel = "No branches.", autoFocus = true,
}: {
  branches: GitBranch[];
  onPick: (name: string, isNew: boolean) => void;
  onEscape?: () => void;
  allowCreate?: boolean;
  currentName?: string | null;
  pending?: boolean;
  placeholder?: string;
  emptyLabel?: string;
  autoFocus?: boolean;
}) {
  const { filter, setFilter, scrollRef, onScroll, visible, hasMore } =
    useInfiniteList(branches, b => (b.upstream ? `${b.name} ${b.upstream}` : b.name));
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);

  const q = filter.trim();
  const canCreate = allowCreate && q.length > 0 && !branches.some(b => b.name === q);
  const createIndex = canCreate ? visible.length : -1;
  const optionCount = visible.length + (canCreate ? 1 : 0);
  useEffect(() => { setActive(a => Math.min(Math.max(a, 0), Math.max(0, optionCount - 1))); }, [optionCount]);

  const choose = (i: number) => {
    if (i === createIndex) { onPick(q, true); return; }
    const b = visible[i];
    if (b) onPick(b.name, false);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(a + 1, optionCount - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (optionCount) choose(active); }
    else if (e.key === "Escape") { e.preventDefault(); onEscape?.(); }
  };

  const isCurrent = (b: GitBranch) => (currentName != null ? b.name === currentName : b.current);
  const rowCls = (i: number) =>
    `w-full text-left px-3 py-1.5 flex items-center gap-2 truncate ${i === active ? "bg-elevated" : "hover:bg-elevated"}`;

  return (
    <>
      <div className="p-1.5 border-b border-edge shrink-0">
        <input ref={inputRef} value={filter} onChange={e => { setFilter(e.target.value); setActive(0); }}
          onKeyDown={onKeyDown} placeholder={placeholder} spellCheck={false}
          className="w-full px-2 py-1 text-sm bg-panel border border-edge rounded outline-none focus:border-blue-500" />
      </div>
      <div ref={scrollRef} onScroll={onScroll} className="max-h-64 overflow-auto py-1">
        {visible.map((b, i) => (
          <button key={b.name} title={b.name} onClick={() => choose(i)} onMouseEnter={() => setActive(i)} className={rowCls(i)}>
            <span className="w-3 shrink-0 text-center text-blue-400">{isCurrent(b) ? "●" : ""}</span>
            <span className="min-w-0 flex-1 truncate">{b.name}</span>
          </button>
        ))}
        {hasMore && <div className="px-3 py-1 text-center text-[10px] text-dim">scroll for more…</div>}
        {visible.length === 0 && !canCreate && <div className="px-3 py-2 text-xs text-dim">{emptyLabel}</div>}
        {canCreate && (
          <button onClick={() => choose(createIndex)} onMouseEnter={() => setActive(createIndex)} disabled={pending} className={rowCls(createIndex)}>
            <span className="w-3 shrink-0 text-center text-blue-400">＋</span>
            <span className="truncate">Create branch <span className="text-fg font-medium">“{q}”</span></span>
          </button>
        )}
      </div>
    </>
  );
}
