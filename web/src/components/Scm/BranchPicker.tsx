import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { GitBranch } from "../../api/types";
import { useInfiniteList } from "../../hooks/useInfiniteList";
import { BranchFilterList } from "./BranchFilterList";

/**
 * The ＋ branch dropdown. Two modes:
 *
 * - default (`showSearch` off) — a switch list plus a "Create new branch…" affordance, NO search
 *   box. Used by the Branches tab, where the inline filter bar under the header already searches, so
 *   a second search here would be redundant.
 * - `showSearch` — delegates to `BranchFilterList` (search + filtered list + create row). Used by the
 *   room-header branch chip, which has no inline filter to fall back on, so its search is the only
 *   way to find a branch among many.
 *
 * Either way the list lazy-loads on scroll so thousands of branches don't all mount, create never
 * uses a browser prompt, and the popover flips above the trigger near the viewport bottom. Anchor it
 * via `className` positioning utilities (e.g. "right-0 top-7 w-64") inside a `relative` wrapper.
 */
export function BranchPicker({ branches, onCheckout, onCreate, onClose, className, pending, showSearch = false }: {
  branches: GitBranch[];
  onCheckout: (name: string) => void;
  onCreate: (name: string) => void;
  onClose: () => void;
  className: string;
  pending?: boolean;
  showSearch?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [flipUp, setFlipUp] = useState(false);
  useLayoutEffect(() => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setFlipUp(r.bottom > window.innerHeight - 8);
  }, []);
  const current = branches.find(b => b.current)?.name ?? null;

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (creating) inputRef.current?.focus(); }, [creating]);

  const { scrollRef, onScroll, visible, hasMore } = useInfiniteList(branches, b => b.name);
  const create = () => { const n = name.trim(); if (n) { onCreate(n); onClose(); } };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div ref={wrapRef} style={flipUp ? { top: "auto", bottom: "100%", marginBottom: 4 } : undefined}
        className={`absolute z-50 flex flex-col bg-panel border border-edge rounded shadow-lg text-sm ${className}`}>
        {showSearch ? (
          <BranchFilterList branches={branches} pending={pending} currentName={current} onEscape={onClose}
            onPick={(picked, isNew) => { if (isNew) onCreate(picked); else if (picked !== current) onCheckout(picked); onClose(); }} />
        ) : (<>
          {creating ? (
            <div className="p-1.5 border-b border-edge shrink-0">
              <input ref={inputRef} value={name} onChange={e => setName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") { e.preventDefault(); create(); }
                  else if (e.key === "Escape") { e.preventDefault(); setCreating(false); setName(""); }
                }}
                placeholder="New branch name…" spellCheck={false}
                className="w-full px-2 py-1 text-sm bg-panel border border-edge rounded outline-none focus:border-blue-500" />
            </div>
          ) : (
            <button onClick={() => setCreating(true)} disabled={pending}
              className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-elevated border-b border-edge shrink-0">
              <span className="w-3 shrink-0 text-center text-blue-400">＋</span>
              <span className="truncate">Create new branch…</span>
            </button>
          )}
          <div ref={scrollRef} onScroll={onScroll} className="max-h-64 overflow-auto py-1">
            {visible.map(b => (
              <button key={b.name} onClick={() => { if (b.name !== current) onCheckout(b.name); onClose(); }}
                className="w-full text-left px-3 py-1.5 flex items-center gap-2 truncate hover:bg-elevated">
                <span className="w-3 shrink-0 text-center text-blue-400">{b.name === current ? "●" : ""}</span>
                <span className="truncate">{b.name}</span>
                {b.upstream && <span className="ml-auto shrink-0 text-[10px] text-dim truncate max-w-[7rem]">{b.upstream}</span>}
              </button>
            ))}
            {hasMore && <div className="px-3 py-1 text-center text-[10px] text-dim">scroll for more…</div>}
            {branches.length === 0 && <div className="px-3 py-2 text-xs text-dim">No branches.</div>}
          </div>
        </>)}
      </div>
    </>
  );
}
