import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../api/client";
import type { StashEntry } from "../../../api/types";
import { useGit } from "../useGit";
import { useRoom } from "../../../store/room";
import { FileContextMenu, type FileMenuEntry } from "../FileContextMenu";

/** Stash entries: apply / pop / drop per entry (drop is confirmed). Creating a stash happens from
 *  the changes list (select files → Stash), so there's no ＋ here. */
export function StashTab({ rootPath }: { rootPath: string }) {
  const { run } = useGit();
  const openStashDiff = useRoom(s => s.openStashDiff);
  const [menu, setMenu] = useState<{ s: StashEntry; x: number; y: number } | null>(null);
  const { data } = useQuery({
    queryKey: ["git", "stash", rootPath],
    queryFn: () => api.git.stashList(rootPath),
    refetchInterval: 8000,
  });
  const stashes = data?.stashes ?? [];

  const drop = (s: StashEntry) => {
    if (confirm(`Drop ${s.ref}? This permanently deletes the stash.`)) run(() => api.git.stashDrop(rootPath, s.ref));
  };

  // Apply keeps the stash; Pop applies then drops it — the standard git distinction.
  const items = (s: StashEntry): FileMenuEntry[] => [
    { label: "Apply (Keep Stash)", onClick: () => run(() => api.git.stashApply(rootPath, s.ref)) },
    { label: "Pop (Apply & Delete)", onClick: () => run(() => api.git.stashPop(rootPath, s.ref)) },
    "sep",
    { label: "View Diff", onClick: () => openStashDiff({ ref: s.ref, name: s.message || s.ref, root: rootPath }) },
    { label: "Copy Ref", onClick: () => navigator.clipboard.writeText(s.ref).catch(() => {}) },
    "sep",
    { label: "Delete Stash", onClick: () => drop(s) },
  ];

  return (
    <div className="flex-1 min-h-0 flex flex-col text-sm">
      <div className="flex items-center px-3 h-7 shrink-0 text-[11px] tracking-wide text-muted">
        <span>STASHES <span className="text-dim">{stashes.length}</span></span>
      </div>
      <div className="flex-1 overflow-auto">
        {stashes.map(s => (
          <div key={s.ref} className="group/row flex items-center gap-2 px-3 py-1.5 hover:bg-surface"
            onContextMenu={e => { e.preventDefault(); setMenu({ s, x: e.clientX, y: e.clientY }); }}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-fg">{s.message || s.ref}</span>
              <span className="block text-[11px] text-dim">{s.ref}</span>
            </span>
            <span className="ml-auto shrink-0 hidden group-hover/row:flex items-center gap-2.5 text-xs">
              <button onClick={() => run(() => api.git.stashApply(rootPath, s.ref))} className="text-muted hover:text-bright">Apply</button>
              <button onClick={() => run(() => api.git.stashPop(rootPath, s.ref))} className="text-muted hover:text-bright">Pop</button>
              <button onClick={() => drop(s)} className="text-muted hover:text-red-300">Drop</button>
            </span>
          </div>
        ))}
        {stashes.length === 0 && <div className="px-3 py-4 text-xs text-dim">No stashes.</div>}
      </div>

      {menu && <FileContextMenu x={menu.x} y={menu.y} items={items(menu.s)} dismiss={() => setMenu(null)} />}
    </div>
  );
}
